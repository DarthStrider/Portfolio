// Command order runs order-service: cart, checkout, stock, orders, coupons, and the
// order emails. One process runs the HTTP API plus three background loops: event
// consumers, the outbox relay, and the reservation-expiry sweeper.
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"time"

	"shop/internal/order"
	"shop/internal/platform/config"
	"shop/internal/platform/events"
	"shop/internal/platform/events/rabbit"
	"shop/internal/platform/httpx"
	"shop/internal/platform/mail"
	"shop/internal/platform/mongox"
	"shop/internal/platform/server"
	"shop/internal/platform/token"
)

func main() {
	server.Logger("order-service")
	if err := run(); err != nil {
		slog.Error("order-service stopped", "err", err)
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
	client, db, err := mongox.Connect(ctx, config.Must("MONGO_URI"), config.Get("MONGO_DB", "orders_db"), time.Minute)
	if err != nil {
		return err
	}
	defer client.Disconnect(context.Background())
	store, err := order.NewMongoStore(ctx, client, db)
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

	svc := &order.Service{Store: store, Now: time.Now}
	if err := seedCoupon(ctx, svc); err != nil {
		return err
	}

	var sender mail.Sender = mail.Log{}
	if addr := config.Get("SMTP_ADDR", ""); addr != "" {
		sender = mail.SMTP{Addr: addr, From: config.Get("MAIL_FROM", "Northline Shop <shop@example.test>")}
	}
	notifier := &order.Notifier{Store: store, Mail: sender, AppURL: config.Get("APP_URL", "http://localhost:8090")}

	// Two queues: business events, and emails. Separate queues mean a mail outage
	// backs up only the email queue while payments keep flowing.
	if err := mq.Consume(ctx, "order-service", inbox, map[string]events.Handler{
		events.ProductUpdated:   svc.OnProductUpdated,
		events.ProductDeleted:   svc.OnProductDeleted,
		events.PaymentSucceeded: svc.OnPaymentSucceeded,
		events.RefundIssued:     svc.OnRefundIssued,
	}); err != nil {
		return err
	}
	if err := mq.Consume(ctx, "order-service.email", nil, map[string]events.Handler{
		events.OrderPlaced:    notifier.OnPlaced,
		events.OrderShipped:   notifier.OnShipped,
		events.OrderCancelled: notifier.OnCancelled,
	}); err != nil {
		return err
	}
	go events.Relay(ctx, store.Outbox(), mq, 500*time.Millisecond)
	go sweep(ctx, svc)

	mux := http.NewServeMux()
	(&order.Handlers{Svc: svc, InternalSecret: config.Must("INTERNAL_TOKEN"),
		SecureCookie: config.Bool("SECURE_COOKIES", false)}).Routes(mux)
	mux.HandleFunc("GET /healthz", server.Health(func(ctx context.Context) error { return client.Ping(ctx, nil) }))

	return server.Run(ctx, config.Get("ADDR", ":8080"),
		httpx.Middleware(httpx.Authenticate(token.NewVerifier(pub), mux)))
}

// sweep releases stock held by checkouts that were never paid.
func sweep(ctx context.Context, svc *order.Service) {
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		if n, err := svc.ExpireStale(ctx); err != nil {
			slog.Warn("expiry sweep", "err", err)
		} else if n > 0 {
			slog.Info("expired unpaid orders", "count", n)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// seedCoupon creates the WELCOME10 demo code on first start.
func seedCoupon(ctx context.Context, svc *order.Service) error {
	if _, err := svc.Store.Coupon(ctx, "WELCOME10"); err == nil {
		return nil
	}
	_, err := svc.SaveCoupon(ctx, order.Coupon{Code: "WELCOME10", PercentOff: 10, Active: true})
	return err
}
