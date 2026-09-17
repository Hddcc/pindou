CREATE TABLE users (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE sessions (
 id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE colors (
 code TEXT PRIMARY KEY, name TEXT NOT NULL, hex TEXT NOT NULL,
 sort_order INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL
);
CREATE TABLE works (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL, width INTEGER NOT NULL CHECK(width BETWEEN 1 AND 200),
 height INTEGER NOT NULL CHECK(height BETWEEN 1 AND 200),
 snapshot_json TEXT NOT NULL, content_hash TEXT NOT NULL, create_key TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision > 0), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);
CREATE UNIQUE INDEX works_user_create_key_idx ON works(user_id,create_key);
CREATE INDEX works_user_updated_idx ON works(user_id,updated_at DESC,id DESC);
