package order

import (
	"context"
	"regexp"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"shop/internal/platform/events"
	"shop/internal/platform/mongox"
)

// MongoStore keeps order-service data in orders_db.
type MongoStore struct {
	client                                            *mongo.Client
	products, stock, carts, orders, coupons, counters *mongo.Collection
	outbox                                            *mongox.Outbox
}

func NewMongoStore(ctx context.Context, client *mongo.Client, db *mongo.Database) (*MongoStore, error) {
	ob, err := mongox.NewOutbox(ctx, db)
	if err != nil {
		return nil, err
	}
	s := &MongoStore{client: client, products: db.Collection("product_cache"), stock: db.Collection("inventory"),
		carts: db.Collection("carts"), orders: db.Collection("orders"), coupons: db.Collection("coupons"),
		counters: db.Collection("counters"), outbox: ob}
	idx := map[*mongo.Collection][]mongo.IndexModel{
		s.products: {mongox.Index(bson.D{{Key: "productId", Value: 1}}, false)},
		s.carts:    {mongox.TTLIndex("expiresAt")},
		s.orders: {
			mongox.Index(bson.D{{Key: "number", Value: 1}}, true),
			mongox.Index(bson.D{{Key: "userId", Value: 1}, {Key: "createdAt", Value: -1}}, false),
			mongox.Index(bson.D{{Key: "owner", Value: 1}, {Key: "status", Value: 1}}, false),
			mongox.Index(bson.D{{Key: "status", Value: 1}, {Key: "reservedUntil", Value: 1}}, false),
			mongox.Index(bson.D{{Key: "createdAt", Value: -1}}, false),
		},
	}
	for c, models := range idx {
		if _, err := c.Indexes().CreateMany(ctx, models); err != nil {
			return nil, err
		}
	}
	return s, nil
}

// Outbox exposes the outbox for the relay loop in main.go.
func (s *MongoStore) Outbox() *mongox.Outbox { return s.outbox }

func (s *MongoStore) Tx(ctx context.Context, fn func(ctx context.Context) error) error {
	return mongox.Tx(ctx, s.client, fn)
}

// nonNil avoids sending {$in: null}, which MongoDB rejects.
func nonNil(v []string) []string {
	if v == nil {
		return []string{}
	}
	return v
}

// ---------- products ----------

func (s *MongoStore) UpsertProduct(ctx context.Context, p Product) error {
	_, err := s.products.ReplaceOne(ctx, bson.M{"_id": p.SKU}, p, options.Replace().SetUpsert(true))
	return err
}

func (s *MongoStore) Products(ctx context.Context, skus []string) (map[string]Product, error) {
	cur, err := s.products.Find(ctx, bson.M{"_id": bson.M{"$in": nonNil(skus)}})
	if err != nil {
		return nil, err
	}
	var list []Product
	if err := cur.All(ctx, &list); err != nil {
		return nil, err
	}
	out := make(map[string]Product, len(list))
	for _, p := range list {
		out[p.SKU] = p
	}
	return out, nil
}

func (s *MongoStore) DeactivateProduct(ctx context.Context, productID string, keep []string) error {
	_, err := s.products.UpdateMany(ctx,
		bson.M{"productId": productID, "_id": bson.M{"$nin": nonNil(keep)}},
		bson.M{"$set": bson.M{"active": false, "updatedAt": time.Now().UTC()}})
	return err
}

// ---------- stock ----------

// EnsureStock uses $setOnInsert: the document is only written when it doesn't exist,
// so a replayed product event never resets counted stock back to its initial value.
func (s *MongoStore) EnsureStock(ctx context.Context, sku string, initial, lowAt int) (bool, error) {
	res, err := s.stock.UpdateOne(ctx, bson.M{"_id": sku},
		bson.M{"$setOnInsert": bson.M{"onHand": initial, "reserved": 0, "lowStockAt": lowAt, "updatedAt": time.Now().UTC()}},
		options.UpdateOne().SetUpsert(true))
	if err != nil {
		return false, err
	}
	return res.UpsertedCount == 1, nil
}

func (s *MongoStore) Stock(ctx context.Context, skus []string) (map[string]Stock, error) {
	cur, err := s.stock.Find(ctx, bson.M{"_id": bson.M{"$in": nonNil(skus)}})
	if err != nil {
		return nil, err
	}
	var list []Stock
	if err := cur.All(ctx, &list); err != nil {
		return nil, err
	}
	out := make(map[string]Stock, len(list))
	for _, st := range list {
		out[st.SKU] = st
	}
	return out, nil
}

func (s *MongoStore) ListStock(ctx context.Context) ([]Stock, error) {
	cur, err := s.stock.Find(ctx, bson.M{}, options.Find().SetSort(bson.D{{Key: "_id", Value: 1}}))
	if err != nil {
		return nil, err
	}
	out := []Stock{}
	return out, cur.All(ctx, &out)
}

// availableAtLeast matches a stock document with at least n units free.
// $expr lets the filter compare two fields of the same document.
func availableAtLeast(n int) bson.M {
	return bson.M{"$expr": bson.M{"$gte": bson.A{bson.M{"$subtract": bson.A{"$onHand", "$reserved"}}, n}}}
}

func (s *MongoStore) AdjustStock(ctx context.Context, sku string, delta int) (Stock, error) {
	var st Stock
	err := s.stock.FindOneAndUpdate(ctx,
		bson.M{"_id": sku, "$expr": bson.M{"$gte": bson.A{bson.M{"$add": bson.A{"$onHand", delta}}, "$reserved"}}},
		bson.M{"$inc": bson.M{"onHand": delta}, "$set": bson.M{"updatedAt": time.Now().UTC()}},
		options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&st)
	if mongox.IsNotFound(err) {
		if s.stock.FindOne(ctx, bson.M{"_id": sku}).Err() != nil {
			return st, ErrNotFound
		}
		return st, &ErrInsufficient{SKUs: []string{sku}}
	}
	return st, err
}

// Reserve is the heart of "never sell what you don't have". Each line is one
// conditional update: "add qty to reserved, but only if onHand - reserved >= qty".
// MongoDB applies a single-document update atomically, so two shoppers can't both
// take the last unit. It must run inside Tx: if line 3 is short, the transaction
// aborts and lines 1 and 2 are undone too.
func (s *MongoStore) Reserve(ctx context.Context, lines []Line) error {
	var short []string
	for _, l := range lines {
		filter := availableAtLeast(l.Qty)
		filter["_id"] = l.SKU
		res, err := s.stock.UpdateOne(ctx, filter,
			bson.M{"$inc": bson.M{"reserved": l.Qty}, "$set": bson.M{"updatedAt": time.Now().UTC()}})
		if err != nil {
			return err
		}
		if res.MatchedCount == 0 {
			short = append(short, l.SKU)
		}
	}
	if len(short) > 0 {
		return &ErrInsufficient{SKUs: short}
	}
	return nil
}

func (s *MongoStore) move(ctx context.Context, lines []Line, onHand, reserved int) error {
	for _, l := range lines {
		inc := bson.M{}
		if onHand != 0 {
			inc["onHand"] = onHand * l.Qty
		}
		if reserved != 0 {
			inc["reserved"] = reserved * l.Qty
		}
		if _, err := s.stock.UpdateOne(ctx, bson.M{"_id": l.SKU},
			bson.M{"$inc": inc, "$set": bson.M{"updatedAt": time.Now().UTC()}}); err != nil {
			return err
		}
	}
	return nil
}

func (s *MongoStore) Release(ctx context.Context, lines []Line) error {
	return s.move(ctx, lines, 0, -1)
}
func (s *MongoStore) Commit(ctx context.Context, lines []Line) error {
	return s.move(ctx, lines, -1, -1)
}
func (s *MongoStore) Restock(ctx context.Context, lines []Line) error {
	return s.move(ctx, lines, 1, 0)
}

// ---------- carts ----------

func (s *MongoStore) Cart(ctx context.Context, owner string) (Cart, error) {
	var c Cart
	err := s.carts.FindOne(ctx, bson.M{"_id": owner}).Decode(&c)
	if mongox.IsNotFound(err) {
		return Cart{Owner: owner, Lines: []Line{}}, nil
	}
	if c.Lines == nil {
		c.Lines = []Line{}
	}
	return c, err
}

func (s *MongoStore) SaveCart(ctx context.Context, c Cart) error {
	_, err := s.carts.ReplaceOne(ctx, bson.M{"_id": c.Owner}, c, options.Replace().SetUpsert(true))
	return err
}

func (s *MongoStore) DeleteCart(ctx context.Context, owner string) error {
	_, err := s.carts.DeleteOne(ctx, bson.M{"_id": owner})
	return err
}

// ---------- orders ----------

func (s *MongoStore) NextOrderNumber(ctx context.Context) (int64, error) {
	var doc struct {
		Seq int64 `bson:"seq"`
	}
	err := s.counters.FindOneAndUpdate(ctx, bson.M{"_id": "order"}, bson.M{"$inc": bson.M{"seq": 1}},
		options.FindOneAndUpdate().SetUpsert(true).SetReturnDocument(options.After)).Decode(&doc)
	return doc.Seq, err
}

func (s *MongoStore) InsertOrder(ctx context.Context, o *Order) error {
	_, err := s.orders.InsertOne(ctx, o)
	return err
}

func (s *MongoStore) Order(ctx context.Context, id string) (*Order, error) {
	var o Order
	err := s.orders.FindOne(ctx, bson.M{"_id": id}).Decode(&o)
	if mongox.IsNotFound(err) {
		return nil, ErrNotFound
	}
	return &o, err
}

// UpdateStatus is a compare-and-set: the filter includes the expected current status,
// so if a webhook and an admin act on the same order at once, only one wins and the
// other gets ErrStatus instead of overwriting.
func (s *MongoStore) UpdateStatus(ctx context.Context, id string, u StatusUpdate) (*Order, error) {
	set := bson.M{"updatedAt": u.At}
	update := bson.M{"$set": set}
	if !u.KeepStatus {
		set["status"] = u.To
		update["$push"] = bson.M{"history": StatusChange{Status: u.To, At: u.At, Note: u.Note}}
	} else if u.Note != "" {
		update["$push"] = bson.M{"history": StatusChange{Status: u.To, At: u.At, Note: u.Note}}
	}
	if u.PaymentID != "" {
		set["paymentId"] = u.PaymentID
	}
	if u.Tracking != "" {
		set["tracking"] = u.Tracking
	}
	if u.AddRefunded != 0 {
		update["$inc"] = bson.M{"refundedCents": u.AddRefunded}
	}
	var o Order
	err := s.orders.FindOneAndUpdate(ctx, bson.M{"_id": id, "status": bson.M{"$in": nonNil(u.From)}}, update,
		options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&o)
	if mongox.IsNotFound(err) {
		if _, err := s.Order(ctx, id); err != nil {
			return nil, err
		}
		return nil, ErrStatus
	}
	return &o, err
}

func (s *MongoStore) ListOrders(ctx context.Context, q OrderQuery) ([]Order, int, error) {
	filter := bson.M{}
	if q.UserID != "" {
		filter["userId"] = q.UserID
	}
	if q.Status != "" {
		filter["status"] = q.Status
	}
	if q.Search != "" {
		rx := bson.Regex{Pattern: regexp.QuoteMeta(q.Search), Options: "i"}
		filter["$or"] = bson.A{bson.M{"number": rx}, bson.M{"email": rx}}
	}
	total, err := s.orders.CountDocuments(ctx, filter)
	if err != nil {
		return nil, 0, err
	}
	opts := options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetSkip(int64(q.Skip))
	if q.Limit > 0 {
		opts.SetLimit(int64(q.Limit))
	}
	cur, err := s.orders.Find(ctx, filter, opts)
	if err != nil {
		return nil, 0, err
	}
	out := []Order{}
	return out, int(total), cur.All(ctx, &out)
}

func (s *MongoStore) PendingOrders(ctx context.Context, owner string) ([]Order, error) {
	cur, err := s.orders.Find(ctx, bson.M{"owner": owner, "status": StatusPendingPayment})
	if err != nil {
		return nil, err
	}
	var out []Order
	return out, cur.All(ctx, &out)
}

func (s *MongoStore) ExpiredPending(ctx context.Context, before time.Time, limit int) ([]Order, error) {
	cur, err := s.orders.Find(ctx, bson.M{"status": StatusPendingPayment, "reservedUntil": bson.M{"$lt": before}},
		options.Find().SetLimit(int64(limit)))
	if err != nil {
		return nil, err
	}
	var out []Order
	return out, cur.All(ctx, &out)
}

// ---------- coupons ----------

func (s *MongoStore) Coupon(ctx context.Context, code string) (*Coupon, error) {
	var c Coupon
	err := s.coupons.FindOne(ctx, bson.M{"_id": code}).Decode(&c)
	if mongox.IsNotFound(err) {
		return nil, ErrNotFound
	}
	return &c, err
}

func (s *MongoStore) SaveCoupon(ctx context.Context, c Coupon) error {
	_, err := s.coupons.ReplaceOne(ctx, bson.M{"_id": c.Code}, c, options.Replace().SetUpsert(true))
	return err
}

func (s *MongoStore) ListCoupons(ctx context.Context) ([]Coupon, error) {
	cur, err := s.coupons.Find(ctx, bson.M{}, options.Find().SetSort(bson.D{{Key: "_id", Value: 1}}))
	if err != nil {
		return nil, err
	}
	out := []Coupon{}
	return out, cur.All(ctx, &out)
}

func (s *MongoStore) UseCoupon(ctx context.Context, code string) error {
	_, err := s.coupons.UpdateOne(ctx, bson.M{"_id": code}, bson.M{"$inc": bson.M{"uses": 1}})
	return err
}

// ---------- events & stats ----------

func (s *MongoStore) AddEvents(ctx context.Context, evs ...events.Event) error {
	return s.outbox.Add(ctx, evs...)
}

// Stats runs one aggregation with $facet: three different groupings of the same
// matched orders in a single round trip.
func (s *MongoStore) Stats(ctx context.Context, since time.Time) (Stats, error) {
	net := bson.M{"$subtract": bson.A{"$totals.totalCents", "$refundedCents"}}
	pipeline := mongo.Pipeline{
		{{Key: "$match", Value: bson.M{
			"status":    bson.M{"$in": bson.A{StatusPaid, StatusProcessing, StatusShipped, StatusDelivered}},
			"createdAt": bson.M{"$gte": since},
		}}},
		{{Key: "$facet", Value: bson.M{
			"totals": bson.A{bson.M{"$group": bson.M{"_id": nil, "revenue": bson.M{"$sum": net}, "orders": bson.M{"$sum": 1}}}},
			"byDay": bson.A{
				bson.M{"$group": bson.M{
					"_id":          bson.M{"$dateToString": bson.M{"format": "%Y-%m-%d", "date": "$createdAt"}},
					"revenueCents": bson.M{"$sum": net},
					"orders":       bson.M{"$sum": 1},
				}},
				bson.M{"$sort": bson.M{"_id": 1}},
			},
			"top": bson.A{
				bson.M{"$unwind": "$lines"},
				bson.M{"$group": bson.M{
					"_id":          "$lines.sku",
					"name":         bson.M{"$first": "$lines.name"},
					"qty":          bson.M{"$sum": "$lines.qty"},
					"revenueCents": bson.M{"$sum": "$lines.lineTotalCents"},
				}},
				bson.M{"$sort": bson.M{"qty": -1}},
				bson.M{"$limit": 5},
			},
		}}},
	}
	cur, err := s.orders.Aggregate(ctx, pipeline)
	if err != nil {
		return Stats{}, err
	}
	var res []struct {
		Totals []struct {
			Revenue int64 `bson:"revenue"`
			Orders  int   `bson:"orders"`
		} `bson:"totals"`
		ByDay []DayStat    `bson:"byDay"`
		Top   []TopProduct `bson:"top"`
	}
	if err := cur.All(ctx, &res); err != nil {
		return Stats{}, err
	}
	st := Stats{ByDay: []DayStat{}, TopProducts: []TopProduct{}}
	if len(res) == 1 {
		if len(res[0].Totals) == 1 {
			st.RevenueCents, st.Orders = res[0].Totals[0].Revenue, res[0].Totals[0].Orders
		}
		if res[0].ByDay != nil {
			st.ByDay = res[0].ByDay
		}
		if res[0].Top != nil {
			st.TopProducts = res[0].Top
		}
	}
	if st.Orders > 0 {
		st.AvgOrderCents = st.RevenueCents / int64(st.Orders)
	}
	low, err := s.stock.CountDocuments(ctx, bson.M{"$expr": bson.M{"$lte": bson.A{
		bson.M{"$subtract": bson.A{"$onHand", "$reserved"}}, "$lowStockAt"}}})
	if err != nil {
		return st, err
	}
	pending, err := s.orders.CountDocuments(ctx, bson.M{"status": StatusPendingPayment})
	st.LowStock, st.PendingOrders = int(low), int(pending)
	return st, err
}
