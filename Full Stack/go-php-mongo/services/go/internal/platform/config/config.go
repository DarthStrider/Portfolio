// Package config reads settings from environment variables, the way Docker Compose passes them in.
package config

import (
	"log/slog"
	"os"
	"strconv"
	"time"
)

// Get returns the variable, or def when it is unset or empty.
func Get(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// Must returns the variable or stops the process: a service that starts without
// its database URL would only fail later, with a less useful message.
func Must(key string) string {
	v := os.Getenv(key)
	if v == "" {
		slog.Error("missing required environment variable", "key", key)
		os.Exit(1)
	}
	return v
}

// Bool reads "true"/"1" style flags.
func Bool(key string, def bool) bool {
	v, err := strconv.ParseBool(os.Getenv(key))
	if err != nil {
		return def
	}
	return v
}

// Duration reads values like "15m" or "720h".
func Duration(key string, def time.Duration) time.Duration {
	v, err := time.ParseDuration(os.Getenv(key))
	if err != nil {
		return def
	}
	return v
}
