// Package mail sends plain-text email. In Docker Compose it talks to Mailpit, a fake
// SMTP server with a web inbox at http://localhost:8025, so every email the store
// sends can be read without a real mail account.
package mail

import (
	"fmt"
	"log/slog"
	"net/smtp"
	"strings"
	"sync"
	"time"
)

type Sender interface {
	Send(to, subject, body string) error
}

// SMTP sends through an unauthenticated relay (Mailpit). A production deployment would
// swap in a provider with auth and TLS behind the same interface.
type SMTP struct {
	Addr string // host:port
	From string
}

func (s SMTP) Send(to, subject, body string) error {
	if strings.ContainsAny(to, "\r\n") || strings.ContainsAny(subject, "\r\n") {
		return fmt.Errorf("mail: header injection attempt") // never let input add headers
	}
	msg := "From: " + s.From + "\r\n" +
		"To: " + to + "\r\n" +
		"Subject: " + subject + "\r\n" +
		"Date: " + time.Now().Format(time.RFC1123Z) + "\r\n" +
		"MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n" +
		strings.ReplaceAll(body, "\n", "\r\n")
	return smtp.SendMail(s.Addr, nil, s.From, []string{to}, []byte(msg))
}

// Log writes emails to the log instead of sending them.
type Log struct{}

func (Log) Send(to, subject, body string) error {
	slog.Info("email (not sent)", "to", to, "subject", subject, "body", body)
	return nil
}

// Recorder keeps emails for tests.
type Recorder struct {
	mu   sync.Mutex
	Sent []Message
}

type Message struct{ To, Subject, Body string }

func (r *Recorder) Send(to, subject, body string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.Sent = append(r.Sent, Message{to, subject, body})
	return nil
}

func (r *Recorder) Last() (Message, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.Sent) == 0 {
		return Message{}, false
	}
	return r.Sent[len(r.Sent)-1], true
}
