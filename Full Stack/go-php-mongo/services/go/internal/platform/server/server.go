// Package server runs an HTTP server with graceful shutdown.
package server

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

// Logger sets JSON logs as the default, which Docker and log shippers parse easily.
func Logger(service string) {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)).With("service", service))
}

// SignalContext is cancelled on Ctrl+C or `docker stop`.
func SignalContext() (context.Context, context.CancelFunc) {
	return signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
}

// Run serves h on addr until ctx is cancelled, then gives in-flight requests 10 seconds.
func Run(ctx context.Context, addr string, h http.Handler) error {
	srv := &http.Server{
		Addr:              addr,
		Handler:           h,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	errc := make(chan error, 1)
	go func() {
		slog.Info("listening", "addr", addr)
		errc <- srv.ListenAndServe()
	}()
	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// Health is the /healthz handler Docker's healthcheck calls.
func Health(check func(ctx context.Context) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if check != nil {
			if err := check(ctx); err != nil {
				http.Error(w, "unhealthy: "+err.Error(), http.StatusServiceUnavailable)
				return
			}
		}
		w.Write([]byte("ok"))
	}
}
