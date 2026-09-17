package domain

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"encoding/hex"
	"encoding/json"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

type Cell struct {
	X         int    `json:"x"`
	Y         int    `json:"y"`
	ColorCode string `json:"colorCode"`
}
type WorkSnapshot struct {
	SchemaVersion int    `json:"schemaVersion"`
	Width         int    `json:"width"`
	Height        int    `json:"height"`
	Cells         []Cell `json:"cells"`
}
type Work struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Snapshot    WorkSnapshot `json:"snapshot"`
	ContentHash string       `json:"contentHash"`
	Revision    int64        `json:"revision"`
	CreatedAt   string       `json:"createdAt"`
	UpdatedAt   string       `json:"updatedAt"`
	UserID      string       `json:"-"`
	CreateKey   string       `json:"-"`
}
type Color struct {
	Code      string `json:"code"`
	Name      string `json:"name"`
	Hex       string `json:"hex"`
	SortOrder int    `json:"sortOrder"`
	Active    bool   `json:"active"`
}
type User struct {
	ID           string `json:"id"`
	Username     string `json:"username"`
	PasswordHash string `json:"-"`
}
type Session struct {
	TokenHash string
	UserID    string
	ExpiresAt int64
	CreatedAt int64
}

func NewID(prefix string) (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return prefix + "_" + strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b)), nil
}
func TimeString(ms int64) string { return time.UnixMilli(ms).UTC().Format(time.RFC3339Nano) }
func NormalizeName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if !utf8.ValidString(name) || utf8.RuneCountInString(name) < 1 || utf8.RuneCountInString(name) > 80 {
		return "", Fail(400, "WORK_NAME_INVALID", "作品名称需要 1 至 80 个字符")
	}
	return name, nil
}
func ValidateSnapshot(s *WorkSnapshot, colors map[string]bool, maxBytes int) error {
	if s.SchemaVersion != 1 {
		return Fail(400, "WORK_SNAPSHOT_INVALID", "作品格式版本不受支持")
	}
	if s.Width < 1 || s.Width > 200 || s.Height < 1 || s.Height > 200 {
		return Fail(400, "WORK_SIZE_INVALID", "画布宽高需要在 1 至 200 格之间")
	}
	if len(s.Cells) > s.Width*s.Height {
		return Fail(400, "WORK_SNAPSHOT_INVALID", "格子数量无效")
	}
	seen := map[int]bool{}
	for i, c := range s.Cells {
		key := c.Y*s.Width + c.X
		if c.X < 0 || c.X >= s.Width || c.Y < 0 || c.Y >= s.Height || seen[key] {
			return Fail(400, "WORK_SNAPSHOT_INVALID", "存在越界或重复的格子")
		}
		seen[key] = true
		if !colors[c.ColorCode] {
			if len(c.ColorCode) == 7 && c.ColorCode[0] == '#' {
				if _, err := hex.DecodeString(c.ColorCode[1:]); err == nil {
					s.Cells[i].ColorCode = strings.ToUpper(c.ColorCode)
					continue
				}
			}
			return Fail(400, "WORK_COLOR_UNKNOWN", "作品包含未知色号："+c.ColorCode)
		}
	}
	if s.Cells == nil {
		s.Cells = []Cell{}
	}
	sort.Slice(s.Cells, func(i, j int) bool {
		return s.Cells[i].Y < s.Cells[j].Y || (s.Cells[i].Y == s.Cells[j].Y && s.Cells[i].X < s.Cells[j].X)
	})
	b, err := json.Marshal(s)
	if err != nil {
		return err
	}
	if len(b) > maxBytes {
		return Fail(413, "PAYLOAD_TOO_LARGE", "作品超过大小上限")
	}
	return nil
}
func HashWorkContent(name string, s WorkSnapshot) (string, error) {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(struct {
		Name     string       `json:"name"`
		Snapshot WorkSnapshot `json:"snapshot"`
	}{name, s}); err != nil {
		return "", err
	}
	sum := sha256.Sum256(bytes.TrimSuffix(b.Bytes(), []byte("\n")))
	return "sha256:" + hex.EncodeToString(sum[:]), nil
}
