package domain

import (
	"strings"
	"testing"
)

func TestSnapshotValidation(t *testing.T) {
	s := WorkSnapshot{SchemaVersion: 1, Width: 2, Height: 2, Cells: []Cell{{X: 1, Y: 1, ColorCode: "H7"}, {X: 0, Y: 0, ColorCode: "H7"}}}
	if err := ValidateSnapshot(&s, map[string]bool{"H7": true}, 2097152); err != nil {
		t.Fatal(err)
	}
	if s.Cells[0].X != 0 {
		t.Fatal("not canonical")
	}
	h, _ := HashWorkContent("test", s)
	if !strings.HasPrefix(h, "sha256:") || len(h) != 71 {
		t.Fatal("bad digest")
	}
	s.Cells = append(s.Cells, s.Cells[0])
	if err := ValidateSnapshot(&s, map[string]bool{"H7": true}, 2097152); err == nil {
		t.Fatal("accepted duplicates")
	}
	if _, err := NormalizeName(strings.Repeat("豆", 81)); err == nil {
		t.Fatal("accepted too long name")
	}
}

func TestCustomRGBColors(t *testing.T) {
	for _, code := range []string{"#1a2b3c", "#ABCDEF", "#000000"} {
		s := WorkSnapshot{SchemaVersion: 1, Width: 1, Height: 1, Cells: []Cell{{X: 0, Y: 0, ColorCode: code}}}
		if err := ValidateSnapshot(&s, nil, 2097152); err != nil {
			t.Fatal(err)
		}
		if s.Cells[0].ColorCode != strings.ToUpper(code) {
			t.Fatal("custom color not canonical")
		}
	}
	for _, code := range []string{"#abc", "#GG1234", "rgb(1,2,3)", "#12345678", "unknown"} {
		s := WorkSnapshot{SchemaVersion: 1, Width: 1, Height: 1, Cells: []Cell{{X: 0, Y: 0, ColorCode: code}}}
		if err := ValidateSnapshot(&s, nil, 2097152); err == nil {
			t.Fatal("accepted invalid color", code)
		}
	}
}
