package config

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	HTTPAddr, DBPath, PublicOrigin, WebDir string
	AdditionalOrigins                      []string
	CookieSecure                           bool
	SessionTTL                             time.Duration
	MaxWorksPerUser, MaxWorkBytes          int
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
func Load() (Config, error) {
	c := Config{HTTPAddr: env("HTTP_ADDR", "127.0.0.1:8080"), DBPath: env("DB_PATH", "./data/pindou.db"), PublicOrigin: env("PUBLIC_ORIGIN", "http://localhost:5173"), WebDir: env("WEB_DIR", "../web/dist"), MaxWorksPerUser: 200, MaxWorkBytes: 2097152}
	var err error
	c.CookieSecure, err = strconv.ParseBool(env("COOKIE_SECURE", "true"))
	if err != nil {
		return c, err
	}
	c.SessionTTL, err = time.ParseDuration(env("SESSION_TTL", "720h"))
	if err != nil || c.SessionTTL <= 0 {
		return c, fmt.Errorf("invalid SESSION_TTL")
	}
	for _, item := range []struct {
		key   string
		value *int
	}{{"MAX_WORKS_PER_USER", &c.MaxWorksPerUser}, {"MAX_WORK_BYTES", &c.MaxWorkBytes}} {
		*item.value, err = strconv.Atoi(env(item.key, strconv.Itoa(*item.value)))
		if err != nil || *item.value < 1 {
			return c, fmt.Errorf("invalid %s", item.key)
		}
	}
	if extra := os.Getenv("ADDITIONAL_ORIGINS"); extra != "" {
		c.AdditionalOrigins = strings.Split(extra, ",")
	}
	for _, origin := range append([]string{c.PublicOrigin}, c.AdditionalOrigins...) {
		u, e := url.Parse(origin)
		if e != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
			return c, fmt.Errorf("invalid origin %q", origin)
		}
	}
	return c, nil
}
