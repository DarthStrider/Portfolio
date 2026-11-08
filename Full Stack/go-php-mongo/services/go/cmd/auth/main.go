// Command auth runs auth-service: accounts, sign-in and roles. It owns the JWT signing key.
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"time"

	"shop/internal/auth"
	"shop/internal/platform/config"
	"shop/internal/platform/httpx"
	"shop/internal/platform/mail"
	"shop/internal/platform/mongox"
	"shop/internal/platform/server"
	"shop/internal/platform/token"
)

func main() {
	server.Logger("auth-service")
	if err := run(); err != nil {
		slog.Error("auth-service stopped", "err", err)
		os.Exit(1)
	}
}

func run() error {
	ctx, stop := server.SignalContext()
	defer stop()

	key, err := token.LoadOrCreateKey(config.Get("JWT_KEY_DIR", "/keys"))
	if err != nil {
		return err
	}
	client, db, err := mongox.Connect(ctx, config.Must("MONGO_URI"), config.Get("MONGO_DB", "auth_db"), time.Minute)
	if err != nil {
		return err
	}
	defer client.Disconnect(context.Background())

	store, err := auth.NewMongoStore(ctx, db)
	if err != nil {
		return err
	}
	var sender mail.Sender = mail.Log{}
	if addr := config.Get("SMTP_ADDR", ""); addr != "" {
		sender = mail.SMTP{Addr: addr, From: config.Get("MAIL_FROM", "Northline Shop <shop@example.test>")}
	}
	svc := &auth.Service{
		Store:      store,
		Signer:     token.NewSigner(key),
		Mail:       sender,
		AppURL:     config.Get("APP_URL", "http://localhost:8090"),
		AccessTTL:  config.Duration("ACCESS_TTL", 15*time.Minute),
		RefreshTTL: config.Duration("REFRESH_TTL", 30*24*time.Hour),
		Now:        time.Now,
	}
	if err := svc.EnsureAdmin(ctx, config.Get("ADMIN_EMAIL", ""), config.Get("ADMIN_PASSWORD", "")); err != nil {
		return err
	}

	mux := http.NewServeMux()
	(&auth.Handlers{Svc: svc, SecureCookie: config.Bool("SECURE_COOKIES", false)}).Routes(mux)
	mux.HandleFunc("GET /healthz", server.Health(func(ctx context.Context) error { return client.Ping(ctx, nil) }))

	verifier := token.NewVerifier(&key.PublicKey)
	return server.Run(ctx, config.Get("ADDR", ":8080"), httpx.Middleware(httpx.Authenticate(verifier, mux)))
}
