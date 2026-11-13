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
  x           double precision NOT NULL, -- on the floor: checked below (floor_check)
  z           double precision NOT NULL,
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
  length      double precision NOT NULL, -- checked below, with the section fields
  width       double precision NOT NULL CHECK (width BETWEEN 0.1 AND 1.2),
  height      double precision NOT NULL CHECK (height BETWEEN 0.05 AND 1.2),
  speed       double precision NOT NULL DEFAULT 0.2 CHECK (speed BETWEEN -1 AND 1),
  x           double precision NOT NULL, -- on the floor: checked below (floor_check)
  z           double precision NOT NULL,
  rotation_y  double precision NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Sections of a conveyor line: straight, curve or transfer, and which line, in what order.
-- Added separately so databases created before lines existed gain the columns; their belts
-- become straight sections on their own.
ALTER TABLE conveyors ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'straight';
ALTER TABLE conveyors ADD COLUMN IF NOT EXISTS turn double precision NOT NULL DEFAULT 0;
ALTER TABLE conveyors ADD COLUMN IF NOT EXISTS radius double precision NOT NULL DEFAULT 0;
ALTER TABLE conveyors ADD COLUMN IF NOT EXISTS line_id uuid;
ALTER TABLE conveyors ADD COLUMN IF NOT EXISTS line_index integer NOT NULL DEFAULT 0;
-- A curve or transfer can be shorter than the 0.3 m a straight belt starts at, so the
-- original length check is replaced by one covering every section field.
ALTER TABLE conveyors DROP CONSTRAINT IF EXISTS conveyors_length_check;
DO $$ BEGIN
  ALTER TABLE conveyors ADD CONSTRAINT conveyors_section_check CHECK (
    length BETWEEN 0.05 AND 4
    AND kind IN ('straight', 'curve', 'transfer')
    AND turn BETWEEN -90 AND 90
    AND radius BETWEEN 0 AND 2
    AND line_index BETWEEN 0 AND 999);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS conveyors_by_line ON conveyors (line_id, line_index);

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

-- A shape joined onto another moves with it. Deleting the base deletes what's joined to it,
-- since together they're one object now.
ALTER TABLE shapes ADD COLUMN IF NOT EXISTS attached_to uuid REFERENCES shapes (id) ON DELETE CASCADE;
ALTER TABLE shapes ADD COLUMN IF NOT EXISTS attach jsonb;
-- True once a shape's part has left stock (loaded into a bin, caught by one, or joined): never taken twice.
ALTER TABLE shapes ADD COLUMN IF NOT EXISTS stock_taken boolean NOT NULL DEFAULT false;

-- Connection points for a kind of object: an inventory part ('part:PL-200') or a plain shape
-- kind ('kind:box'). Positions are fractions of the object's size, so they fit every size.
CREATE TABLE IF NOT EXISTS connectors (
  owner       text PRIMARY KEY CHECK (owner ~ '^(part:[A-Z0-9][A-Z0-9-]{1,31}|kind:(box|cylinder|sphere|cone))$'),
  points      jsonb NOT NULL CHECK (jsonb_typeof(points) = 'array' AND jsonb_array_length(points) <= 12),
  updated_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Where belts come together. Feeders are an array: a foreign key can't point into one, so the
-- repository deletes a merger when one of its feeders is deleted.
CREATE TABLE IF NOT EXISTS mergers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  kind         text NOT NULL CHECK (kind IN ('side', 'y')),
  conveyor_id  uuid NOT NULL REFERENCES conveyors (id) ON DELETE CASCADE,
  along        double precision NOT NULL CHECK (along BETWEEN 0 AND 4),
  feeder_ids   uuid[] NOT NULL CHECK (cardinality(feeder_ids) BETWEEN 1 AND 2),
  priority     text NOT NULL CHECK (priority IN ('main', 'feeders', 'alternate')),
  gap          double precision NOT NULL CHECK (gap BETWEEN 0.05 AND 1),
  created_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at   timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Joining stations on a belt: take one item of each kind and join them at their connection points.
CREATE TABLE IF NOT EXISTS machines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  conveyor_id    uuid NOT NULL REFERENCES conveyors (id) ON DELETE CASCADE,
  along          double precision NOT NULL CHECK (along BETWEEN 0 AND 4),
  base_owner     text NOT NULL,
  base_point     text NOT NULL,
  attach_owner   text NOT NULL,
  attach_point   text NOT NULL,
  cycle_seconds  double precision NOT NULL CHECK (cycle_seconds BETWEEN 0.2 AND 10),
  created_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at     timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- A record of each join. No foreign keys to shapes: the history stays if the shapes are deleted.
CREATE TABLE IF NOT EXISTS assemblies (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  base_shape_id      uuid NOT NULL,
  attached_shape_id  uuid NOT NULL,
  base_point         text NOT NULL,
  attached_point     text NOT NULL,
  consumed           jsonb NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS assemblies_base ON assemblies (base_shape_id);
CREATE INDEX IF NOT EXISTS assemblies_attached ON assemblies (attached_shape_id);

-- Join one shape onto another, using up their parts from stock: all or nothing.
--   returns {"ok": true, "id": "<assembly id>"} or {"ok": false, "reason": ..., "shortages": [...]}
--
-- Like inv_reserve, it locks before it checks: both shapes (in id order), then the parts it
-- needs (in SKU order), so two joins touching the same things queue up instead of racing.
-- A shape's part is used up the first time that shape is joined to anything; joining an
-- assembly to a third object doesn't use the first two parts again.
CREATE OR REPLACE FUNCTION inv_assemble(p_name text, p_base uuid, p_attached uuid, p_base_point text, p_attached_point text, p_attach jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_found int;
  v_need jsonb;
  v_short jsonb;
  v_id uuid;
BEGIN
  PERFORM 1 FROM shapes WHERE id IN (p_base, p_attached) ORDER BY id FOR UPDATE;
  SELECT count(*) INTO v_found FROM shapes WHERE id IN (p_base, p_attached);
  IF v_found < 2 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF (SELECT attached_to IS NOT NULL FROM shapes WHERE id = p_attached) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_attached');
  END IF;
  -- The attached shape mustn't be the base, or anything the base already hangs from.
  IF EXISTS (
    WITH RECURSIVE up (id, parent, depth) AS (
      SELECT id, attached_to, 0 FROM shapes WHERE id = p_base
      UNION ALL
      SELECT s.id, s.attached_to, up.depth + 1 FROM shapes s JOIN up ON s.id = up.parent WHERE up.depth < 50
    )
    SELECT 1 FROM up WHERE id = p_attached
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cycle');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('sku', sku, 'qty', qty) ORDER BY sku), '[]'::jsonb) INTO v_need
    FROM (
      SELECT s.sku, count(*)::int AS qty FROM shapes s
       WHERE s.id IN (p_base, p_attached) AND s.sku IS NOT NULL AND NOT s.stock_taken
         AND NOT EXISTS (SELECT 1 FROM assemblies a WHERE s.id IN (a.base_shape_id, a.attached_shape_id))
       GROUP BY s.sku
    ) n;
  PERFORM 1 FROM parts WHERE sku IN (SELECT x ->> 'sku' FROM jsonb_array_elements(v_need) x) ORDER BY sku FOR UPDATE;
  SELECT coalesce(jsonb_agg(jsonb_build_object('sku', n.sku, 'need', n.qty, 'available', p.on_hand - p.reserved) ORDER BY n.sku), '[]'::jsonb)
    INTO v_short
    FROM jsonb_to_recordset(v_need) AS n (sku text, qty int) JOIN parts p ON p.sku = n.sku
   WHERE p.on_hand - p.reserved < n.qty;
  IF jsonb_array_length(v_short) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'short', 'shortages', v_short);
  END IF;

  INSERT INTO assemblies (name, base_shape_id, attached_shape_id, base_point, attached_point, consumed)
  VALUES (p_name, p_base, p_attached, p_base_point, p_attached_point, v_need)
  RETURNING id INTO v_id;
  UPDATE parts p SET on_hand = p.on_hand - n.qty, updated_at = now()
    FROM jsonb_to_recordset(v_need) AS n (sku text, qty int) WHERE p.sku = n.sku;
  INSERT INTO movements (sku, kind, qty, note)
  SELECT n.sku, 'consume', n.qty, 'Assembly ' || p_name || ' (' || v_id || ')' FROM jsonb_to_recordset(v_need) AS n (sku text, qty int);
  UPDATE shapes SET attached_to = p_base, attach = p_attach, updated_at = clock_timestamp() WHERE id = p_attached;
  UPDATE shapes SET stock_taken = true WHERE id IN (p_base, p_attached) AND sku IS NOT NULL;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;

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

-- Bins: containers on the floor holding the kinds of object listed in `holds`. Stored items are shapes with
-- bin_id set. A bin can't be deleted while it holds anything (ON DELETE RESTRICT).
CREATE TABLE IF NOT EXISTS bins (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  -- Each kind like a connector's owner. A CHECK can't loop over an array, so it checks them
  -- joined into one string: kind(,kind)*.
  holds       text[] NOT NULL CHECK (cardinality(holds) BETWEEN 1 AND 10 AND array_to_string(holds, ',') ~
                '^(part:[A-Z0-9][A-Z0-9-]{1,31}|kind:(box|cylinder|sphere|cone))(,(part:[A-Z0-9][A-Z0-9-]{1,31}|kind:(box|cylinder|sphere|cone)))*$'),
  accept      jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(accept) = 'array' AND jsonb_array_length(accept) <= 5),
  capacity    integer NOT NULL CHECK (capacity BETWEEN 1 AND 200),
  x           double precision NOT NULL, -- on the floor: checked below (floor_check)
  z           double precision NOT NULL,
  rotation_y  double precision NOT NULL DEFAULT 0,
  feed        jsonb NOT NULL DEFAULT '{"type": "none"}' CHECK (feed ->> 'type' IN ('none', 'belt', 'machine')),
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE shapes ADD COLUMN IF NOT EXISTS bin_id uuid REFERENCES bins (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS shapes_by_bin ON shapes (bin_id) WHERE bin_id IS NOT NULL;

-- Load a bin with new items, several kinds at once, taking parts from stock: all or nothing.
--   p_lines: [{"owner": "part:PL-200", "qty": 4, "name", "kind", "size": {"x", "y", "z"}, "color"}, ...]
--   p_add:   add kinds the bin doesn't hold yet to its list (otherwise they're refused)
-- Like inv_reserve: lock the bin, then the parts in SKU order, check everything, then change.
DROP FUNCTION IF EXISTS inv_bin_load(uuid, int, text, text, float8, float8, float8, text);
DROP FUNCTION IF EXISTS inv_bin_load(uuid, int, text, text, text, float8, float8, float8, text);
CREATE OR REPLACE FUNCTION inv_bin_load(p_bin uuid, p_lines jsonb, p_add boolean)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  b bins;
  v_count int;
  v_total int;
  v_missing text[];
  v_need jsonb;
  v_short text;
BEGIN
  SELECT * INTO b FROM bins WHERE id = p_bin FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  -- Lines arrive merged by kind (the API does it), so no DISTINCT: that would sort them, and the
  -- kinds should be added in the order they were listed.
  SELECT coalesce(array_agg(l ->> 'owner' ORDER BY i), '{}') INTO v_missing
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS t (l, i) WHERE NOT (l ->> 'owner') = ANY (b.holds);
  IF cardinality(v_missing) > 0 AND NOT p_add THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'wrong_kind', 'detail', b.name || ' doesn''t hold ' || array_to_string(v_missing, ', '));
  END IF;
  SELECT count(*) INTO v_count FROM shapes WHERE bin_id = p_bin;
  SELECT coalesce(sum((l ->> 'qty')::int), 0) INTO v_total FROM jsonb_array_elements(p_lines) l;
  IF v_count + v_total > b.capacity THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'full', 'detail', b.name || ' has room for ' || (b.capacity - v_count) || ' more');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('sku', sku, 'qty', qty) ORDER BY sku), '[]'::jsonb) INTO v_need
    FROM (SELECT substr(l ->> 'owner', 6) AS sku, sum((l ->> 'qty')::int)::int AS qty
            FROM jsonb_array_elements(p_lines) l WHERE l ->> 'owner' LIKE 'part:%' GROUP BY 1) n;
  PERFORM 1 FROM parts WHERE sku IN (SELECT x ->> 'sku' FROM jsonb_array_elements(v_need) x) ORDER BY sku FOR UPDATE;
  SELECT string_agg(coalesce(p.on_hand - p.reserved, 0) || ' of ' || n.sku || ' available', ', ' ORDER BY n.sku) INTO v_short
    FROM jsonb_to_recordset(v_need) AS n (sku text, qty int) LEFT JOIN parts p ON p.sku = n.sku
   WHERE coalesce(p.on_hand - p.reserved, 0) < n.qty;
  IF v_short IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'short', 'detail', v_short); END IF;

  UPDATE parts p SET on_hand = p.on_hand - n.qty, updated_at = now() FROM jsonb_to_recordset(v_need) AS n (sku text, qty int) WHERE p.sku = n.sku;
  INSERT INTO movements (sku, kind, qty, note) SELECT n.sku, 'consume', n.qty, 'Loaded into bin ' || b.name FROM jsonb_to_recordset(v_need) AS n (sku text, qty int);
  IF cardinality(v_missing) > 0 THEN
    UPDATE bins SET holds = holds || v_missing, updated_at = clock_timestamp() WHERE id = p_bin RETURNING * INTO b;
  END IF;
  INSERT INTO shapes (name, kind, size_x, size_y, size_z, color, x, z, rotation_y, sku, bin_id, stock_taken)
  SELECT l.name, CASE WHEN l.owner LIKE 'part:%' THEN l.kind ELSE substr(l.owner, 6) END,
         (l.size ->> 'x')::float8, (l.size ->> 'y')::float8, (l.size ->> 'z')::float8, l.color, b.x, b.z, 0,
         CASE WHEN l.owner LIKE 'part:%' THEN substr(l.owner, 6) END, p_bin, l.owner LIKE 'part:%'
    FROM jsonb_to_recordset(p_lines) AS l (owner text, qty int, name text, kind text, size jsonb, color text),
         generate_series(1, l.qty);
  RETURN jsonb_build_object('ok', true, 'count', v_count + v_total, 'holds', to_jsonb(b.holds));
END $$;

-- Take up to p_qty plain items out of a bin (oldest first), giving their parts back to stock.
CREATE OR REPLACE FUNCTION inv_bin_unload(p_bin uuid, p_qty int)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  b bins;
  v_ids uuid[];
BEGIN
  SELECT * INTO b FROM bins WHERE id = p_bin FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  SELECT coalesce(array_agg(id), '{}') INTO v_ids FROM (
    SELECT s.id FROM shapes s
     WHERE s.bin_id = p_bin AND NOT EXISTS (SELECT 1 FROM shapes c WHERE c.attached_to = s.id)
     ORDER BY s.created_at, s.id LIMIT p_qty FOR UPDATE
  ) t;
  WITH back AS (
    SELECT sku, count(*)::int AS qty FROM shapes WHERE id = ANY (v_ids) AND sku IS NOT NULL AND stock_taken GROUP BY sku
  ), up AS (
    UPDATE parts p SET on_hand = p.on_hand + back.qty, updated_at = now() FROM back WHERE p.sku = back.sku RETURNING p.sku, back.qty
  )
  INSERT INTO movements (sku, kind, qty, note) SELECT sku, 'receive', qty, 'Unloaded from bin ' || b.name FROM up;
  DELETE FROM shapes WHERE id = ANY (v_ids);
  RETURN jsonb_build_object('ok', true, 'unloaded', cardinality(v_ids));
END $$;

-- Store a free shape, and whatever is joined onto it, in a bin: taking from stock any part that
-- hasn't left it yet. Locks the bin first, so two catches can't overfill it.
CREATE OR REPLACE FUNCTION inv_bin_catch(p_bin uuid, p_shape uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  b bins;
  s shapes;
  v_count int;
  v_need jsonb;
  v_short text;
  v_tree uuid[];
BEGIN
  SELECT * INTO b FROM bins WHERE id = p_bin FOR UPDATE;
  SELECT * INTO s FROM shapes WHERE id = p_shape FOR UPDATE;
  IF b.id IS NULL OR s.id IS NULL OR s.attached_to IS NOT NULL OR s.bin_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF NOT coalesce('part:' || s.sku, 'kind:' || s.kind) = ANY (b.holds) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'wrong_kind');
  END IF;
  SELECT count(*) INTO v_count FROM shapes WHERE bin_id = p_bin;
  IF v_count >= b.capacity THEN RETURN jsonb_build_object('ok', false, 'reason', 'full'); END IF;

  -- The shape and everything joined onto it, all the way down.
  WITH RECURSIVE tree (id, depth) AS (
    SELECT p_shape, 0
    UNION ALL
    SELECT c.id, t.depth + 1 FROM shapes c JOIN tree t ON c.attached_to = t.id WHERE t.depth < 50
  ) SELECT array_agg(id) INTO v_tree FROM tree;

  SELECT coalesce(jsonb_agg(jsonb_build_object('sku', sku, 'qty', qty) ORDER BY sku), '[]'::jsonb) INTO v_need
    FROM (SELECT sku, count(*)::int AS qty FROM shapes WHERE id IN (SELECT unnest(v_tree)) AND sku IS NOT NULL AND NOT stock_taken GROUP BY sku) n;
  PERFORM 1 FROM parts WHERE sku IN (SELECT x ->> 'sku' FROM jsonb_array_elements(v_need) x) ORDER BY sku FOR UPDATE;
  SELECT n.sku INTO v_short FROM jsonb_to_recordset(v_need) AS n (sku text, qty int) JOIN parts p ON p.sku = n.sku
   WHERE p.on_hand - p.reserved < n.qty LIMIT 1;
  IF v_short IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'short', 'detail', 'Not enough ' || v_short || ' in stock');
  END IF;
  UPDATE parts p SET on_hand = p.on_hand - n.qty, updated_at = now() FROM jsonb_to_recordset(v_need) AS n (sku text, qty int) WHERE p.sku = n.sku;
  INSERT INTO movements (sku, kind, qty, note) SELECT n.sku, 'consume', n.qty, 'Caught in bin ' || b.name FROM jsonb_to_recordset(v_need) AS n (sku text, qty int);
  UPDATE shapes SET stock_taken = true WHERE id IN (SELECT unnest(v_tree)) AND sku IS NOT NULL;
  UPDATE shapes SET bin_id = p_bin, updated_at = clock_timestamp() WHERE id = p_shape;
  RETURN jsonb_build_object('ok', true);
END $$;

-- The floor: shapes, belts and bins within 10 m of the arm's base each way (floor.ts in the
-- API). It was 3 m; databases made then have column checks named <table>_x_check and
-- <table>_z_check, which are replaced. Safe to run every start, like the rest of this file.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['shapes', 'conveyors', 'bins'] LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_x_check');
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_z_check');
    BEGIN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (x BETWEEN -10 AND 10 AND z BETWEEN -10 AND 10)', t, t || '_floor_check');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;
