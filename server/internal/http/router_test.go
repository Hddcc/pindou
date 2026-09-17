package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"pindou/server/internal/app"
	"pindou/server/internal/config"
	"pindou/server/internal/domain"
	"pindou/server/internal/repository/sqlite"
	"strings"
	"testing"
	"time"
)

type testClient struct {
	t      *testing.T
	server *httptest.Server
	cookie *http.Cookie
}

func (c *testClient) call(method, path string, body any, key, origin string) (int, envelope) {
	c.t.Helper()
	var data []byte
	if raw, ok := body.(string); ok {
		data = []byte(raw)
	} else if body != nil {
		data, _ = json.Marshal(body)
	}
	req, _ := http.NewRequest(method, c.server.URL+"/api/v1"+path, bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	req.Header.Set("Idempotency-Key", key)
	if c.cookie != nil {
		req.AddCookie(c.cookie)
	}
	resp, err := c.server.Client().Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer resp.Body.Close()
	for _, cookie := range resp.Cookies() {
		if cookie.Name == "pindou_session" {
			c.cookie = cookie
		}
	}
	var e envelope
	if err = json.NewDecoder(resp.Body).Decode(&e); err != nil {
		c.t.Fatal(err)
	}
	if e.RequestID == "" {
		c.t.Fatal("missing request id")
	}
	return resp.StatusCode, e
}
func decodeWork(t *testing.T, e envelope) domain.Work {
	t.Helper()
	b, _ := json.Marshal(e.Data)
	var w domain.Work
	if err := json.Unmarshal(b, &w); err != nil {
		t.Fatal(err)
	}
	return w
}
func assertCode(t *testing.T, status int, e envelope, wantStatus int, wantCode string) {
	t.Helper()
	if status != wantStatus || e.Code != wantCode {
		t.Fatalf("got %d %s (%s), want %d %s", status, e.Code, e.Message, wantStatus, wantCode)
	}
}
func setup(t *testing.T) (*testClient, *sqlite.Repository, config.Config) {
	t.Helper()
	repo, err := sqlite.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { repo.DB.Close() })
	if err = repo.SeedDefaultColors(context.Background()); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{PublicOrigin: "http://localhost:5173", SessionTTL: time.Hour, MaxWorksPerUser: 2, MaxWorkBytes: 2097152, WebDir: t.TempDir()}
	server := httptest.NewServer(NewRouter(app.New(repo, cfg)))
	t.Cleanup(server.Close)
	return &testClient{t: t, server: server}, repo, cfg
}
func TestAccountAndWorks(t *testing.T) {
	c, repo, cfg := setup(t)
	origin := cfg.PublicOrigin
	status, e := c.call("GET", "/colors", nil, "", "")
	assertCode(t, status, e, 200, "OK")
	status, e = c.call("GET", "/me", nil, "", "")
	assertCode(t, status, e, 401, "AUTH_REQUIRED")
	credentials := map[string]string{"username": "creator", "password": "test-password"}
	status, e = c.call("POST", "/auth/register", credentials, "", origin)
	assertCode(t, status, e, 201, "OK")
	if c.cookie == nil || !c.cookie.HttpOnly || c.cookie.SameSite != http.SameSiteLaxMode {
		t.Fatal("unsafe session cookie")
	}
	originalCookie := c.cookie
	input := app.WorkInput{Name: "第一张", Snapshot: domain.WorkSnapshot{SchemaVersion: 1, Width: 16, Height: 16, Cells: []domain.Cell{{X: 1, Y: 1, ColorCode: "H7"}}}}
	key := "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	status, e = c.call("POST", "/works", input, key, origin)
	assertCode(t, status, e, 201, "OK")
	first := decodeWork(t, e)
	status, e = c.call("POST", "/works", input, key, origin)
	assertCode(t, status, e, 200, "OK")
	if decodeWork(t, e).ID != first.ID {
		t.Fatal("duplicate work")
	}
	input.Name = "第二版"
	input.BaseRevision = 1
	status, e = c.call("PUT", "/works/"+first.ID, input, "", origin)
	assertCode(t, status, e, 200, "OK")
	second := decodeWork(t, e)
	if second.Revision != 2 {
		t.Fatal("revision not advanced")
	}
	status, e = c.call("PUT", "/works/"+first.ID, input, "", origin)
	assertCode(t, status, e, 200, "OK")
	if decodeWork(t, e).Revision != 2 {
		t.Fatal("retry incremented revision")
	}
	input.Name = "旧设备修改"
	status, e = c.call("PUT", "/works/"+first.ID, input, "", origin)
	assertCode(t, status, e, 409, "WORK_VERSION_CONFLICT")
	status, e = c.call("DELETE", "/works/"+first.ID+"?baseRevision=1", nil, "", origin)
	assertCode(t, status, e, 409, "WORK_VERSION_CONFLICT")
	status, e = c.call("PATCH", "/works/"+first.ID, map[string]any{"name": "重命名", "baseRevision": 2}, "", origin)
	assertCode(t, status, e, 200, "OK")
	status, e = c.call("GET", "/works?limit=1", nil, "", "")
	assertCode(t, status, e, 200, "OK")
	owner := c.cookie
	c.cookie = nil
	status, e = c.call("POST", "/auth/register", map[string]string{"username": "other", "password": "test-password"}, "", origin)
	assertCode(t, status, e, 201, "OK")
	for _, method := range []string{"GET", "PUT", "PATCH", "DELETE"} {
		body := any(nil)
		path := "/works/" + first.ID
		if method == "PUT" {
			body = input
		}
		if method == "PATCH" {
			body = map[string]any{"name": "changed", "baseRevision": 3}
		}
		if method == "DELETE" {
			path += "?baseRevision=3"
		}
		status, e = c.call(method, path, body, "", origin)
		assertCode(t, status, e, 404, "WORK_NOT_FOUND")
	}
	c.cookie = owner
	status, e = c.call("DELETE", "/works/"+first.ID+"?baseRevision=3", nil, "", origin)
	assertCode(t, status, e, 200, "OK")
	status, e = c.call("GET", "/works/"+first.ID, nil, "", "")
	assertCode(t, status, e, 404, "WORK_NOT_FOUND")
	status, e = c.call("POST", "/auth/logout", nil, "", origin)
	assertCode(t, status, e, 200, "OK")
	c.cookie = originalCookie
	status, e = c.call("GET", "/me", nil, "", "")
	assertCode(t, status, e, 401, "AUTH_REQUIRED")
	c.cookie = nil
	status, e = c.call("POST", "/auth/login", credentials, "", origin)
	assertCode(t, status, e, 200, "OK")
	var count int
	repo.DB.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	if count != 2 {
		t.Fatal("accounts not persisted")
	}
}
func TestInvalidInputAndLimits(t *testing.T) {
	c, _, cfg := setup(t)
	origin := cfg.PublicOrigin
	creds := map[string]string{"username": "creator", "password": "test-password"}
	status, e := c.call("POST", "/auth/register", creds, "", "http://evil.test")
	assertCode(t, status, e, 403, "ORIGIN_FORBIDDEN")
	status, e = c.call("POST", "/auth/register", creds, "", "")
	assertCode(t, status, e, 403, "ORIGIN_FORBIDDEN")
	status, e = c.call("POST", "/auth/register", creds, "", origin)
	assertCode(t, status, e, 201, "OK")
	status, e = c.call("POST", "/auth/register", creds, "", origin)
	assertCode(t, status, e, 409, "AUTH_USERNAME_TAKEN")
	status, e = c.call("POST", "/auth/login", map[string]string{"username": "creator", "password": "wrong-password"}, "", origin)
	assertCode(t, status, e, 401, "AUTH_INVALID_CREDENTIALS")
	status, e = c.call("POST", "/works", "{}{}", "", origin)
	assertCode(t, status, e, 400, "INVALID_JSON")
	status, e = c.call("POST", "/works", `{"name":"`+strings.Repeat("x", 3*1024*1024)+`"}`, "", origin)
	assertCode(t, status, e, 413, "PAYLOAD_TOO_LARGE")
	input := app.WorkInput{Name: "test", Snapshot: domain.WorkSnapshot{SchemaVersion: 1, Width: 200, Height: 200, Cells: []domain.Cell{}}}
	key := "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	input.Snapshot.Cells = []domain.Cell{{X: 200, Y: 0, ColorCode: "H7"}}
	status, e = c.call("POST", "/works", input, key, origin)
	assertCode(t, status, e, 400, "WORK_SNAPSHOT_INVALID")
	input.Snapshot.Cells = []domain.Cell{{X: 0, Y: 0, ColorCode: "UNKNOWN"}}
	status, e = c.call("POST", "/works", input, key, origin)
	assertCode(t, status, e, 400, "WORK_COLOR_UNKNOWN")
	input.Snapshot.Cells = []domain.Cell{}
	status, e = c.call("POST", "/works", input, key, origin)
	assertCode(t, status, e, 201, "OK")
	status, e = c.call("POST", "/works", input, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", origin)
	assertCode(t, status, e, 201, "OK")
	status, e = c.call("GET", "/works?limit=1", nil, "", "")
	assertCode(t, status, e, 200, "OK")
	data := e.Data.(map[string]any)
	cursor := data["nextCursor"].(string)
	status, e = c.call("GET", "/works?limit=1&cursor="+cursor, nil, "", "")
	assertCode(t, status, e, 200, "OK")
	if len(e.Data.(map[string]any)["items"].([]any)) != 1 {
		t.Fatal("bad pagination")
	}
	status, e = c.call("POST", "/works", input, "cccccccc-cccc-4ccc-8ccc-cccccccccccc", origin)
	assertCode(t, status, e, 409, "WORK_LIMIT_REACHED")
	status, e = c.call("GET", "/works?limit=99", nil, "", "")
	assertCode(t, status, e, 400, "INVALID_ARGUMENT")
}

func TestCustomColorCloudRoundTrip(t *testing.T) {
	c, _, cfg := setup(t)
	status, e := c.call("POST", "/auth/register", map[string]string{"username": "rgb_creator", "password": "test-password"}, "", cfg.PublicOrigin)
	assertCode(t, status, e, 201, "OK")
	input := app.WorkInput{Name: "RGB test", Snapshot: domain.WorkSnapshot{SchemaVersion: 1, Width: 2, Height: 2, Cells: []domain.Cell{{X: 0, Y: 0, ColorCode: "#1a2b3c"}}}}
	status, e = c.call("POST", "/works", input, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", cfg.PublicOrigin)
	assertCode(t, status, e, 201, "OK")
	w := decodeWork(t, e)
	status, e = c.call("GET", "/works/"+w.ID, nil, "", "")
	assertCode(t, status, e, 200, "OK")
	if decodeWork(t, e).Snapshot.Cells[0].ColorCode != "#1A2B3C" {
		t.Fatal("custom RGB color lost in cloud round trip")
	}
}
func TestStaticAssetsAndHealth(t *testing.T) {
	c, _, cfg := setup(t)
	if err := os.WriteFile(filepath.Join(cfg.WebDir, "index.html"), []byte("<html>editor</html>"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(cfg.WebDir, "icon.png"), []byte("image"), 0600); err != nil {
		t.Fatal(err)
	}
	for path, want := range map[string]string{"/": "editor", "/editor": "editor", "/icon.png": "image"} {
		resp, err := c.server.Client().Get(c.server.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != 200 || !strings.Contains(string(body), want) {
			t.Fatalf("static %s: %d %s", path, resp.StatusCode, body)
		}
	}
	status, e := c.call("GET", "/healthz", nil, "", "")
	assertCode(t, status, e, 200, "OK")
}
