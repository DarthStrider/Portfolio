package auth

import (
	"context"
	"regexp"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"shop/internal/platform/mongox"
)

// MongoStore keeps auth data in the auth_db database.
type MongoStore struct {
	users, refresh, resets *mongo.Collection
}

// NewMongoStore also creates indexes. Index creation is idempotent, so running it on
// every start is the simplest way to keep them in place.
func NewMongoStore(ctx context.Context, db *mongo.Database) (*MongoStore, error) {
	s := &MongoStore{users: db.Collection("users"), refresh: db.Collection("refresh_tokens"),
		resets: db.Collection("password_resets")}
	if _, err := s.users.Indexes().CreateMany(ctx, []mongo.IndexModel{
		mongox.Index(bson.D{{Key: "email", Value: 1}}, true), // one account per email, enforced by the database
		mongox.Index(bson.D{{Key: "createdAt", Value: -1}}, false),
	}); err != nil {
		return nil, err
	}
	if _, err := s.refresh.Indexes().CreateMany(ctx, []mongo.IndexModel{
		mongox.Index(bson.D{{Key: "familyId", Value: 1}}, false),
		mongox.Index(bson.D{{Key: "userId", Value: 1}}, false),
		mongox.TTLIndex("expiresAt"), // MongoDB deletes expired sessions by itself
	}); err != nil {
		return nil, err
	}
	if _, err := s.resets.Indexes().CreateOne(ctx, mongox.TTLIndex("expiresAt")); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *MongoStore) CreateUser(ctx context.Context, u *User) error {
	_, err := s.users.InsertOne(ctx, u)
	if mongo.IsDuplicateKeyError(err) {
		return ErrEmailTaken
	}
	return err
}

func (s *MongoStore) findUser(ctx context.Context, filter bson.M) (*User, error) {
	var u User
	err := s.users.FindOne(ctx, filter).Decode(&u)
	if mongox.IsNotFound(err) {
		return nil, ErrNotFound
	}
	return &u, err
}

func (s *MongoStore) UserByEmail(ctx context.Context, email string) (*User, error) {
	return s.findUser(ctx, bson.M{"email": email})
}

func (s *MongoStore) UserByID(ctx context.Context, id string) (*User, error) {
	return s.findUser(ctx, bson.M{"_id": id})
}

func (s *MongoStore) SaveUser(ctx context.Context, u *User) error {
	res, err := s.users.ReplaceOne(ctx, bson.M{"_id": u.ID}, u)
	if err == nil && res.MatchedCount == 0 {
		return ErrNotFound
	}
	return err
}

func (s *MongoStore) ListUsers(ctx context.Context, q string, limit int) ([]User, error) {
	filter := bson.M{}
	if q != "" {
		// QuoteMeta: the search box text is matched literally, never as a regex pattern.
		rx := bson.Regex{Pattern: regexp.QuoteMeta(q), Options: "i"}
		filter = bson.M{"$or": bson.A{bson.M{"email": rx}, bson.M{"name": rx}}}
	}
	cur, err := s.users.Find(ctx, filter,
		options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetLimit(int64(limit)))
	if err != nil {
		return nil, err
	}
	out := []User{}
	return out, cur.All(ctx, &out)
}

func (s *MongoStore) SaveRefresh(ctx context.Context, t RefreshToken) error {
	_, err := s.refresh.InsertOne(ctx, t)
	return err
}

func (s *MongoStore) RefreshByHash(ctx context.Context, hash string) (*RefreshToken, error) {
	var t RefreshToken
	err := s.refresh.FindOne(ctx, bson.M{"_id": hash}).Decode(&t)
	if mongox.IsNotFound(err) {
		return nil, ErrNotFound
	}
	return &t, err
}

// RetireRefresh is a single conditional update: the filter only matches a live token,
// so of two concurrent refreshes exactly one sees MatchedCount == 1.
func (s *MongoStore) RetireRefresh(ctx context.Context, hash, replacedBy string, at time.Time) (bool, error) {
	res, err := s.refresh.UpdateOne(ctx,
		bson.M{"_id": hash, "revokedAt": nil},
		bson.M{"$set": bson.M{"revokedAt": at, "replacedBy": replacedBy}})
	if err != nil {
		return false, err
	}
	return res.MatchedCount == 1, nil
}

func (s *MongoStore) RevokeFamily(ctx context.Context, family string, at time.Time) error {
	_, err := s.refresh.UpdateMany(ctx, bson.M{"familyId": family, "revokedAt": nil},
		bson.M{"$set": bson.M{"revokedAt": at}})
	return err
}

func (s *MongoStore) RevokeUserSessions(ctx context.Context, userID string, at time.Time) error {
	_, err := s.refresh.UpdateMany(ctx, bson.M{"userId": userID, "revokedAt": nil},
		bson.M{"$set": bson.M{"revokedAt": at}})
	return err
}

func (s *MongoStore) SaveReset(ctx context.Context, t ResetToken) error {
	_, err := s.resets.InsertOne(ctx, t)
	return err
}

func (s *MongoStore) UseReset(ctx context.Context, hash string, at time.Time) (*ResetToken, error) {
	var t ResetToken
	err := s.resets.FindOneAndUpdate(ctx,
		bson.M{"_id": hash, "usedAt": nil, "expiresAt": bson.M{"$gt": at}},
		bson.M{"$set": bson.M{"usedAt": at}}).Decode(&t)
	if mongox.IsNotFound(err) {
		return nil, ErrNotFound
	}
	return &t, err
}
