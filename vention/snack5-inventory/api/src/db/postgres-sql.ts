/**
 * Every SQL statement PostgresRepo runs, in one dependency-free module so they can also be
 * exercised directly with psql, without the Node driver.
 */
export const Q = {
  listParts: `
    SELECT sku, name, category, unit, on_hand, reserved, reorder_level, location, updated_at
      FROM parts
     WHERE ($1::text IS NULL OR sku ILIKE '%' || $1 || '%' OR name ILIKE '%' || $1 || '%')
       AND (NOT $2::boolean OR on_hand - reserved <= reorder_level)
     ORDER BY sku`,
  getParts: `
    SELECT sku, name, category, unit, on_hand, reserved, reorder_level, location, updated_at
      FROM parts WHERE sku = ANY($1::text[]) ORDER BY sku`,
  createPart: `
    WITH p AS (
      INSERT INTO parts (sku, name, category, unit, on_hand, reorder_level, location)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (sku) DO NOTHING
      RETURNING sku, name, category, unit, on_hand, reserved, reorder_level, location, updated_at
    ), m AS (
      INSERT INTO movements (sku, kind, qty, note) SELECT sku, 'receive', on_hand, 'Initial stock' FROM p WHERE on_hand > 0
    )
    SELECT * FROM p`,
  receive: `
    WITH p AS (
      UPDATE parts SET on_hand = on_hand + $2, updated_at = now() WHERE sku = $1
      RETURNING sku, name, category, unit, on_hand, reserved, reorder_level, location, updated_at
    ), m AS (
      INSERT INTO movements (sku, kind, qty, note) SELECT sku, 'receive', $2, $3 FROM p
    )
    SELECT * FROM p`,
  consume: `
    WITH p AS (
      UPDATE parts SET on_hand = on_hand - $2, updated_at = now()
       WHERE sku = $1 AND on_hand - reserved >= $2
      RETURNING sku, name, category, unit, on_hand, reserved, reorder_level, location, updated_at
    ), m AS (
      INSERT INTO movements (sku, kind, qty, note) SELECT sku, 'consume', $2, $3 FROM p
    )
    SELECT * FROM p`,
  movements: `
    SELECT id, sku, kind, qty, note, reservation_id, at FROM movements
     WHERE ($1::text IS NULL OR sku = $1)
     ORDER BY id DESC LIMIT $2`,
  reserve: `SELECT inv_reserve($1, $2::jsonb) AS result`,
  close: `SELECT inv_close_reservation($1::uuid, $2) AS result`,
  reservations: `
    SELECT r.id, r.quote_ref, r.status, r.created_at, r.closed_at,
           coalesce(jsonb_agg(jsonb_build_object('sku', l.sku, 'qty', l.qty) ORDER BY l.sku)
                    FILTER (WHERE l.sku IS NOT NULL), '[]') AS lines
      FROM reservations r LEFT JOIN reservation_lines l ON l.reservation_id = r.id
     WHERE ($1::uuid IS NULL OR r.id = $1)
     GROUP BY r.id
     ORDER BY r.created_at DESC, r.id
     LIMIT $2`,
  listShapes: `
    SELECT id, name, kind, size_x, size_y, size_z, color, x, z, rotation_y, sku, created_at, updated_at
      FROM shapes ORDER BY created_at, id`,
  createShape: `
    INSERT INTO shapes (name, kind, size_x, size_y, size_z, color, x, z, rotation_y, sku)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING id, name, kind, size_x, size_y, size_z, color, x, z, rotation_y, sku, created_at, updated_at`,
  updateShape: `
    UPDATE shapes
       SET name = coalesce($2, name), color = coalesce($3, color),
           x = coalesce($4, x), z = coalesce($5, z), rotation_y = coalesce($6, rotation_y),
           updated_at = clock_timestamp()
     WHERE id = $1
    RETURNING id, name, kind, size_x, size_y, size_z, color, x, z, rotation_y, sku, created_at, updated_at`,
  deleteShape: `DELETE FROM shapes WHERE id = $1 RETURNING id`,
  count: `SELECT count(*)::int AS n FROM parts`,
  insertPart: `
    INSERT INTO parts (sku, name, category, unit, on_hand, reorder_level, location)
    VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (sku) DO NOTHING`,
  reset: `TRUNCATE shapes, movements, reservation_lines, reservations, parts RESTART IDENTITY`,
} as const;
