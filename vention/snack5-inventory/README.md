# Parts Inventory: PostgreSQL or MongoDB

**Stack:** Node.js 22 + TypeScript API, React 19 + Vite, PostgreSQL 17 **or** MongoDB 8, Docker Compose, Kubernetes
**Status:** Built

A stock system for the parts the other snacks use: aluminium extrusion bars, plates, fasteners,
motors, actuators, controllers. It answers "what do we have?", and "can we build this machine?":
paste a design in the same format Snack 4's quote calculator takes, and it works out the stock
the design needs (including how many 3 m bars the cut list needs), checks it against live stock,
and reserves it for the quote, all or nothing.

The same API runs on **either database**, chosen with one setting. Both implement one
repository interface and pass the same contract tests.

## Features

- [x] Stock list with search, category filter, and low-stock alerts (available at or below the reorder level)
- [x] Add new parts from the page (category, SKU, name, unit, bin, starting stock, reorder level); starting stock is logged as a receipt
- [x] Receive and consume stock, with a ledger of every movement
- [x] Check a machine design against stock: bars from a cut list (first-fit decreasing, 3 mm saw kerf), fasteners in packs of 50
- [x] Reserve a design's stock for a quote, all or nothing; release it, or ship it
- [x] Concurrency-safe on both databases: stock never goes negative and is never promised twice
- [x] Shapes for the robot arm's scene (Snack 1): boxes, cylinders, spheres and cones with size, color, position and rotation, stored with the inventory
- [x] Splitters on those belts: ordered sorting rules (on the shape, or on the inventory part it stands for) stored as data, editable from the arm app, the API or the database
- [x] Mergers and joining machines for those belts, and connection points per kind of object (part or shape kind)
- [x] Assemblies: joining two shapes uses up their parts from stock, all or nothing, with a ledger entry; safe when two joins race for the same shape
- [x] Bins: hold the kinds of object you list; loading takes parts from stock, unloading gives them back; items caught off the line are stored, and a part is never taken from stock twice
- [x] Edit a part's name, category, location or reorder level (stock only changes through receive and consume, so the ledger stays complete)
- [x] Conveyor belts for the same scene: size, speed (forward or reversed), position and angle, so a line layout is saved with the parts it uses
- [x] Automated robots for the arm's scene: where each stands, its pick zone, and rules that send each kind of item to a spot, a belt or a bin
- [x] Clear the arm's scene in one request (one transaction in PostgreSQL); one `FLOOR_SIZE` setting for the floor
- [x] Conveyor lines: each belt is a straight, curve or corner transfer section, with a line id and its place in the line. A line moves, turns or splits with one all-or-none `PATCH /api/conveyors`
- [x] Switchable storage: `DB=postgres`, `DB=mongo`, or `DB=memory` (no database at all)
- [x] Docker Compose profiles and Kubernetes overlays for each database

![Stock list with a part open: receiving bars, with its movement history](docs/stock.png)

![Checking a design: one line short, and the refused reservation](docs/check-design.png)

## Run it

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/). From `vention/snack5-inventory`:

```powershell
docker compose --profile postgres up --build    # PostgreSQL
# or
docker compose --profile mongo up --build       # MongoDB
```

Open **http://localhost:8081**. The badge in the top right says which database is answering.
Stop with `Ctrl+C`; `docker compose --profile postgres down -v` (or `mongo`) also deletes that database's volume.
Run one profile at a time: both serve the same port.

**The floor's size** (for the robot arm's scene) is one setting, `FLOOR_SIZE`, in meters across (default 20):

```powershell
$env:FLOOR_SIZE="30";  docker compose --profile postgres up --build     # a 30 m × 30 m floor
```

The API checks every position against it, the arm app reads it from `GET /api/config`, and PostgreSQL's floor
checks are rebuilt from it on every start. To change the default for good, edit `DEFAULT_FLOOR_SIZE` in
[`api/src/domain/floor.ts`](api/src/domain/floor.ts).

**Contract tests against both real databases** (throwaway containers, your data isn't touched):

```powershell
docker compose --profile test run --rm --build api-test
docker compose --profile test down
```

**Without Docker** (Node.js 22.18 or newer, which runs TypeScript directly):

```powershell
cd api;  npm install;  npm test            # unit + API tests; database tests skip themselves
$env:DB="memory";  npm start               # API on :8080 with no database
cd ../web;  npm install;  npm run dev      # http://localhost:5173, proxies /api to :8080
```

## Run on Kubernetes (Docker Desktop)

Same setup as `Full Stack/node-postgres` (Kubernetes enabled, cluster type kubeadm). Build the images, then apply the overlay for the database you want:

```powershell
docker compose --profile postgres build          # builds inventory-api:1.0 and inventory-web:1.0
kubectl apply -k k8s/postgres                    # or: kubectl apply -k k8s/mongo
kubectl get pods -n inventory -w
```

Open **http://localhost:8081**. To switch databases, delete the namespace first, so the other
database's StatefulSet doesn't linger: `kubectl delete namespace inventory`.

Two API replicas run behind one service. The badge shows which pod answered; refresh to see both.
Try reserving the same last actuators from two browser windows at once: one gets them, the
other is told exactly what's short.

## How it's built

```
browser ──► web (nginx) ──/api──► api (2 replicas) ──► PostgreSQL   (DB=postgres)
            React app              Node.js, TypeScript  └─► MongoDB   (DB=mongo)
                                   one InventoryRepo interface
```

```
snack5-inventory/
├── api/
│   ├── src/
│   │   ├── domain/        types + InventoryRepo interface, design → stock (bin packing), seed stock
│   │   ├── db/
│   │   │   ├── postgres.ts        + schema.sql (tables, CHECK constraints, PL/pgSQL functions)
│   │   │   ├── postgres-sql.ts    every SQL statement, in one place
│   │   │   ├── mongo.ts           conditional atomic updates
│   │   │   ├── memory.ts          the reference implementation
│   │   │   └── index.ts           picks one from DB=
│   │   ├── service.ts     check / reserve a design
│   │   ├── app.ts         HTTP routes (node:http, no framework)
│   │   └── server.ts      startup: wait for the database, create schema, seed, listen
│   └── tests/             contract.ts (run on each database), design, API
├── web/                   React app + nginx.conf
├── k8s/
│   ├── base/              namespace, API, web
│   ├── postgres/          overlay: StatefulSet + config for DB=postgres
│   └── mongo/             overlay: StatefulSet + config for DB=mongo
└── docker-compose.yml     profiles: postgres, mongo, test
```

## The same rules, two databases

| Rule | PostgreSQL | MongoDB |
|---|---|---|
| Stock never negative; reserved ≤ on hand | `CHECK` constraints on the table: the database refuses, whatever the code does | Written into every update's filter |
| Consume only what's available | `UPDATE … WHERE on_hand - reserved >= $2`, re-checked by Postgres if two updates race | `findOneAndUpdate({ _id, $expr: onHand - reserved >= qty })`: single-document updates are atomic |
| Change + ledger entry together | One statement: the UPDATE and the movements INSERT in a CTE | Two writes; the ledger gets a sequence number from a counter document |
| Reserve several parts, all or nothing | `inv_reserve()`: one transaction, rows locked `FOR UPDATE` in SKU order (no deadlocks), check, then reserve | A saga: pending reservation, a conditional hold per line in SKU order, undo the holds if any fails |
| Close a reservation exactly once | `inv_close_reservation()` locks the reservation row | Claim it by flipping its status with a conditional update |
| Data model | Normalized: `parts`, `reservations`, `reservation_lines`, `movements` | Documents: a reservation embeds its lines; the SKU is the part's `_id` |

**The trade-off in one sentence:** Postgres gives multi-row transactions, so a reservation is
invisible until it's complete; MongoDB guarantees atomicity per document, so the reservation is
built from atomic steps and a racing request can briefly see a hold that's about to be undone
(it may be refused when it could have fit, but stock is never over-promised). With a MongoDB
replica set, the same steps could run inside a multi-document transaction instead.

## API

| Method | Path | Body | Result |
|---|---|---|---|
| GET | `/api/parts?search=&low=true` | | Parts, filtered |
| POST | `/api/parts` | `{ "sku": "PL-400", "name": "...", "category": "plate", "unit": "plate", "onHand": 10, "reorderLevel": 4, "location": "B-01-4" }` | 201 + new part, 409 if the SKU exists, 400 with every problem listed |
| GET | `/api/parts/{sku}` | | One part |
| POST | `/api/parts/{sku}/receive` | `{ "qty": 10, "note": "PO-1" }` | Updated part |
| POST | `/api/parts/{sku}/consume` | `{ "qty": 2, "note": "" }` | Updated part, or 409 if not enough is available |
| GET | `/api/movements?sku=&limit=` | | Ledger, newest first |
| POST | `/api/check` | `{ "design": { "items": [...] } }` | Stock lines needed, available, short |
| POST | `/api/reservations` | `{ "quoteRef": "Q-1", "design": {...} }` | 201 + reservation, or 409 + shortages (nothing held) |
| GET | `/api/reservations` | | Newest first |
| POST | `/api/reservations/{id}/release` | | Stock goes back to available |
| POST | `/api/reservations/{id}/fulfil` | | Stock leaves the shelf |
| GET | `/api/shapes` | | Shapes in the robot arm's scene, oldest first |
| POST | `/api/shapes` | `{ "name": "Crate", "kind": "box", "size": { "x": 0.3, "y": 0.2, "z": 0.25 }, "color": "#d97706", "position": { "x": 0.5, "z": -0.2 }, "rotationY": 15 }` | 201 + shape (meters, degrees; round shapes' depth follows the diameter). Positions of shapes, belts and bins are within 10 m of the arm's base each way |
| PATCH | `/api/shapes/{id}` | `{ "position": {...} }`, `name`, `color` or `rotationY` | Updated shape |
| DELETE | `/api/shapes/{id}` | | `{ "deleted": id }`, or 404 |
| GET | `/api/conveyors` | | Conveyor belts in the robot arm's scene, oldest first |
| POST | `/api/conveyors` | `{ "name": "Infeed", "length": 1.5, "width": 0.3, "height": 0.3, "speed": 0.2, "position": { "x": 0.7, "z": -0.6 }, "rotationY": 0 }` | 201 + belt (meters, m/s, degrees; speed defaults to 0.2, rotationY to 0) |
| POST | `/api/conveyors` (a section) | add `"kind": "curve", "turn": 90, "radius": 0.5` (or `"transfer"`, `"turn": -90`), `"lineId": "<uuid>", "lineIndex": 1` | 201 + section. A curve's length is its arc and a transfer's its width; both are computed. `kind` defaults to `straight`, `lineId` to null |
| PATCH | `/api/conveyors/{id}` | `name`, `position`, `rotationY`, `speed`, `lineId` or `lineIndex` | Updated belt (size can't change: make a new belt) |
| PATCH | `/api/conveyors` | `{ "updates": [{ "id": "…", "position": {…}, "rotationY": 90 }, …] }` (1–200) | Every updated belt, or an error and nothing changed (one transaction in PostgreSQL) |
| DELETE | `/api/conveyors/{id}` | | `{ "deleted": id }`, or 404 |
| GET | `/api/splitters` | | Splitters (diverter gates on belts) with their rules, oldest first |
| POST | `/api/splitters` | `{ "name": "Sort gate", "conveyorId": "…", "along": 1.2, "rules": [{ "conditions": [{ "field": "part.category", "op": "eq", "value": "plate" }], "exit": "left" }], "otherwise": "straight" }` | 201 + splitter (`along` in meters from the belt's start, at most its length) |
| PATCH | `/api/splitters/{id}` | `name`, `along`, `rules` (the whole list, in order) or `otherwise` | Updated splitter |
| DELETE | `/api/splitters/{id}` | | `{ "deleted": id }`, or 404. Deleting a belt deletes its splitters |
| GET | `/api/connectors` | | `{ defaultPoints, connectors }`: stored connection points per kind of object |
| PUT | `/api/connectors/{owner}` | `{ "points": [{ "name": "hole", "x": -0.25, "y": 0.5, "z": 0 }] }` | Replaces the points for `part:<SKU>` or `kind:<box\|cylinder\|sphere\|cone>`. Positions are fractions of the size, −0.5 to 0.5 |
| DELETE | `/api/connectors/{owner}` | | Back to the defaults (top and bottom) |
| GET / POST | `/api/mergers` | `{ "name", "kind": "side"\|"y", "conveyorId", "along", "feederIds": [...], "priority": "main"\|"feeders"\|"alternate", "gap" }` | List, or 201 + merger. Side: one feeder; Y: two, and `along` is 0 |
| PATCH / DELETE | `/api/mergers/{id}` | `name`, `along`, `priority` or `gap` | Updated merger / `{ "deleted": id }`. Deleting any belt it uses deletes it |
| GET / POST | `/api/machines` | `{ "name", "conveyorId", "along", "base": { "owner": "part:PL-200", "point": "hole" }, "attach": { "owner": "kind:cylinder", "point": "bottom" }, "cycleSeconds": 1.5 }` | List, or 201 + machine |
| PATCH / DELETE | `/api/machines/{id}` | `name`, `along`, `base`, `attach` or `cycleSeconds` | Updated machine / `{ "deleted": id }` |
| GET | `/api/assemblies?limit=50` | | Assemblies, newest first, with the parts each used |
| POST | `/api/assemblies` | `{ "name", "baseShapeId", "attachedShapeId", "basePoint", "attachedPoint", "attachment": { "x", "y", "z", "rotationY" } }` | 201 + assembly. 409 if the shape is already joined, the join would loop, or stock is short (with `shortages`); 404 if a shape is missing |
| GET / POST | `/api/bins` | `{ "name", "holds": ["part:PL-200", "kind:cylinder"], "accept": [conditions], "capacity": 50, "position": { "x", "z" }, "rotationY", "feed": { "type": "none" } \| { "type": "belt", "conveyorId", "along", "mode": "steady"\|"demand" } \| { "type": "machine", "machineId" } }` | List (each with its `count`), or 201 + bin |
| PATCH / DELETE | `/api/bins/{id}` | `name`, `holds`, `accept`, `capacity`, `position`, `rotationY` or `feed` | Updated bin / deleted (409 while it holds anything) |
| POST | `/api/bins/{id}/load` | `{ "qty": 10, "owner": "part:PL-200", "look": { "kind", "size", "color", "name" } }` | `{ count }`. One of the bin's kinds; takes parts from stock, all or nothing; 409 if short, full or not a kind it holds |
| POST | `/api/bins/{id}/unload` | `{ "qty": 10 }` | `{ unloaded }`: plain items out, parts back into stock |
| POST | `/api/bins/{id}/catch` | `{ "shapeId" }` | Stores a free shape (and anything joined to it); its parts are taken from stock if they haven't been. 409 if wrong kind, full or short |
| POST | `/api/bins/{id}/release` | `{ "shapeId", "position": { "x", "z" } }` | Puts a stored shape back on the floor |
| GET / POST | `/api/robots` | `{ "name", "position": { "x", "z" }, "rotationY", "pick": { "x", "z", "radius" }, "rules": [{ "conditions": [...], "target": { "type": "spot", "x", "z" } \| { "type": "belt", "conveyorId", "along" } \| { "type": "bin", "binId" } }], "otherwise": target or null }` | List, or 201 + robot. `pick` defaults to half a meter in front |
| PATCH / DELETE | `/api/robots/{id}` | `name`, `position`, `rotationY`, `pick`, `rules` or `otherwise` | Updated robot / `{ "deleted": id }` |
| DELETE | `/api/scene` | | `{ cleared: { shapes, conveyors, bins, robots } }`: everything in the arm's scene goes (splitters, mergers and machines with their belts); stock stays |
| GET | `/api/config` | | `{ floorSize, floorHalf }`: the floor's size in meters (`FLOOR_SIZE`) |
| PATCH | `/api/parts/{sku}` | `name`, `category`, `location` or `reorderLevel` | Updated part. Stock fields are refused: use receive/consume |

Rule fields: `kind`, `color`, `name`, `sku`, `width`, `height`, `depth` (meters), `isPart`, `part.category`, `part.location`,
`part.name`, `part.onHand`, `part.available`, `part.low`. Operators: `eq`, `ne`, `in` (a list), `contains` for text;
`eq`, `ne`, `lt`, `lte`, `gt`, `gte` for numbers; `eq` for true/false. Text is compared ignoring case. Up to 20 rules of up
to 5 conditions each; the first rule whose conditions all hold picks the exit (`left`, `straight`, `right`).
| GET | `/api/health/live`, `/api/health/ready`, `/api/info` | | Liveness, database reachable, which database and pod |

Browsers on other `http://localhost:<port>` pages may call the API (CORS), which is how the robot
arm's dev server uses it. Set `CORS_ORIGINS` to a comma-separated list to allow other origins instead.

## Testing

- **Contract tests** (`tests/contract.ts`, 27 tests) run against every implementation: filtering, the
  ledger, all-or-nothing reservations, consuming around reservations, closing exactly once, and
  concurrency (8 simultaneous reservations for 3 actuators: exactly 3 succeed).
  The in-memory run is part of `npm test`; Postgres and MongoDB run with `--profile test`.
- **Design tests:** the bar packing (kerf, splicing, first-fit decreasing beating in-order packing) and
  Snack 4's demo design turned into stock.
- **API tests:** every route end to end on a random port, including validation and the 409 paths.

## Design decisions

- **One interface, three implementations.** The routes don't know which database they're on. The in-memory
  version is the reference: it defines the behaviour, runs the API tests, and runs the app with no database.
- **Rules in the database, not just the code.** Postgres `CHECK` constraints and conditional Mongo updates
  hold even if two API replicas race, which is the situation Kubernetes creates on purpose.
- **Lock in a fixed order.** Every multi-row operation locks parts sorted by SKU, so two reservations
  touching the same parts in a different order queue up instead of deadlocking.
- **A ledger, not just counters.** Every change writes a movement. The numbers on the stock page can
  always be explained, line by line.
- **Designs are Snack 4's format.** The two projects share a vocabulary (SKUs, profiles, packs), so a quote
  and a stock check are about the same machine.
- **No API framework.** A dozen routes fit in one file on `node:http`. Node 22 runs the TypeScript
  directly, so the API image has no build step.

## What I'd add next

- Reservations that expire, so abandoned quotes give their stock back
- Purchase orders that receive against expected quantities, and reorder suggestions from the low-stock list
- MongoDB as a replica set, with the reservation saga replaced by a transaction
- Migrations (e.g. node-pg-migrate) instead of schema-on-startup
- Authentication, and who-did-what on each ledger line
