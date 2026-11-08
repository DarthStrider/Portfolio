// Package rabbit connects the events package to RabbitMQ.
//
// Topology: one durable topic exchange, "shop.events". Each consuming service declares
// its own durable queue (e.g. "order-service") and binds the event types it cares about.
// A message published while a consumer is down waits in its queue.
package rabbit

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"

	"shop/internal/platform/events"
)

const Exchange = "shop.events"

// Inbox remembers which event IDs a service has already handled. Brokers redeliver
// (at-least-once), so handling the same event twice must be a no-op.
type Inbox interface {
	Seen(ctx context.Context, eventID string) (bool, error)
	Mark(ctx context.Context, eventID string) error
}

// Conn is one AMQP connection with a channel for publishing.
type Conn struct {
	conn *amqp.Connection
	mu   sync.Mutex // amqp channels are not safe for concurrent publishes
	pub  *amqp.Channel
}

// Dial connects, retrying while RabbitMQ is still starting up.
func Dial(url string, timeout time.Duration) (*Conn, error) {
	deadline := time.Now().Add(timeout)
	for {
		conn, err := amqp.Dial(url)
		if err == nil {
			ch, err := conn.Channel()
			if err != nil {
				return nil, err
			}
			if err := ch.ExchangeDeclare(Exchange, "topic", true, false, false, false, nil); err != nil {
				return nil, err
			}
			c := &Conn{conn: conn, pub: ch}
			go c.watch()
			return c, nil
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("rabbit: %w", err)
		}
		slog.Info("waiting for RabbitMQ", "err", err)
		time.Sleep(2 * time.Second)
	}
}

// watch ends the process if the connection drops. Docker's restart policy brings the
// service back with a fresh connection, which is simpler and safer than reconnect logic
// that has to re-declare every consumer.
func (c *Conn) watch() {
	err := <-c.conn.NotifyClose(make(chan *amqp.Error, 1))
	if err != nil {
		slog.Error("RabbitMQ connection lost, exiting so the container restarts", "err", err)
		panic("rabbitmq connection lost")
	}
}

func (c *Conn) Close() error { return c.conn.Close() }

// Publish sends ev as a persistent message routed by its type.
func (c *Conn) Publish(ctx context.Context, ev events.Event) error {
	body, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.pub.PublishWithContext(ctx, Exchange, ev.Type, false, false, amqp.Publishing{
		ContentType:  "application/json",
		DeliveryMode: amqp.Persistent,
		MessageId:    ev.ID,
		Timestamp:    ev.OccurredAt,
		Type:         ev.Type,
		Body:         body,
	})
}

// Consume binds queue to the handlers' event types and processes messages until ctx ends.
// A handler error requeues the message after a short pause; a message that can't even be
// decoded is dropped (redelivering it would loop forever).
func (c *Conn) Consume(ctx context.Context, queue string, inbox Inbox, handlers map[string]events.Handler) error {
	ch, err := c.conn.Channel()
	if err != nil {
		return err
	}
	if _, err := ch.QueueDeclare(queue, true, false, false, false, nil); err != nil {
		return err
	}
	for typ := range handlers {
		if err := ch.QueueBind(queue, typ, Exchange, false, nil); err != nil {
			return err
		}
	}
	if err := ch.Qos(16, 0, false); err != nil {
		return err
	}
	msgs, err := ch.Consume(queue, "", false, false, false, false, nil)
	if err != nil {
		return err
	}
	go func() {
		for {
			select {
			case <-ctx.Done():
				_ = ch.Close()
				return
			case m, ok := <-msgs:
				if !ok {
					return
				}
				handleOne(ctx, m, inbox, handlers)
			}
		}
	}()
	return nil
}

func handleOne(ctx context.Context, m amqp.Delivery, inbox Inbox, handlers map[string]events.Handler) {
	var ev events.Event
	if err := json.Unmarshal(m.Body, &ev); err != nil || ev.ID == "" {
		slog.Error("dropping undecodable message", "err", err, "routing_key", m.RoutingKey)
		_ = m.Nack(false, false)
		return
	}
	h, ok := handlers[ev.Type]
	if !ok {
		_ = m.Ack(false)
		return
	}
	if inbox != nil {
		if seen, err := inbox.Seen(ctx, ev.ID); err == nil && seen {
			_ = m.Ack(false)
			return
		}
	}
	if err := h(ctx, ev); err != nil {
		slog.Warn("event handler failed, requeueing", "type", ev.Type, "event_id", ev.ID, "err", err)
		time.Sleep(time.Second)
		_ = m.Nack(false, true)
		return
	}
	if inbox != nil {
		if err := inbox.Mark(ctx, ev.ID); err != nil {
			slog.Warn("inbox mark failed", "event_id", ev.ID, "err", err)
		}
	}
	_ = m.Ack(false)
}
