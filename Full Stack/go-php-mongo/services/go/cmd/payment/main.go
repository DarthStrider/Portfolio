// Command payment runs payment-service. With STRIPE_SECRET_KEY unset it uses the mock
// provider, so the store can be demonstrated end to end with no payment account.
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"time"

	"shop/internal/payment"
	"shop/internal/platform/config"
	"shop/internal/platform/events"
	"shop/internal/platform/events/rabbit"
	"shop/internal/platform/httpx"
	"shop/internal/platform/mongox"
	"shop/internal/platform/server"
	"shop/internal/platform/token"
)

func main() {
	server.Logger("payment-service")
	if err := run(); err != nil {
		slog.Error("payment-service stopped", "err", err)
		os.Exit(1)
	}
}

func run() error {
	ctx, stop := server.SignalContext()
	defer stop()

	pub, err := token.WaitForPublicKey(config.Get("JWT_PUBLIC_KEY", "/keys/jwt_public.pem"), 2*time.Minute)
	if err != nil {
		return err
	}
	client, db, err := mongox.Connect(ctx, config.Must("MONGO_URI"), config.Get("MONGO_DB", "payments_db"), time.Minute)
	if err != nil {
		return err
	}
	defer client.Disconnect(context.Background())
	store, err := payment.NewMongoStore(ctx, client, db)
	if err != nil {
		return err
	}
	inbox, err := mongox.NewInbox(ctx, db)
	if err != nil {
		return err
	}
	mq, err := rabbit.Dial(config.Must("RABBITMQ_URL"), 2*time.Minute)
	if err != nil {
		return err
	}
	defer mq.Close()

	httpClient := &http.Client{Timeout: 15 * time.Second}
	var provider payment.Provider = payment.Mock{}
	if key := config.Get("STRIPE_SECRET_KEY", ""); key != "" {
		provider = &payment.Stripe{SecretKey: key, Publishable: config.Must("STRIPE_PUBLISHABLE_KEY"),
			BaseURL: config.Get("STRIPE_API_URL", "https://api.stripe.com"), HTTP: httpClient}
	}
	slog.Info("payment provider", "provider", provider.Name())

	svc := &payment.Service{
		Store:         store,
		Provider:      provider,
		Orders:        &payment.OrderClient{BaseURL: config.Get("ORDER_SERVICE_URL", "http://order:8080"), Secret: config.Must("INTERNAL_TOKEN"), HTTP: httpClient},
		WebhookSecret: config.Get("STRIPE_WEBHOOK_SECRET", ""),
		Now:           time.Now,
	}

	if err := mq.Consume(ctx, "payment-service", inbox, map[string]events.Handler{
		events.OrderCancelled: svc.OnOrderCancelled,
	}); err != nil {
		return err
	}
	go events.Relay(ctx, store.Outbox(), mq, 500*time.Millisecond)

	mux := http.NewServeMux()
	(&payment.Handlers{Svc: svc}).Routes(mux)
	mux.HandleFunc("GET /healthz", server.Health(func(ctx context.Context) error { return client.Ping(ctx, nil) }))
	return server.Run(ctx, config.Get("ADDR", ":8080"),
		httpx.Middleware(httpx.Authenticate(token.NewVerifier(pub), mux)))
}
