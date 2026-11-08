-- Inventory schema for PostgreSQL. Run on every API start: everything is idempotent.
--
-- The database itself enforces the stock rules, so no bug or race in the API can break them:
--   on_hand >= 0, reserved >= 0, reserved <= on_hand.

CREATE TABLE IF NOT EXISTS parts (
  sku            text PRIMARY KEY,
  name           text NOT NULL,
  category       text NOT NULL,
  unit           text NOT NULL,
  on_hand        integer NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  reserved       integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  reorder_level  integer NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  location       text NOT NULL DEFAULT '',
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reserved_within_stock CHECK (reserved <= on_hand)
);

CREATE TABLE IF NOT EXISTS reservations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_ref   text NOT NULL,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released', 'fulfilled')),
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  closed_at   timestamptz
);

CREATE TABLE IF NOT EXISTS reservation_lines (
  reservation_id  uuid NOT NULL REFERENCES reservations (id) ON DELETE CASCADE,
  sku             text NOT NULL REFERENCES parts (sku),
  qty             integer NOT NULL CHECK (qty > 0),
  PRIMARY KEY (reservation_id, sku)
);

-- The stock ledger: one row per change, never updated.
CREATE TABLE IF NOT EXISTS movements (
  id              bigserial PRIMARY KEY,
  sku             text NOT NULL REFERENCES parts (sku),
  kind            text NOT NULL CHECK (kind IN ('receive', 'consume', 'reserve', 'release', 'fulfil')),
  qty             integer NOT NULL CHECK (qty > 0),
  note            text NOT NULL DEFAULT '',
  reservation_id  uuid REFERENCES reservations (id) ON DELETE CASCADE,
  at              timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS movements_by_sku ON movements (sku, id DESC);
CREATE INDEX IF NOT EXISTS reservations_by_date ON reservations (created_at DESC);

-- Shapes placed in the robot arm's scene (Snack 1). Sizes and positions in meters.
CREATE TABLE IF NOT EXISTS shapes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  kind        text NOT NULL CHECK (kind IN ('box', 'cylinder', 'sphere', 'cone')),
  size_x      double precision NOT NULL CHECK (size_x BETWEEN 0.01 AND 2),
  size_y      double precision NOT NULL CHECK (size_y BETWEEN 0.01 AND 2),
  size_z      double precision NOT NULL CHECK (size_z BETWEEN 0.01 AND 2),
  color       text NOT NULL CHECK (color ~ '^#[0-9a-f]{6}$'),
  x           double precision NOT NULL CHECK (x BETWEEN -3 AND 3),
  z           double precision NOT NULL CHECK (z BETWEEN -3 AND 3),
  rotation_y  double precision NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- A shape can stand for an inventory part. Added separately so databases created before it gain the column.
ALTER TABLE shapes ADD COLUMN IF NOT EXISTS sku text REFERENCES parts (sku);
CREATE INDEX IF NOT EXISTS shapes_by_sku ON shapes (sku);

-- Conveyor belts in the robot arm's scene. Meters, meters per second, degrees.
CREATE TABLE IF NOT EXISTS conveyors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  length      double precision NOT NULL CHECK (length BETWEEN 0.3 AND 4),
  width       double precision NOT NULL CHECK (width BETWEEN 0.1 AND 1.2),
  height      double precision NOT NULL CHECK (height BETWEEN 0.05 AND 1.2),
  speed       double precision NOT NULL DEFAULT 0.2 CHECK (speed BETWEEN -1 AND 1),
  x           double precision NOT NULL CHECK (x BETWEEN -3 AND 3),
  z           double precision NOT NULL CHECK (z BETWEEN -3 AND 3),
  rotation_y  double precision NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Splitters: diverter gates on a belt, with their sorting rules. The rules are a list of
-- objects that the API validates and only the arm app interprets, so they're stored as one
-- jsonb value rather than spread over rule and condition tables. Deleting a belt deletes its
-- splitters (ON DELETE CASCADE).
CREATE TABLE IF NOT EXISTS splitters (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  conveyor_id  uuid NOT NULL REFERENCES conveyors (id) ON DELETE CASCADE,
  along        double precision NOT NULL CHECK (along BETWEEN 0 AND 4),
  rules        jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(rules) = 'array' AND jsonb_array_length(rules) <= 20),
  otherwise    text NOT NULL DEFAULT 'straight' CHECK (otherwise IN ('left', 'straight', 'right')),
  created_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at   timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS splitters_conveyor ON splitters (conveyor_id);

-- Reserve every line of a quote, or nothing.
--   p_lines: [{"sku": "PL-200", "qty": 4}, ...]
--   returns {"ok": true, "id": "<uuid>"} or {"ok": false, "shortages": [...]}
--
-- The rows are locked (FOR UPDATE) in SKU order before anything is checked. Two quotes
-- reserving the same parts at the same moment therefore run one after the other, and
-- always lock in the same order, so they can't deadlock.
CREATE OR REPLACE FUNCTION inv_reserve(p_quote text, p_lines jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
  v_wanted jsonb;
  v_shortages jsonb;
BEGIN
  -- Add up lines with the same SKU: [{"sku", "qty"}], sorted by SKU.
  SELECT coalesce(jsonb_agg(jsonb_build_object('sku', sku, 'qty', qty) ORDER BY sku), '[]')
    INTO v_wanted
    FROM (SELECT l ->> 'sku' AS sku, sum((l ->> 'qty')::integer) AS qty
            FROM jsonb_array_elements(p_lines) AS l GROUP BY 1) AS t;

  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(v_wanted) AS w (sku text, qty integer) WHERE qty <= 0) THEN
    RAISE EXCEPTION 'quantities must be positive' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM parts
    WHERE sku IN (SELECT w.sku FROM jsonb_to_recordset(v_wanted) AS w (sku text, qty integer))
    ORDER BY sku FOR UPDATE;

  SELECT jsonb_agg(jsonb_build_object(
           'sku', w.sku, 'need', w.qty,
           'available', coalesce(p.on_hand - p.reserved, 0),
           'known', p.sku IS NOT NULL) ORDER BY w.sku)
    INTO v_shortages
    FROM jsonb_to_recordset(v_wanted) AS w (sku text, qty integer)
    LEFT JOIN parts p ON p.sku = w.sku
    WHERE p.sku IS NULL OR p.on_hand - p.reserved < w.qty;

  IF v_shortages IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'shortages', v_shortages);
  END IF;

  INSERT INTO reservations (quote_ref) VALUES (p_quote) RETURNING id INTO v_id;
  INSERT INTO reservation_lines (reservation_id, sku, qty)
    SELECT v_id, w.sku, w.qty FROM jsonb_to_recordset(v_wanted) AS w (sku text, qty integer);
  UPDATE parts p SET reserved = p.reserved + w.qty, updated_at = now()
    FROM jsonb_to_recordset(v_wanted) AS w (sku text, qty integer) WHERE p.sku = w.sku;
  INSERT INTO movements (sku, kind, qty, note, reservation_id)
    SELECT w.sku, 'reserve', w.qty, 'Reserved for ' || p_quote, v_id
      FROM jsonb_to_recordset(v_wanted) AS w (sku text, qty integer) ORDER BY w.sku;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

-- Release (give the stock back) or fulfil (ship it) an active reservation.
-- Returns 'ok', 'not_found', or the reservation's current status if it isn't active.
CREATE OR REPLACE FUNCTION inv_close_reservation(p_id uuid, p_action text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
  v_quote text;
BEGIN
  IF p_action NOT IN ('release', 'fulfil') THEN
    RAISE EXCEPTION 'unknown action %', p_action USING ERRCODE = '22023';
  END IF;

  SELECT status, quote_ref INTO v_status, v_quote FROM reservations WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_status <> 'active' THEN RETURN v_status; END IF;

  PERFORM 1 FROM parts WHERE sku IN (SELECT sku FROM reservation_lines WHERE reservation_id = p_id) ORDER BY sku FOR UPDATE;

  UPDATE parts p
     SET reserved = p.reserved - l.qty,
         on_hand = CASE WHEN p_action = 'fulfil' THEN p.on_hand - l.qty ELSE p.on_hand END,
         updated_at = now()
    FROM reservation_lines l
   WHERE l.reservation_id = p_id AND p.sku = l.sku;

  INSERT INTO movements (sku, kind, qty, note, reservation_id)
    SELECT sku, p_action, qty,
           CASE WHEN p_action = 'fulfil' THEN 'Shipped for ' ELSE 'Released for ' END || v_quote, p_id
      FROM reservation_lines WHERE reservation_id = p_id ORDER BY sku;

  UPDATE reservations
     SET status = CASE WHEN p_action = 'fulfil' THEN 'fulfilled' ELSE 'released' END, closed_at = now()
   WHERE id = p_id;
  RETURN 'ok';
END;
$$;
