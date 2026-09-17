package httpapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"pindou/server/internal/app"
	"pindou/server/internal/domain"
	"pindou/server/internal/security"
	"strconv"
	"strings"
	"sync"
	"time"
)

type API struct {
	Services *app.Services
	limiter  *limiter
}
type ctxKey int

const requestKey ctxKey = 1

type envelope struct {
	Code      string `json:"code"`
	Data      any    `json:"data"`
	Message   string `json:"message,omitempty"`
	Details   any    `json:"details,omitempty"`
	RequestID string `json:"requestId"`
}

func (a *API) write(w http.ResponseWriter, r *http.Request, status int, data any, err error) {
	e := envelope{Code: "OK", Data: data}
	e.RequestID, _ = r.Context().Value(requestKey).(string)
	if err != nil {
		var de *domain.Error
		if errors.As(err, &de) {
			status = de.Status
			e.Code = de.Code
			e.Message = de.Message
			e.Details = de.Details
		} else {
			status = 500
			e.Code = "INTERNAL_ERROR"
			e.Message = "服务暂时不可用，请稍后重试"
			if strings.Contains(err.Error(), "locked") || strings.Contains(err.Error(), "SQLITE_BUSY") {
				status = 503
				e.Code = "DB_UNAVAILABLE"
			}
			slog.Error("api error", "requestId", e.RequestID, "error", err)
		}
	}
	if status == 429 {
		w.Header().Set("Retry-After", "300")
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(e)
}
func (a *API) decode(w http.ResponseWriter, r *http.Request, v any) error {
	if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
		return domain.Fail(400, "INVALID_ARGUMENT", "需要 JSON 请求")
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 3*1024*1024))
	if err := dec.Decode(v); err != nil {
		var max *http.MaxBytesError
		if errors.As(err, &max) {
			return domain.Fail(413, "PAYLOAD_TOO_LARGE", "请求超过大小上限")
		}
		return domain.Fail(400, "INVALID_JSON", "请求内容无法解析")
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		var max *http.MaxBytesError
		if errors.As(err, &max) {
			return domain.Fail(413, "PAYLOAD_TOO_LARGE", "请求超过大小上限")
		}
		return domain.Fail(400, "INVALID_JSON", "JSON 尾部包含多余数据")
	}
	return nil
}
func token(r *http.Request) string {
	c, e := r.Cookie("pindou_session")
	if e != nil {
		return ""
	}
	return c.Value
}
func (a *API) user(w http.ResponseWriter, r *http.Request) (app.AuthResult, bool) {
	u, e := a.Services.ResolveSession(r.Context(), token(r))
	if e != nil {
		a.write(w, r, 401, nil, e)
		return u, false
	}
	return u, true
}
func (a *API) cookie(w http.ResponseWriter, t string, expiry time.Time) {
	http.SetCookie(w, &http.Cookie{Name: "pindou_session", Value: t, Path: "/", HttpOnly: true, Secure: a.Services.Config.CookieSecure, SameSite: http.SameSiteLaxMode, Expires: expiry})
}
func NewRouter(s *app.Services) http.Handler {
	a := &API{s, &limiter{items: map[string]attempt{}}}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/healthz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), time.Second)
		defer cancel()
		err := s.Repo.DB.PingContext(ctx)
		if err != nil {
			a.write(w, r, 503, nil, domain.Fail(503, "DB_UNAVAILABLE", "数据库暂时不可用"))
			return
		}
		a.write(w, r, 200, map[string]string{"status": "ok"}, nil)
	})
	mux.HandleFunc("GET /api/v1/colors", func(w http.ResponseWriter, r *http.Request) {
		data, e := s.Colors(r.Context())
		a.write(w, r, 200, data, e)
	})
	for _, route := range []string{"register", "login"} {
		register := route == "register"
		mux.HandleFunc("POST /api/v1/auth/"+route, func(w http.ResponseWriter, r *http.Request) {
			ip := clientIP(r)
			if !a.limiter.allow(ip) {
				a.write(w, r, 429, nil, domain.Fail(429, "RATE_LIMITED", "登录尝试较多，请 5 分钟后重试"))
				return
			}
			var body struct {
				Username string `json:"username"`
				Password string `json:"password"`
			}
			if e := a.decode(w, r, &body); e != nil {
				a.write(w, r, 400, nil, e)
				return
			}
			u, e := s.Authenticate(r.Context(), body.Username, body.Password, register)
			if e != nil {
				a.limiter.failed(ip)
				a.write(w, r, 400, nil, e)
				return
			}
			expiry, _ := time.Parse(time.RFC3339Nano, u.ExpiresAt)
			a.cookie(w, u.Token, expiry)
			status := 200
			if register {
				status = 201
			}
			a.write(w, r, status, u, nil)
		})
	}
	mux.HandleFunc("POST /api/v1/auth/logout", func(w http.ResponseWriter, r *http.Request) {
		if t := token(r); t != "" {
			if e := s.Repo.DeleteSession(r.Context(), security.TokenHash(t)); e != nil {
				a.write(w, r, 500, nil, e)
				return
			}
		}
		a.cookie(w, "", time.Unix(1, 0))
		a.write(w, r, 200, nil, nil)
	})
	mux.HandleFunc("GET /api/v1/me", func(w http.ResponseWriter, r *http.Request) {
		if u, ok := a.user(w, r); ok {
			a.write(w, r, 200, u, nil)
		}
	})
	mux.HandleFunc("POST /api/v1/works", func(w http.ResponseWriter, r *http.Request) {
		u, ok := a.user(w, r)
		if !ok {
			return
		}
		var body app.WorkInput
		if e := a.decode(w, r, &body); e != nil {
			a.write(w, r, 400, nil, e)
			return
		}
		work, created, e := s.CreateWork(r.Context(), u.User.ID, r.Header.Get("Idempotency-Key"), body)
		status := 200
		if created {
			status = 201
		}
		a.write(w, r, status, work, e)
	})
	mux.HandleFunc("GET /api/v1/works/{workId}", func(w http.ResponseWriter, r *http.Request) {
		u, ok := a.user(w, r)
		if !ok {
			return
		}
		work, e := s.Repo.GetWork(r.Context(), u.User.ID, r.PathValue("workId"))
		a.write(w, r, 200, work, e)
	})
	mux.HandleFunc("PUT /api/v1/works/{workId}", func(w http.ResponseWriter, r *http.Request) {
		u, ok := a.user(w, r)
		if !ok {
			return
		}
		var body app.WorkInput
		if e := a.decode(w, r, &body); e != nil {
			a.write(w, r, 400, nil, e)
			return
		}
		work, e := s.UpdateWork(r.Context(), u.User.ID, r.PathValue("workId"), body)
		a.write(w, r, 200, work, e)
	})
	mux.HandleFunc("PATCH /api/v1/works/{workId}", func(w http.ResponseWriter, r *http.Request) {
		u, ok := a.user(w, r)
		if !ok {
			return
		}
		var body struct {
			Name         string `json:"name"`
			BaseRevision int64  `json:"baseRevision"`
		}
		if e := a.decode(w, r, &body); e != nil {
			a.write(w, r, 400, nil, e)
			return
		}
		work, e := s.RenameWork(r.Context(), u.User.ID, r.PathValue("workId"), body.Name, body.BaseRevision)
		a.write(w, r, 200, work, e)
	})
	mux.HandleFunc("DELETE /api/v1/works/{workId}", func(w http.ResponseWriter, r *http.Request) {
		u, ok := a.user(w, r)
		if !ok {
			return
		}
		base, e := strconv.ParseInt(r.URL.Query().Get("baseRevision"), 10, 64)
		if e != nil || base < 1 {
			a.write(w, r, 400, nil, domain.Fail(400, "INVALID_ARGUMENT", "需要有效的作品版本"))
			return
		}
		e = s.Repo.DeleteWork(r.Context(), u.User.ID, r.PathValue("workId"), base)
		a.write(w, r, 200, map[string]bool{"deleted": true}, e)
	})
	mux.HandleFunc("GET /api/v1/works", func(w http.ResponseWriter, r *http.Request) {
		u, ok := a.user(w, r)
		if !ok {
			return
		}
		limit := 20
		if q := r.URL.Query().Get("limit"); q != "" {
			n, e := strconv.Atoi(q)
			if e != nil || n < 1 || n > 50 {
				a.write(w, r, 400, nil, domain.Fail(400, "INVALID_ARGUMENT", "分页数量需要 1 至 50"))
				return
			}
			limit = n
		}
		var cursor struct {
			MS int64  `json:"ms"`
			ID string `json:"id"`
		}
		if q := r.URL.Query().Get("cursor"); q != "" {
			b, e := base64.RawURLEncoding.DecodeString(q)
			if e != nil || json.Unmarshal(b, &cursor) != nil || cursor.MS <= 0 || cursor.ID == "" {
				a.write(w, r, 400, nil, domain.Fail(400, "INVALID_ARGUMENT", "分页游标无效"))
				return
			}
		}
		items, e := s.Repo.ListWorks(r.Context(), u.User.ID, limit+1, cursor.MS, cursor.ID)
		var next any
		if len(items) > limit {
			items = items[:limit]
			last := items[len(items)-1]
			cursor.MS = last.UpdatedMS
			cursor.ID = last.ID
			b, _ := json.Marshal(cursor)
			next = base64.RawURLEncoding.EncodeToString(b)
		}
		a.write(w, r, 200, map[string]any{"items": items, "nextCursor": next}, e)
	})
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		a.write(w, r, 404, nil, domain.Fail(404, "NOT_FOUND", "接口不存在"))
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" && r.Method != "HEAD" {
			a.write(w, r, 405, nil, domain.Fail(405, "METHOD_NOT_ALLOWED", "请求方法不支持"))
			return
		}
		dir := s.Config.WebDir
		cleaned := filepath.Clean("/" + r.URL.Path)
		path := filepath.Join(dir, cleaned)
		if st, e := os.Stat(path); e != nil || st.IsDir() {
			path = filepath.Join(dir, "index.html")
		}
		if _, e := os.Stat(path); e != nil {
			http.Error(w, "Frontend not built. Run npm run build in the workspace root.", 503)
			return
		}
		if strings.HasSuffix(path, "index.html") || strings.HasSuffix(path, "sw.js") {
			w.Header().Set("Cache-Control", "no-cache")
		}
		if strings.HasSuffix(path, ".webmanifest") {
			w.Header().Set("Content-Type", "application/manifest+json")
		}
		http.ServeFile(w, r, path)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-ID")
		if len(id) > 80 || id == "" {
			id, _ = domain.NewID("req")
		}
		r = r.WithContext(context.WithValue(r.Context(), requestKey, id))
		w.Header().Set("X-Request-ID", id)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		defer func() {
			if e := recover(); e != nil {
				slog.Error("panic", "requestId", id, "error", e)
				a.write(w, r, 500, nil, errors.New("panic"))
			}
		}()
		if strings.HasPrefix(r.URL.Path, "/api/") && r.Method != "GET" && r.Method != "HEAD" {
			origin := r.Header.Get("Origin")
			allowed := origin == s.Config.PublicOrigin
			for _, extra := range s.Config.AdditionalOrigins {
				allowed = allowed || origin == extra
			}
			if !allowed {
				a.write(w, r, 403, nil, domain.Fail(403, "ORIGIN_FORBIDDEN", "请从正确的公开地址打开应用"))
				return
			}
		}
		mux.ServeHTTP(w, r)
	})
}
func clientIP(r *http.Request) string {
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	ip := net.ParseIP(host)
	if ip != nil && ip.IsLoopback() {
		forward := strings.Split(r.Header.Get("X-Forwarded-For"), ",")[0]
		if p := net.ParseIP(strings.TrimSpace(forward)); p != nil {
			return p.String()
		}
	}
	return host
}

type attempt struct {
	Count int
	Until time.Time
}
type limiter struct {
	mu    sync.Mutex
	items map[string]attempt
}

func (l *limiter) allow(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	for key, v := range l.items {
		if now.After(v.Until) {
			delete(l.items, key)
		}
	}
	v := l.items[ip]
	return v.Count < 10
}
func (l *limiter) failed(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	v := l.items[ip]
	if time.Now().After(v.Until) {
		v = attempt{Until: time.Now().Add(5 * time.Minute)}
	}
	v.Count++
	l.items[ip] = v
}
