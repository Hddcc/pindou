package main

import (
	"context"
	"flag"
	"log"
	"os"
	"path/filepath"
	"pindou/server/internal/config"
	"pindou/server/internal/repository/sqlite"
	"strings"
	"time"
)

func main() {
	dir := flag.String("dir", "./backups", "dedicated backup directory")
	flag.Parse()
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	if _, err = os.Stat(cfg.DBPath); err != nil {
		log.Fatal(err)
	}
	absolute, err := filepath.Abs(*dir)
	if err != nil {
		log.Fatal(err)
	}
	if err = os.MkdirAll(absolute, 0700); err != nil {
		log.Fatal(err)
	}
	repo, err := sqlite.Open(cfg.DBPath)
	if err != nil {
		log.Fatal(err)
	}
	defer repo.DB.Close()
	target := filepath.Join(absolute, "pindou-"+time.Now().UTC().Format("20060102-150405.000000000")+".db")
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	if _, err = repo.DB.ExecContext(ctx, "VACUUM INTO '"+strings.ReplaceAll(target, "'", "''")+"'"); err != nil {
		log.Fatal(err)
	}
	info, err := os.Stat(target)
	if err != nil || info.Size() == 0 {
		log.Fatal("Backup validation failed")
	}
	log.Printf("Backup created: %s (%d bytes)", target, info.Size())
}
