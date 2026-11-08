// Package auth is auth-service: accounts, passwords, sessions and roles.
package auth

import (
	"context"
	"errors"
	"time"
)

type User struct {
	ID           string    `bson:"_id" json:"id"`
	Email        string    `bson:"email" json:"email"`
	Name         string    `bson:"name" json:"name"`
	PasswordHash string    `bson:"passwordHash" json:"-"`
	Roles        []string  `bson:"roles" json:"roles"`
	Addresses    []Address `bson:"addresses" json:"addresses"`
	CreatedAt    time.Time `bson:"createdAt" json:"createdAt"`
}

type Address struct {
	ID         string `bson:"id" json:"id"`
	Name       string `bson:"name" json:"name"`
	Line1      string `bson:"line1" json:"line1"`
	Line2      string `bson:"line2" json:"line2"`
	City       string `bson:"city" json:"city"`
	Province   string `bson:"province" json:"province"`
	PostalCode string `bson:"postalCode" json:"postalCode"`
	Country    string `bson:"country" json:"country"`
	Phone      string `bson:"phone" json:"phone"`
}

// RefreshToken is one link in a session's rotation chain. Every refresh retires the
// presented token and issues a new one in the same family. If a retired token is ever
// presented again, someone copied it: the whole family is revoked and both the thief
// and the real user must sign in again.
type RefreshToken struct {
	Hash       string     `bson:"_id"`
	UserID     string     `bson:"userId"`
	FamilyID   string     `bson:"familyId"`
	ExpiresAt  time.Time  `bson:"expiresAt"`
	RevokedAt  *time.Time `bson:"revokedAt,omitempty"`
	ReplacedBy string     `bson:"replacedBy,omitempty"`
}

type ResetToken struct {
	Hash      string     `bson:"_id"`
	UserID    string     `bson:"userId"`
	ExpiresAt time.Time  `bson:"expiresAt"`
	UsedAt    *time.Time `bson:"usedAt,omitempty"`
}

var (
	ErrNotFound   = errors.New("not found")
	ErrEmailTaken = errors.New("email already registered")
)

// Store is everything auth-service needs from a database. MemStore and MongoStore
// both implement it; the HTTP tests run against MemStore.
type Store interface {
	CreateUser(ctx context.Context, u *User) error
	UserByEmail(ctx context.Context, email string) (*User, error)
	UserByID(ctx context.Context, id string) (*User, error)
	SaveUser(ctx context.Context, u *User) error
	ListUsers(ctx context.Context, query string, limit int) ([]User, error)

	SaveRefresh(ctx context.Context, t RefreshToken) error
	RefreshByHash(ctx context.Context, hash string) (*RefreshToken, error)
	// RetireRefresh marks a token replaced, but only if it is still live. It returns
	// false when the token was already retired: two refreshes racing with one token
	// count as reuse.
	RetireRefresh(ctx context.Context, hash, replacedBy string, at time.Time) (bool, error)
	RevokeFamily(ctx context.Context, familyID string, at time.Time) error
	RevokeUserSessions(ctx context.Context, userID string, at time.Time) error

	SaveReset(ctx context.Context, t ResetToken) error
	// UseReset consumes an unused, unexpired reset token exactly once.
	UseReset(ctx context.Context, hash string, at time.Time) (*ResetToken, error)
}
