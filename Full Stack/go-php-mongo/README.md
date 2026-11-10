# Northline: an online store in Go, PHP, MongoDB and React

A complete e-commerce store split into four services that talk only through HTTP, events and a
shared public key. Customers browse, search, add to a cart (signed in or as a guest), check out with
Canadian tax and shipping, pay, and track their order. Staff run the store from an admin panel:
products, stock, orders, refunds, reviews, pages, discount codes and staff accounts.

**Walkthrough:** [`walkthrough/northline-walkthrough.pdf`](walkthrough/) explains the system and
goes through the important code line by line, with interview questions and exercises.
The original design document is [`walkthrough/architecture-plan.pdf`](walkthrough/architecture-plan.pdf).

## Run it

```
docker compose up --build
```

Then open **http://localhost:8090**. The first build takes a few minutes (it compiles the MongoDB PHP
extension and runs both test suites); later starts take seconds.

| What | Where | Sign-in |
|---|---|---|
| The store | http://localhost:8090 | create an account, or check out as a guest |
| Admin panel | http://localhost:8090/admin | `admin@northline.test` / `northline-admin` |
| Emails the store sends | http://localhost:8025 (Mailpit) | — |
| Message broker | http://localhost:15672 (RabbitMQ) | `guest` / `guest` |
| Database | `mongodb://localhost:27018/?directConnection=true` | — |

Payments use a built-in **test provider**, so checkout works with no account anywhere: the payment
page offers "Pay" and "Simulate a declined card". To use real **Stripe test mode** instead, copy
`.env.example` to `.env`, fill in the three `STRIPE_` values, and run
`stripe listen --forward-to localhost:8090/api/v1/payments/webhook`.

Try: buy something as a guest with code `WELCOME10`, read the receipt in Mailpit, then in the admin
panel move the order to Packing, Shipped (with a tracking number) and Delivered, or cancel it and
watch the refund appear on its own.

## Architecture

```
                         browser
                            │
                ┌───────────▼────────────┐
                │  gateway (nginx)       │  React build + routes /api/v1/* by path
                └──┬───────┬───────┬───┬─┘
       ┌───────────┘       │       │   └─────────────┐
┌──────▼──────┐ ┌──────────▼─┐ ┌───▼────────┐ ┌──────▼─────────┐
│ auth (Go)   │ │ order (Go) │ │ payment(Go)│ │ catalog (PHP)  │
│ accounts    │ │ cart, stock│ │ intents,   │ │ products,      │
│ JWT signing │ │ checkout,  │◄┤ webhooks,  │ │ categories,    │
│ roles       │ │ orders,    │ │ refunds    │ │ reviews, pages │
└──────┬──────┘ │ coupons    │ └───┬────────┘ └──────┬─────────┘
       │        └─────┬──────┘     │                 │
       │   ┌──────────▼────────────▼─────────────────▼──┐
       │   │ RabbitMQ  topic exchange "shop.events"     │
       │   └────────────────────────────────────────────┘
┌──────▼─────────────────────────────────────────────────────┐
│ MongoDB replica set: auth_db · orders_db · payments_db ·   │
│ catalog_db  (one database per service, never shared)       │
└────────────────────────────────────────────────────────────┘
```

**Why two languages.** Go runs the paths where correctness under concurrency matters: sign-in,
reserving stock, placing orders and moving money. PHP with Laravel runs the catalog, which is mostly
forms, validation, uploads and editorial CRUD. Neither knows what language the other is written in.

**How they cooperate without sharing a database.**

- **Authentication:** auth-service signs RS256 JWTs. The other three services verify them with
  only the public key (Go with the standard library, PHP with `firebase/php-jwt`), so no service
  calls auth-service per request and none can mint tokens.
- **Events with a transactional outbox:** a service writes an event into its own `outbox`
  collection *in the same transaction* as the change it describes; a relay publishes it to RabbitMQ.
  Consumers record handled event IDs, so redelivery is harmless.
- **One synchronous call:** payment-service asks order-service for the amount to charge
  (`/internal/orders/{id}`, shared-secret header, not routed by the gateway). The amount must be
  authoritative at that moment, so it can't wait for an event.

| Event | From | To | Effect |
|---|---|---|---|
| `product.updated` / `.deleted` | catalog | order | refresh order-service's product copy, create stock for new SKUs |
| `stock.changed` | order | catalog | show "sold out" / "only 3 left" |
| `payment.succeeded` | payment | order | order → paid, stock committed, cart emptied |
| `order.placed` | order | order (email), catalog | receipt email; buyer may now review the product |
| `order.shipped` / `.cancelled` | order | order (email), payment | emails; a cancelled paid order is refunded |
| `refund.issued` | payment | order | record the refund; full refund → status refunded |

## What's worth looking at

- **Never overselling.** `Reserve` in `services/go/internal/order/mongostore.go` is one conditional
  update per line (`$inc reserved` only if `onHand - reserved >= qty`) inside a transaction. Two
  shoppers can't both get the last unit; a shortage on line 3 rolls back lines 1 and 2. Unpaid
  reservations expire after 15 minutes and go back on sale.
- **Money in integer cents**, tax in thousandths of a percent (Quebec's 14.975% is exactly 14975),
  rounding half-up in one place (`pricing.go`).
- **Order status as a state machine** (`transitions` in `pricing.go`), with compare-and-set updates:
  if a webhook and an admin touch the same order at once, one wins and the other is told.
- **Refresh-token rotation with reuse detection** in auth-service: a stolen, already-used refresh
  token revokes the whole session family.
- **Webhook security:** Stripe signatures are verified with HMAC-SHA256 over the raw body plus a
  timestamp, and duplicate event IDs are ignored.
- **Faceted search in one query:** the catalog's listing is a single aggregation with `$facet`
  (page of items, total count and price range), backed by a weighted text index.
- **Materialized-path categories:** "everything under Apparel" is one indexed query.

## Tests

| Suite | Count | Runs |
|---|---|---|
| Go (`go test ./...`) | 35 | in-memory stores; HTTP handlers through `httptest`; a fake Stripe server |
| PHP (`vendor/bin/phpunit`) | 16 | validation, query building, category trees, event format, the demo catalog |

Both suites run inside `docker compose build`; an image isn't produced if a test fails. The front end
type-checks with `npm run typecheck` in `web/`.

## Layout

```
docker-compose.yml        9 containers, healthchecks, startup order
gateway/                  nginx config + Dockerfile that builds the React app
services/go/              one Go module, three commands
  cmd/{auth,order,payment}/main.go
  internal/platform/      JWT, HTTP helpers, events/outbox, MongoDB, RabbitMQ, mail
  internal/{auth,order,payment}/   model, service rules, handlers, Mongo + in-memory stores, tests
services/catalog/         Laravel 12 app
  app/Domain/             framework-free rules (unit-tested)
  app/Data/               MongoDB repositories and the outbox
  app/Http/               controllers and JWT middleware
  app/Console/Commands/   indexes, demo seed, the events worker
web/                      React 19 + TypeScript + Vite + TanStack Query
walkthrough/              the line-by-line walkthrough PDF
```

## Notes and limits

- Built for local demonstration. For production: HTTPS with `SECURE_COOKIES=true`, real secrets in
  `.env`, php-fpm or FrankenPHP instead of `artisan serve`, a managed MongoDB replica set, and a real
  mail provider in place of Mailpit.
- Dependency versions are pinned by `services/go/go.sum`, `web/package-lock.json` and
  `services/catalog/composer.lock`, and the Docker builds install exactly those. To update the
  Composer lock without PHP installed, run this in this folder (it resolves for PHP 8.3 because
  `composer.json` sets `config.platform`):
  `docker run --rm -v "$PWD/services/catalog:/app" -w /app composer:2 composer update --no-install`
- Shipping is Canada-only; tax rates are a table in `pricing.go` and should come from configuration
  or a tax service in a real store.
