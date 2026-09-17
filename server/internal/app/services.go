package app

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"pindou/server/internal/config"
	"pindou/server/internal/domain"
	"pindou/server/internal/repository/sqlite"
	"pindou/server/internal/security"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

type Services struct {
	Repo   *sqlite.Repository
	Config config.Config
	hashes chan struct{}
}

func New(repo *sqlite.Repository, c config.Config) *Services {
	return &Services{repo, c, make(chan struct{}, 4)}
}
func (s *Services) Colors(ctx context.Context) (any, error) {
	items, err := s.Repo.Colors(ctx)
	if err != nil {
		return nil, err
	}
	b, err := json.Marshal(items)
	if err != nil {
		return nil, err
	}
	hash := sha256.Sum256(b)
	return map[string]any{"items": items, "version": "sha256:" + hex.EncodeToString(hash[:])}, nil
}

type AuthResult struct {
	User      domain.User `json:"user"`
	ExpiresAt string      `json:"expiresAt"`
	Token     string      `json:"-"`
}

func (s *Services) Authenticate(ctx context.Context, username, password string, register bool) (AuthResult, error) {
	username = strings.ToLower(strings.TrimSpace(username))
	if !regexp.MustCompile("^[a-z0-9_]{3,32}$").MatchString(username) {
		return AuthResult{}, domain.Fail(400, "AUTH_USERNAME_INVALID", "用户名需要 3 至 32 位字母、数字或下划线")
	}
	if !utf8.ValidString(password) || utf8.RuneCountInString(password) < 8 || utf8.RuneCountInString(password) > 72 {
		return AuthResult{}, domain.Fail(400, "AUTH_PASSWORD_WEAK", "密码需要 8 至 72 个字符")
	}
	select {
	case s.hashes <- struct{}{}:
		defer func() { <-s.hashes }()
	default:
		return AuthResult{}, domain.Fail(429, "RATE_LIMITED", "请求较多，请稍后重试")
	}
	var u domain.User
	var err error
	if register {
		u.ID, err = domain.NewID("usr")
		if err != nil {
			return AuthResult{}, err
		}
		u.Username = username
		u.PasswordHash, err = security.Hash(password)
		if err != nil {
			return AuthResult{}, err
		}
	} else {
		u, err = s.Repo.FindUser(ctx, username)
		if errors.Is(err, sql.ErrNoRows) {
			security.Hash(password)
			return AuthResult{}, domain.Fail(401, "AUTH_INVALID_CREDENTIALS", "用户名或密码错误")
		}
		if err != nil {
			return AuthResult{}, err
		}
		if !security.Verify(password, u.PasswordHash) {
			return AuthResult{}, domain.Fail(401, "AUTH_INVALID_CREDENTIALS", "用户名或密码错误")
		}
	}
	token, err := security.NewToken()
	if err != nil {
		return AuthResult{}, err
	}
	now := time.Now()
	session := domain.Session{TokenHash: security.TokenHash(token), UserID: u.ID, CreatedAt: now.UnixMilli(), ExpiresAt: now.Add(s.Config.SessionTTL).UnixMilli()}
	if register {
		err = s.Repo.CreateAccount(ctx, u, session)
		if err != nil && strings.Contains(err.Error(), "UNIQUE constraint") {
			return AuthResult{}, domain.Fail(409, "AUTH_USERNAME_TAKEN", "用户名已被使用")
		}
	} else {
		err = s.Repo.CreateSession(ctx, session)
	}
	if err != nil {
		return AuthResult{}, err
	}
	return AuthResult{u, domain.TimeString(session.ExpiresAt), token}, nil
}
func (s *Services) ResolveSession(ctx context.Context, token string) (AuthResult, error) {
	if token == "" {
		return AuthResult{}, domain.Fail(401, "AUTH_REQUIRED", "请先登录")
	}
	u, expires, err := s.Repo.SessionUser(ctx, security.TokenHash(token))
	if errors.Is(err, sql.ErrNoRows) {
		return AuthResult{}, domain.Fail(401, "AUTH_REQUIRED", "请先登录")
	}
	if err != nil {
		return AuthResult{}, err
	}
	if expires <= time.Now().UnixMilli() {
		s.Repo.DeleteSession(ctx, security.TokenHash(token))
		return AuthResult{}, domain.Fail(401, "AUTH_SESSION_EXPIRED", "登录已过期，请重新登录")
	}
	return AuthResult{User: u, ExpiresAt: domain.TimeString(expires)}, nil
}

type WorkInput struct {
	Name            string              `json:"name"`
	Snapshot        domain.WorkSnapshot `json:"snapshot"`
	BaseRevision    int64               `json:"baseRevision"`
	ClientUpdatedAt string              `json:"clientUpdatedAt"`
}

func (s *Services) validateWork(ctx context.Context, input *WorkInput) error {
	name, err := domain.NormalizeName(input.Name)
	if err != nil {
		return err
	}
	input.Name = name
	colors, err := s.Repo.Colors(ctx)
	if err != nil {
		return err
	}
	return domain.ValidateSnapshot(&input.Snapshot, sqlite.KnownColors(colors), s.Config.MaxWorkBytes)
}
func (s *Services) CreateWork(ctx context.Context, userID, key string, input WorkInput) (domain.Work, bool, error) {
	if !regexp.MustCompile("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$").MatchString(key) {
		return domain.Work{}, false, domain.Fail(400, "INVALID_ARGUMENT", "需要有效的创建幂等键")
	}
	if err := s.validateWork(ctx, &input); err != nil {
		return domain.Work{}, false, err
	}
	id, err := domain.NewID("wrk")
	if err != nil {
		return domain.Work{}, false, err
	}
	hash, err := domain.HashWorkContent(input.Name, input.Snapshot)
	if err != nil {
		return domain.Work{}, false, err
	}
	return s.Repo.CreateWork(ctx, domain.Work{ID: id, UserID: userID, Name: input.Name, Snapshot: input.Snapshot, ContentHash: hash, CreateKey: key}, s.Config.MaxWorksPerUser)
}
func (s *Services) UpdateWork(ctx context.Context, userID, id string, input WorkInput) (domain.Work, error) {
	if input.BaseRevision < 1 {
		return domain.Work{}, domain.Fail(400, "INVALID_ARGUMENT", "需要有效的作品版本")
	}
	if err := s.validateWork(ctx, &input); err != nil {
		return domain.Work{}, err
	}
	return s.Repo.UpdateWork(ctx, userID, id, input.BaseRevision, input.Name, &input.Snapshot)
}
func (s *Services) RenameWork(ctx context.Context, userID, id, name string, base int64) (domain.Work, error) {
	name, err := domain.NormalizeName(name)
	if err != nil {
		return domain.Work{}, err
	}
	if base < 1 {
		return domain.Work{}, domain.Fail(400, "INVALID_ARGUMENT", "需要有效的作品版本")
	}
	return s.Repo.UpdateWork(ctx, userID, id, base, name, nil)
}
