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
  updatePart: `
    UPDATE parts
       SET name = coalesce($2, name), category = coalesce($3, category),
           location = coalesce($4, location), reorder_level = coalesce($5, reorder_level), updated_at = now()
     WHERE sku = $1
    RETURNING sku, name, category, unit, on_hand, reserved, reorder_level, location, updated_at`,
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
    SELECT id, name, kind, size_x, size_y, size_z, color, x, z, rotation_y, sku, attached_to, attach, bin_id, stock_taken, created_at, updated_at
      FROM shapes ORDER BY created_at, id`,
  createShape: `
    INSERT INTO shapes (name, kind, size_x, size_y, size_z, color, x, z, rotation_y, sku)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING id, name, kind, size_x, size_y, size_z, color, x, z, rotation_y, sku, attached_to, attach, bin_id, stock_taken, created_at, updated_at`,
  updateShape: `
    UPDATE shapes
       SET name = coalesce($2, name), color = coalesce($3, color),
           x = coalesce($4, x), z = coalesce($5, z), rotation_y = coalesce($6, rotation_y),
           updated_at = clock_timestamp()
     WHERE id = $1
    RETURNING id, name, kind, size_x, size_y, size_z, color, x, z, rotation_y, sku, attached_to, attach, bin_id, stock_taken, created_at, updated_at`,
  deleteShape: `DELETE FROM shapes WHERE id = $1 RETURNING id`,
  listConveyors: `
    SELECT id, name, length, width, height, speed, x, z, rotation_y, kind, turn, radius, line_id, line_index, created_at, updated_at
      FROM conveyors ORDER BY created_at, id`,
  createConveyor: `
    INSERT INTO conveyors (name, length, width, height, speed, x, z, rotation_y, kind, turn, radius, line_id, line_index)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING id, name, length, width, height, speed, x, z, rotation_y, kind, turn, radius, line_id, line_index, created_at, updated_at`,
  // $7 says whether lineId was sent at all, since null is a value it can be set to (leaving a line).
  updateConveyor: `
    UPDATE conveyors
       SET name = coalesce($2, name), x = coalesce($3, x), z = coalesce($4, z),
           rotation_y = coalesce($5, rotation_y), speed = coalesce($6, speed),
           line_id = CASE WHEN $7 THEN $8::uuid ELSE line_id END, line_index = coalesce($9, line_index),
           updated_at = clock_timestamp()
     WHERE id = $1
    RETURNING id, name, length, width, height, speed, x, z, rotation_y, kind, turn, radius, line_id, line_index, created_at, updated_at`,
  deleteConveyor: `DELETE FROM conveyors WHERE id = $1 RETURNING id`,
  listSplitters: `
    SELECT id, name, conveyor_id, along, rules, otherwise, created_at, updated_at
      FROM splitters ORDER BY created_at, id`,
  createSplitter: `
    INSERT INTO splitters (name, conveyor_id, along, rules, otherwise)
    VALUES ($1, $2, $3, $4::jsonb, $5)
    RETURNING id, name, conveyor_id, along, rules, otherwise, created_at, updated_at`,
  updateSplitter: `
    UPDATE splitters
       SET name = coalesce($2, name), along = coalesce($3, along),
           rules = coalesce($4::jsonb, rules), otherwise = coalesce($5, otherwise),
           updated_at = clock_timestamp()
     WHERE id = $1
    RETURNING id, name, conveyor_id, along, rules, otherwise, created_at, updated_at`,
  deleteSplitter: `DELETE FROM splitters WHERE id = $1 RETURNING id`,
  // A feeder is in an array, out of a foreign key's reach: remove mergers that use the belt being deleted.
  deleteMergersFeeding: `DELETE FROM mergers WHERE $1::uuid = ANY (feeder_ids)`,
  listConnectors: `SELECT owner, points, updated_at FROM connectors ORDER BY owner`,
  setConnectors: `
    INSERT INTO connectors (owner, points) VALUES ($1, $2::jsonb)
    ON CONFLICT (owner) DO UPDATE SET points = excluded.points, updated_at = clock_timestamp()
    RETURNING owner, points, updated_at`,
  deleteConnectors: `DELETE FROM connectors WHERE owner = $1 RETURNING owner`,
  listMergers: `
    SELECT id, name, kind, conveyor_id, along, feeder_ids, priority, gap, created_at, updated_at
      FROM mergers ORDER BY created_at, id`,
  createMerger: `
    INSERT INTO mergers (name, kind, conveyor_id, along, feeder_ids, priority, gap)
    VALUES ($1, $2, $3, $4, $5::uuid[], $6, $7)
    RETURNING id, name, kind, conveyor_id, along, feeder_ids, priority, gap, created_at, updated_at`,
  updateMerger: `
    UPDATE mergers
       SET name = coalesce($2, name), along = coalesce($3, along), priority = coalesce($4, priority),
           gap = coalesce($5, gap), updated_at = clock_timestamp()
     WHERE id = $1
    RETURNING id, name, kind, conveyor_id, along, feeder_ids, priority, gap, created_at, updated_at`,
  deleteMerger: `DELETE FROM mergers WHERE id = $1 RETURNING id`,
  listMachines: `
    SELECT id, name, conveyor_id, along, base_owner, base_point, attach_owner, attach_point, cycle_seconds, created_at, updated_at
      FROM machines ORDER BY created_at, id`,
  createMachine: `
    INSERT INTO machines (name, conveyor_id, along, base_owner, base_point, attach_owner, attach_point, cycle_seconds)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, name, conveyor_id, along, base_owner, base_point, attach_owner, attach_point, cycle_seconds, created_at, updated_at`,
  updateMachine: `
    UPDATE machines
       SET name = coalesce($2, name), along = coalesce($3, along),
           base_owner = coalesce($4, base_owner), base_point = coalesce($5, base_point),
           attach_owner = coalesce($6, attach_owner), attach_point = coalesce($7, attach_point),
           cycle_seconds = coalesce($8, cycle_seconds), updated_at = clock_timestamp()
     WHERE id = $1
    RETURNING id, name, conveyor_id, along, base_owner, base_point, attach_owner, attach_point, cycle_seconds, created_at, updated_at`,
  deleteMachine: `DELETE FROM machines WHERE id = $1 RETURNING id`,
  assemble: `SELECT inv_assemble($1, $2::uuid, $3::uuid, $4, $5, $6::jsonb) AS result`,
  listBins: `
    SELECT b.id, b.name, b.holds, b.accept, b.capacity, b.x, b.z, b.rotation_y, b.feed, b.created_at, b.updated_at,
           (SELECT count(*)::int FROM shapes s WHERE s.bin_id = b.id) AS count
      FROM bins b WHERE ($1::uuid IS NULL OR b.id = $1) ORDER BY b.created_at, b.id`,
  createBin: `
    INSERT INTO bins (name, holds, accept, capacity, x, z, rotation_y, feed)
    VALUES ($1, $2::text[], $3::jsonb, $4, $5, $6, $7, $8::jsonb) RETURNING id`,
  updateBin: `
    UPDATE bins
       SET name = coalesce($2, name), holds = coalesce($3::text[], holds), accept = coalesce($4::jsonb, accept),
           capacity = coalesce($5, capacity), x = coalesce($6, x), z = coalesce($7, z), rotation_y = coalesce($8, rotation_y),
           feed = coalesce($9::jsonb, feed),
           updated_at = clock_timestamp()
     WHERE id = $1 RETURNING id`,
  deleteBin: `DELETE FROM bins WHERE id = $1 RETURNING id`,
  loadBin: `SELECT inv_bin_load($1::uuid, $2::jsonb, $3) AS result`,
  unloadBin: `SELECT inv_bin_unload($1::uuid, $2) AS result`,
  catchIntoBin: `SELECT inv_bin_catch($1::uuid, $2::uuid) AS result`,
  releaseFromBin: `
    UPDATE shapes SET bin_id = NULL, x = $3, z = $4, updated_at = clock_timestamp()
     WHERE id = $2 AND bin_id = $1 RETURNING id`,
  listAssemblies: `
    SELECT id, name, base_shape_id, attached_shape_id, base_point, attached_point, consumed, created_at
      FROM assemblies WHERE ($1::uuid IS NULL OR id = $1) ORDER BY created_at DESC, id LIMIT $2`,
  count: `SELECT count(*)::int AS n FROM parts`,
  insertPart: `
    INSERT INTO parts (sku, name, category, unit, on_hand, reorder_level, location)
    VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (sku) DO NOTHING`,
  listRobots: `
    SELECT id, name, x, z, rotation_y, pick, rules, otherwise, created_at, updated_at
      FROM robots WHERE ($1::uuid IS NULL OR id = $1) ORDER BY created_at, id`,
  createRobot: `
    INSERT INTO robots (name, x, z, rotation_y, pick, rules, otherwise)
    VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb) RETURNING id`,
  updateRobot: `
    UPDATE robots
       SET name = coalesce($2, name), x = coalesce($3, x), z = coalesce($4, z), rotation_y = coalesce($5, rotation_y),
           pick = coalesce($6::jsonb, pick), rules = coalesce($7::jsonb, rules),
           otherwise = CASE WHEN $8 THEN $9::jsonb ELSE otherwise END,
           updated_at = clock_timestamp()
     WHERE id = $1 RETURNING id`,
  deleteRobot: `DELETE FROM robots WHERE id = $1 RETURNING id`,
  /** Order matters: shapes first (bins RESTRICT deleting while they hold some), belts last (their stations cascade). */
  clearScene: [
    "DELETE FROM robots", "DELETE FROM shapes", "DELETE FROM bins", "DELETE FROM mergers",
    "DELETE FROM machines", "DELETE FROM splitters", "DELETE FROM conveyors",
  ],
  reset: `TRUNCATE robots, shapes, bins, assemblies, machines, mergers, connectors, splitters, conveyors, movements, reservation_lines, reservations, parts RESTART IDENTITY`,
} as const;
