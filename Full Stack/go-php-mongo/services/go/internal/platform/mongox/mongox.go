// Package mongox holds the MongoDB code the Go services share: connecting, transactions,
// and the outbox and inbox collections.
package mongox

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"shop/internal/platform/events"
)

// Connect opens a client and pings it, retrying while the replica set is still electing
// a primary on first start.
func Connect(ctx context.Context, uri, dbName string, timeout time.Duration) (*mongo.Client, *mongo.Database, error) {
	client, err := mongo.Connect(options.Client().ApplyURI(uri))
	if err != nil {
		return nil, nil, err
	}
	deadline := time.Now().Add(timeout)
	for {
		pctx, cancel := context.WithTimeout(ctx, 3*time.Second)
		err = client.Ping(pctx, nil)
		cancel()
		if err == nil {
			return client, client.Database(dbName), nil
		}
		if time.Now().After(deadline) {
			return nil, nil, fmt.Errorf("mongo: %w", err)
		}
		slog.Info("waiting for MongoDB", "err", err)
		time.Sleep(2 * time.Second)
	}
}

// Tx runs fn in a multi-document transaction. Every collection call inside fn must use
// the ctx it is given: in driver v2 that ctx carries the session, which is what makes the
// writes part of the transaction. WithTransaction also retries on transient errors
// (such as a write conflict with another checkout), so fn must be safe to run twice.
func Tx(ctx context.Context, client *mongo.Client, fn func(ctx context.Context) error) error {
	sess, err := client.StartSession()
	if err != nil {
		return err
	}
	defer sess.EndSession(ctx)
	_, err = sess.WithTransaction(ctx, func(ctx context.Context) (any, error) {
		return nil, fn(ctx)
	})
	return err
}

// Index is shorthand for building index models.
func Index(keys bson.D, unique bool) mongo.IndexModel {
	o := options.Index()
	if unique {
		o.SetUnique(true)
	}
	return mongo.IndexModel{Keys: keys, Options: o}
}

// TTLIndex deletes documents once the time in field has passed.
func TTLIndex(field string) mongo.IndexModel {
	return mongo.IndexModel{Keys: bson.D{{Key: field, Value: 1}}, Options: options.Index().SetExpireAfterSeconds(0)}
}

// IsNotFound reports the driver's "no documents" error.
func IsNotFound(err error) bool { return errors.Is(err, mongo.ErrNoDocuments) }

// ---- Outbox ----

type outboxDoc struct {
	ID         string     `bson:"_id"`
	Type       string     `bson:"type"`
	OccurredAt time.Time  `bson:"occurredAt"`
	Payload    string     `bson:"payload"` // the JSON data, kept as text so it round-trips exactly
	SentAt     *time.Time `bson:"sentAt,omitempty"`
}

// Outbox stores events in the "outbox" collection of a service's own database.
type Outbox struct{ c *mongo.Collection }

func NewOutbox(ctx context.Context, db *mongo.Database) (*Outbox, error) {
	c := db.Collection("outbox")
	_, err := c.Indexes().CreateMany(ctx, []mongo.IndexModel{
		Index(bson.D{{Key: "sentAt", Value: 1}, {Key: "occurredAt", Value: 1}}, false),
	})
	return &Outbox{c: c}, err
}

// Add inserts events. Call it with the transaction's ctx.
func (o *Outbox) Add(ctx context.Context, evs ...events.Event) error {
	if len(evs) == 0 {
		return nil
	}
	docs := make([]any, len(evs))
	for i, ev := range evs {
		docs[i] = outboxDoc{ID: ev.ID, Type: ev.Type, OccurredAt: ev.OccurredAt, Payload: string(ev.Data)}
	}
	_, err := o.c.InsertMany(ctx, docs)
	return err
}

func (o *Outbox) Pending(ctx context.Context, limit int) ([]events.Event, error) {
	cur, err := o.c.Find(ctx, bson.M{"sentAt": nil},
		options.Find().SetSort(bson.D{{Key: "occurredAt", Value: 1}}).SetLimit(int64(limit)))
	if err != nil {
		return nil, err
	}
	var docs []outboxDoc
	if err := cur.All(ctx, &docs); err != nil {
		return nil, err
	}
	out := make([]events.Event, len(docs))
	for i, d := range docs {
		out[i] = events.Event{ID: d.ID, Type: d.Type, OccurredAt: d.OccurredAt, Data: json.RawMessage(d.Payload)}
	}
	return out, nil
}

func (o *Outbox) MarkSent(ctx context.Context, eventID string) error {
	_, err := o.c.UpdateByID(ctx, eventID, bson.M{"$set": bson.M{"sentAt": time.Now().UTC()}})
	return err
}

// ---- Inbox ----

// Inbox records handled event IDs in "processed_events", expiring after 7 days
// (far longer than any redelivery window).
type Inbox struct{ c *mongo.Collection }

func NewInbox(ctx context.Context, db *mongo.Database) (*Inbox, error) {
	c := db.Collection("processed_events")
	_, err := c.Indexes().CreateOne(ctx, TTLIndex("expiresAt"))
	return &Inbox{c: c}, err
}

func (i *Inbox) Seen(ctx context.Context, eventID string) (bool, error) {
	err := i.c.FindOne(ctx, bson.M{"_id": eventID}).Err()
	if IsNotFound(err) {
		return false, nil
	}
	return err == nil, err
}

func (i *Inbox) Mark(ctx context.Context, eventID string) error {
	_, err := i.c.InsertOne(ctx, bson.M{"_id": eventID, "expiresAt": time.Now().Add(7 * 24 * time.Hour)})
	if mongo.IsDuplicateKeyError(err) {
		return nil
	}
	return err
}
