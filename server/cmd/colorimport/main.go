package main

import (
	"context"
	"flag"
	"log"
	"os"
	"pindou/server/internal/config"
	"pindou/server/internal/repository/sqlite"
)

func main() {
	file := flag.String("file", "data/mard291.json", "MARD palette JSON")
	flag.Parse()
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	data, err := os.ReadFile(*file)
	if err != nil {
		log.Fatal(err)
	}
	repo, err := sqlite.Open(cfg.DBPath)
	if err != nil {
		log.Fatal(err)
	}
	defer repo.DB.Close()
	if err = repo.ImportColors(context.Background(), data); err != nil {
		log.Fatal(err)
	}
	log.Print("Palette imported; removed codes remain available for old works")
}
