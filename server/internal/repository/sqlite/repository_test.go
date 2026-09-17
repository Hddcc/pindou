package sqlite

import (
	"context"
	"path/filepath"
	"pindou/server/internal/domain"
	"testing"
	"time"
)

func TestReopenAndColorCompatibility(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "persist.db")
	r, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err = r.SeedDefaultColors(ctx); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UnixMilli()
	if err = r.CreateAccount(ctx, domain.User{ID: "usr_test", Username: "test", PasswordHash: "hash"}, domain.Session{TokenHash: "session", UserID: "usr_test", ExpiresAt: now + 3600000, CreatedAt: now}); err != nil {
		t.Fatal(err)
	}
	s := domain.WorkSnapshot{SchemaVersion: 1, Width: 32, Height: 32, Cells: []domain.Cell{{X: 1, Y: 1, ColorCode: "H7"}}}
	hash, _ := domain.HashWorkContent("test", s)
	if _, _, err = r.CreateWork(ctx, domain.Work{ID: "wrk_test", UserID: "usr_test", Name: "test", CreateKey: "key", Snapshot: s, ContentHash: hash}, 200); err != nil {
		t.Fatal(err)
	}
	r.DB.Close()
	r, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer r.DB.Close()
	work, err := r.GetWork(ctx, "usr_test", "wrk_test")
	if err != nil || work.ContentHash != hash {
		t.Fatalf("not persisted: %v", err)
	}
	if err = r.ImportColors(ctx, []byte(`[{"code":"A1","name":"A1","hex":"#FAF4C8","sortOrder":1,"active":true}]`)); err != nil {
		t.Fatal(err)
	}
	colors, err := r.Colors(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(colors) != 291 || !KnownColors(colors)["H7"] {
		t.Fatal("historic code removed")
	}
	for _, c := range colors {
		if c.Code == "H7" && c.Active {
			t.Fatal("old color not disabled")
		}
	}
	if err = domain.ValidateSnapshot(&s, KnownColors(colors), 2097152); err != nil {
		t.Fatal("old work rejected", err)
	}
}
