package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	_ "modernc.org/sqlite"
	"os"
	"path/filepath"
	assets "pindou/server"
	"pindou/server/internal/domain"
	"regexp"
	"time"
)

type Repository struct{ DB *sql.DB }

func Open(path string) (*Repository, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", "file:"+filepath.ToSlash(path)+"?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	r := &Repository{db}
	if err = db.Ping(); err != nil {
		db.Close()
		return nil, err
	}
	if err = r.Migrate(context.Background()); err != nil {
		db.Close()
		return nil, err
	}
	return r, nil
}
func (r *Repository) Migrate(ctx context.Context) error {
	if _, err := r.DB.ExecContext(ctx, "CREATE TABLE IF NOT EXISTS _schema_migrations(version INTEGER PRIMARY KEY,applied_at INTEGER NOT NULL)"); err != nil {
		return err
	}
	var count int
	if err := r.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM _schema_migrations WHERE version=1").Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	schema, err := assets.Files.ReadFile("migrations/001_init.sql")
	if err != nil {
		return err
	}
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, string(schema)); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO _schema_migrations VALUES(1,?)", time.Now().UnixMilli()); err != nil {
		return err
	}
	return tx.Commit()
}
func (r *Repository) SeedDefaultColors(ctx context.Context) error {
	var n int
	if err := r.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM colors").Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	b, err := assets.Files.ReadFile("data/mard291.json")
	if err != nil {
		return err
	}
	return r.ImportColors(ctx, b)
}
func (r *Repository) ImportColors(ctx context.Context, b []byte) error {
	var colors []domain.Color
	if err := json.Unmarshal(b, &colors); err != nil {
		return err
	}
	if len(colors) == 0 {
		return fmt.Errorf("empty palette")
	}
	seen := map[string]bool{}
	for _, c := range colors {
		if c.Code == "" || seen[c.Code] || !regexp.MustCompile("^#[0-9A-Fa-f]{6}$").MatchString(c.Hex) {
			return fmt.Errorf("invalid color %s", c.Code)
		}
		seen[c.Code] = true
	}
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "UPDATE colors SET active=0"); err != nil {
		return err
	}
	for _, c := range colors {
		_, err = tx.ExecContext(ctx, `INSERT INTO colors VALUES(?,?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET name=excluded.name,hex=excluded.hex,sort_order=excluded.sort_order,active=excluded.active,updated_at=excluded.updated_at`, c.Code, c.Name, c.Hex, c.SortOrder, c.Active, time.Now().UnixMilli())
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}
func (r *Repository) Colors(ctx context.Context) ([]domain.Color, error) {
	rows, err := r.DB.QueryContext(ctx, "SELECT code,name,hex,sort_order,active FROM colors ORDER BY sort_order,code")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.Color{}
	for rows.Next() {
		var c domain.Color
		if err = rows.Scan(&c.Code, &c.Name, &c.Hex, &c.SortOrder, &c.Active); err != nil {
			return nil, err
		}
		items = append(items, c)
	}
	return items, rows.Err()
}
func (r *Repository) FindUser(ctx context.Context, username string) (domain.User, error) {
	var u domain.User
	err := r.DB.QueryRowContext(ctx, "SELECT id,username,password_hash FROM users WHERE username=?", username).Scan(&u.ID, &u.Username, &u.PasswordHash)
	return u, err
}
func (r *Repository) CreateAccount(ctx context.Context, u domain.User, s domain.Session) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, "INSERT INTO users VALUES(?,?,?,?,?)", u.ID, u.Username, u.PasswordHash, s.CreatedAt, s.CreatedAt)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO sessions VALUES(?,?,?,?)", s.TokenHash, s.UserID, s.ExpiresAt, s.CreatedAt)
	if err != nil {
		return err
	}
	return tx.Commit()
}
func (r *Repository) CreateSession(ctx context.Context, s domain.Session) error {
	_, err := r.DB.ExecContext(ctx, "INSERT INTO sessions VALUES(?,?,?,?)", s.TokenHash, s.UserID, s.ExpiresAt, s.CreatedAt)
	return err
}
func (r *Repository) SessionUser(ctx context.Context, hash string) (domain.User, int64, error) {
	var u domain.User
	var expires int64
	err := r.DB.QueryRowContext(ctx, "SELECT u.id,u.username,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id_hash=?", hash).Scan(&u.ID, &u.Username, &expires)
	return u, expires, err
}
func (r *Repository) DeleteSession(ctx context.Context, hash string) error {
	_, err := r.DB.ExecContext(ctx, "DELETE FROM sessions WHERE id_hash=?", hash)
	return err
}
func (r *Repository) ClearExpired(ctx context.Context) {
	r.DB.ExecContext(ctx, "DELETE FROM sessions WHERE expires_at<?", time.Now().UnixMilli())
}

const workColumns = "id,user_id,name,snapshot_json,content_hash,create_key,revision,created_at,updated_at"

type scanner interface{ Scan(...any) error }

func scanWork(row scanner) (domain.Work, error) {
	var w domain.Work
	var b string
	var created, updated int64
	err := row.Scan(&w.ID, &w.UserID, &w.Name, &b, &w.ContentHash, &w.CreateKey, &w.Revision, &created, &updated)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return w, domain.Fail(404, "WORK_NOT_FOUND", "作品不存在或已被删除")
		}
		return w, err
	}
	err = json.Unmarshal([]byte(b), &w.Snapshot)
	w.CreatedAt = domain.TimeString(created)
	w.UpdatedAt = domain.TimeString(updated)
	return w, err
}
func (r *Repository) GetWork(ctx context.Context, userID, id string) (domain.Work, error) {
	return scanWork(r.DB.QueryRowContext(ctx, "SELECT "+workColumns+" FROM works WHERE id=? AND user_id=?", id, userID))
}
func (r *Repository) CreateWork(ctx context.Context, w domain.Work, max int) (domain.Work, bool, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return w, false, err
	}
	defer tx.Rollback()
	existing, e := scanWork(tx.QueryRowContext(ctx, "SELECT "+workColumns+" FROM works WHERE user_id=? AND create_key=?", w.UserID, w.CreateKey))
	if e == nil {
		return existing, false, nil
	}
	var de *domain.Error
	if !errors.As(e, &de) || de.Code != "WORK_NOT_FOUND" {
		return w, false, e
	}
	var n int
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM works WHERE user_id=?", w.UserID).Scan(&n); err != nil {
		return w, false, err
	}
	if n >= max {
		return w, false, domain.Fail(409, "WORK_LIMIT_REACHED", "云端作品数量已达到上限")
	}
	b, err := json.Marshal(w.Snapshot)
	if err != nil {
		return w, false, err
	}
	ms := time.Now().UnixMilli()
	w.Revision = 1
	w.CreatedAt = domain.TimeString(ms)
	w.UpdatedAt = w.CreatedAt
	_, err = tx.ExecContext(ctx, `INSERT INTO works(id,user_id,name,width,height,snapshot_json,content_hash,create_key,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`, w.ID, w.UserID, w.Name, w.Snapshot.Width, w.Snapshot.Height, string(b), w.ContentHash, w.CreateKey, w.Revision, ms, ms)
	if err != nil {
		return w, false, err
	}
	return w, true, tx.Commit()
}
func (r *Repository) UpdateWork(ctx context.Context, userID, id string, base int64, name string, snapshot *domain.WorkSnapshot) (domain.Work, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return domain.Work{}, err
	}
	defer tx.Rollback()
	w, err := scanWork(tx.QueryRowContext(ctx, "SELECT "+workColumns+" FROM works WHERE id=? AND user_id=?", id, userID))
	if err != nil {
		return w, err
	}
	s := w.Snapshot
	if snapshot != nil {
		s = *snapshot
	}
	hash, err := domain.HashWorkContent(name, s)
	if err != nil {
		return w, err
	}
	if w.Revision != base {
		if hash == w.ContentHash {
			return w, nil
		}
		return w, domain.Conflict(w.Revision, w.UpdatedAt)
	}
	if hash == w.ContentHash {
		return w, nil
	}
	b, err := json.Marshal(s)
	if err != nil {
		return w, err
	}
	ms := time.Now().UnixMilli()
	_, err = tx.ExecContext(ctx, "UPDATE works SET name=?,width=?,height=?,snapshot_json=?,content_hash=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=?", name, s.Width, s.Height, string(b), hash, ms, id, userID, base)
	if err != nil {
		return w, err
	}
	w.Name = name
	w.Snapshot = s
	w.ContentHash = hash
	w.Revision++
	w.UpdatedAt = domain.TimeString(ms)
	return w, tx.Commit()
}
func (r *Repository) DeleteWork(ctx context.Context, userID, id string, base int64) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	w, err := scanWork(tx.QueryRowContext(ctx, "SELECT "+workColumns+" FROM works WHERE id=? AND user_id=?", id, userID))
	if err != nil {
		return err
	}
	if base != w.Revision {
		return domain.Conflict(w.Revision, w.UpdatedAt)
	}
	_, err = tx.ExecContext(ctx, "DELETE FROM works WHERE id=? AND user_id=? AND revision=?", id, userID, base)
	if err != nil {
		return err
	}
	return tx.Commit()
}

type Summary struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	Revision  int64  `json:"revision"`
	UpdatedAt string `json:"updatedAt"`
	UpdatedMS int64  `json:"-"`
}

func (r *Repository) ListWorks(ctx context.Context, userID string, limit int, ms int64, id string) ([]Summary, error) {
	query := "SELECT id,name,width,height,revision,updated_at FROM works WHERE user_id=?"
	args := []any{userID}
	if ms > 0 {
		query += " AND (updated_at<? OR (updated_at=? AND id<?))"
		args = append(args, ms, ms, id)
	}
	query += " ORDER BY updated_at DESC,id DESC LIMIT ?"
	args = append(args, limit)
	rows, err := r.DB.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Summary{}
	for rows.Next() {
		var s Summary
		err = rows.Scan(&s.ID, &s.Name, &s.Width, &s.Height, &s.Revision, &s.UpdatedMS)
		if err != nil {
			return nil, err
		}
		s.UpdatedAt = domain.TimeString(s.UpdatedMS)
		items = append(items, s)
	}
	return items, rows.Err()
}
func KnownColors(items []domain.Color) map[string]bool {
	m := map[string]bool{}
	for _, c := range items {
		m[c.Code] = true
	}
	return m
}
