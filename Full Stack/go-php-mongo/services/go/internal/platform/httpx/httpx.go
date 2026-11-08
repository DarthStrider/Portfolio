// Package httpx holds the HTTP plumbing all three Go services share: JSON in and out,
// one error shape, request IDs, logging, panic recovery and authentication.
package httpx

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"runtime/debug"
	"time"

	"shop/internal/platform/id"
)

// Error is an error that knows its HTTP status. Domain code returns these;
// anything else becomes a 500 with the details only in the log.
type Error struct {
	Status  int               `json:"-"`
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Fields  map[string]string `json:"fields,omitempty"`
}

func (e *Error) Error() string { return e.Code + ": " + e.Message }

func BadRequest(msg string) *Error { return &Error{Status: 400, Code: "bad_request", Message: msg} }
func Unauthorized(msg string) *Error {
	return &Error{Status: 401, Code: "unauthorized", Message: msg}
}
func Forbidden() *Error { return &Error{Status: 403, Code: "forbidden", Message: "not allowed"} }
func NotFound(what string) *Error {
	return &Error{Status: 404, Code: "not_found", Message: what + " not found"}
}
func Conflict(code, msg string) *Error { return &Error{Status: 409, Code: code, Message: msg} }

// Invalid reports field-level validation errors; the React forms show them under each input.
func Invalid(fields map[string]string) *Error {
	return &Error{Status: 422, Code: "validation_failed", Message: "some fields are invalid", Fields: fields}
}

// HandlerFunc is an http.HandlerFunc that returns an error instead of writing it.
type HandlerFunc func(w http.ResponseWriter, r *http.Request) error

// Handle adapts a HandlerFunc and writes its error in the shared shape:
// {"error": {"code", "message", "fields"}}.
func Handle(h HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := h(w, r); err != nil {
			Fail(w, r, err)
		}
	}
}

// Fail writes err. Unknown errors are logged with the request ID and hidden from the client.
func Fail(w http.ResponseWriter, r *http.Request, err error) {
	var he *Error
	if !errors.As(err, &he) {
		slog.ErrorContext(r.Context(), "request failed", "err", err, "request_id", RequestID(r.Context()))
		he = &Error{Status: 500, Code: "internal", Message: "something went wrong"}
	}
	JSON(w, he.Status, map[string]*Error{"error": he})
}

// JSON writes v with the given status.
func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if v != nil {
		_ = json.NewEncoder(w).Encode(v)
	}
}

// Decode reads a JSON body into v, capped at 1 MB, rejecting unknown fields so a typo
// in a client ("pricecents") fails loudly instead of being silently ignored.
func Decode(r *http.Request, v any) error {
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return BadRequest(fmt.Sprintf("invalid JSON body: %v", err))
	}
	return nil
}

type ctxKey int

const (
	requestIDKey ctxKey = iota
	principalKey
)

// RequestID returns the ID set by the middleware (or forwarded by the gateway).
func RequestID(ctx context.Context) string {
	v, _ := ctx.Value(requestIDKey).(string)
	return v
}

// Middleware wraps a handler with request IDs, access logs and panic recovery.
func Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rid := r.Header.Get("X-Request-Id")
		if rid == "" {
			rid = id.New()
		}
		ctx := context.WithValue(r.Context(), requestIDKey, rid)
		r = r.WithContext(ctx)
		w.Header().Set("X-Request-Id", rid)
		rec := &statusRecorder{ResponseWriter: w, status: 200}
		start := time.Now()
		defer func() {
			if p := recover(); p != nil {
				slog.Error("panic", "panic", p, "stack", string(debug.Stack()), "request_id", rid)
				Fail(rec, r, fmt.Errorf("panic: %v", p))
			}
			slog.Info("request", "method", r.Method, "path", r.URL.Path, "status", rec.status,
				"ms", time.Since(start).Milliseconds(), "request_id", rid)
		}()
		next.ServeHTTP(rec, r)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}
