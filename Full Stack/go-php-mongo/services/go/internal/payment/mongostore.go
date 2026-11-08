package payment

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"shop/internal/platform/events"
	"shop/internal/platform/mongox"
)

// MongoStore keeps payment data in payments_db.
type MongoStore struct {
	client   *mongo.Client
	payments *mongo.Collection
	webhooks *mongo.Collection
	outbox   *mongox.Outbox
}

func NewMongoStore(ctx context.Context, client *mongo.Client, db *mongo.Database) (*MongoStore, error) {
	ob, err := mongox.NewOutbox(ctx, db)
	if err != nil {
		return nil, err
	}
	s := &MongoStore{client: client, payments: db.Collection("payments"), webhooks: db.Collection("webhook_events"), outbox: ob}
	if _, err := s.payments.Indexes().CreateMany(ctx, []mongo.IndexModel{
		mongox.Index(bson.D{{Key: "orderId", Value: 1}, {Key: "createdAt", Value: -1}}, false),
		mongox.Index(bson.D{{Key: "provider", Value: 1}, {Key: "providerRef", Value: 1}}, true),
	}); err != nil {
		return nil, err
	}
	if _, err := s.webhooks.Indexes().CreateOne(ctx, mongox.TTLIndex("expiresAt")); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *MongoStore) Outbox() *mongox.Outbox { return s.outbox }

func (s *MongoStore) Tx(ctx context.Context, fn func(ctx context.Context) error) error {
	return mongox.Tx(ctx, s.client, fn)
}

func (s *MongoStore) Insert(ctx context.Context, p *Payment) error {
	_, err := s.payments.InsertOne(ctx, p)
	return err
}

func (s *MongoStore) one(ctx context.Context, filter bson.M) (*Payment, error) {
	var p Payment
	err := s.payments.FindOne(ctx, filter, options.FindOne().SetSort(bson.D{{Key: "createdAt", Value: -1}})).Decode(&p)
	if mongox.IsNotFound(err) {
		return nil, ErrNotFound
	}
	return &p, err
}

func (s *MongoStore) Get(ctx context.Context, id string) (*Payment, error) {
	return s.one(ctx, bson.M{"_id": id})
}

func (s *MongoStore) ByOrder(ctx context.Context, orderID string) (*Payment, error) {
	return s.one(ctx, bson.M{"orderId": orderID})
}

func (s *MongoStore) ByRef(ctx context.Context, provider, ref string) (*Payment, error) {
	return s.one(ctx, bson.M{"provider": provider, "providerRef": ref})
}

func (s *MongoStore) Apply(ctx context.Context, id string, u Update) (*Payment, error) {
	set := bson.M{"status": u.To, "updatedAt": u.At}
	if u.FailureReason != "" {
		set["failureReason"] = u.FailureReason
	}
	update := bson.M{"$set": set}
	if u.Refund != nil {
		update["$push"] = bson.M{"refunds": u.Refund}
		update["$inc"] = bson.M{"refundedCents": u.Refund.AmountCents}
	}
	var p Payment
	err := s.payments.FindOneAndUpdate(ctx, bson.M{"_id": id, "status": bson.M{"$in": u.From}}, update,
		options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&p)
	if mongox.IsNotFound(err) {
		if _, err := s.Get(ctx, id); err != nil {
			return nil, err
		}
		return nil, ErrStatus
	}
	return &p, err
}

func (s *MongoStore) List(ctx context.Context, orderID string, limit int) ([]Payment, error) {
	filter := bson.M{}
	if orderID != "" {
		filter["orderId"] = orderID
	}
	cur, err := s.payments.Find(ctx, filter,
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetLimit(int64(limit)))
	if err != nil {
		return nil, err
	}
	out := []Payment{}
	return out, cur.All(ctx, &out)
}

// FirstSeen relies on the unique _id: the insert succeeds once per event ID.
func (s *MongoStore) FirstSeen(ctx context.Context, eventID string) (bool, error) {
	_, err := s.webhooks.InsertOne(ctx, bson.M{"_id": eventID, "expiresAt": time.Now().Add(30 * 24 * time.Hour)})
	if mongo.IsDuplicateKeyError(err) {
		return false, nil
	}
	return err == nil, err
}

func (s *MongoStore) AddEvents(ctx context.Context, evs ...events.Event) error {
	return s.outbox.Add(ctx, evs...)
}
