package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"pindou/server/internal/app"
	"pindou/server/internal/config"
	httpapi "pindou/server/internal/http"
	"pindou/server/internal/repository/sqlite"
	"syscall"
	"time"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	c, err := config.Load()
	if err != nil {
		slog.Error("configuration", "error", err)
		os.Exit(1)
	}
	repo, err := sqlite.Open(c.DBPath)
	if err != nil {
		slog.Error("database", "error", err)
		os.Exit(1)
	}
	defer repo.DB.Close()
	if err = repo.SeedDefaultColors(context.Background()); err != nil {
		slog.Error("colors", "error", err)
		os.Exit(1)
	}
	services := app.New(repo, c)
	repo.ClearExpired(context.Background())
	server := &http.Server{Addr: c.HTTPAddr, Handler: httpapi.NewRouter(services), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 20 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				repo.ClearExpired(ctx)
			case <-ctx.Done():
				return
			}
		}
	}()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		server.Shutdown(shutdown)
	}()
	slog.Info("server listening", "address", c.HTTPAddr, "origin", c.PublicOrigin)
	if err = server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		slog.Error("server", "error", err)
		os.Exit(1)
	}
}
