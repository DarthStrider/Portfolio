/**
 * The HTTP API on Node's built-in http module: about a dozen routes don't need a framework.
 * createApp() returns a plain request handler, so tests can mount it on a random port.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { hostname } from "node:os";
import { isQty, isSku } from "./domain/design.ts";
import { NotFoundError, ValidationError } from "./domain/errors.ts";
import { parseNewPart, parsePartPatch } from "./domain/newPart.ts";
import { parseNewShape, parseShapePatch } from "./domain/shapes.ts";
import { parseConveyorPatch, parseConveyorUpdates, parseNewConveyor } from "./domain/conveyors.ts";
import { parseNewSplitter, parseSplitterPatch } from "./domain/splitters.ts";
import {
  DEFAULT_POINTS, isOwner, parseMachinePatch, parseMergerPatch, parseNewAssembly, parseNewMachine, parseNewMerger, parsePoints,
} from "./domain/assembly.ts";
import { parseBinPatch, parseLoad, parseNewBin, type BinResult, type Feed } from "./domain/bins.ts";
import type { InventoryRepo } from "./domain/types.ts";
import { checkDesign, reserveDesign } from "./service.ts";
import { FLOOR_HALF, FLOOR_SIZE } from "./domain/floor.ts";
import { parseNewRobot, parseRobotPatch, targetsOf, type Target } from "./domain/robots.ts";

type Params = Record<string, string>;
type Handler = (ctx: { params: Params; query: URLSearchParams; body: unknown }) => Promise<[number, unknown]>;

const MAX_BODY = 100_000; // bytes

export function createApp(repo: InventoryRepo, version = "1.0.0") {
  const routes: { method: string; pattern: RegExp; keys: string[]; handler: Handler }[] = [];
  const route = (method: string, path: string, handler: Handler) => {
    const keys: string[] = [];
    const pattern = new RegExp(`^${path.replace(/:(\w+)/g, (_, k: string) => (keys.push(k), "([^/]+)"))}$`);
    routes.push({ method, pattern, keys, handler });
  };

  // ---- Health and info ----
  route("GET", "/api/health/live", async () => [200, { ok: true }]);
  route("GET", "/api/health/ready", async () => {
    await repo.ping();
    return [200, { ok: true, db: repo.kind }];
  });
  route("GET", "/api/info", async () => [200, { db: repo.kind, host: hostname(), version }]);
  // Settings the arm app needs: the floor's size (FLOOR_SIZE, src/domain/floor.ts).
  route("GET", "/api/config", async () => [200, { floorSize: FLOOR_SIZE, floorHalf: FLOOR_HALF }]);

  // ---- Parts ----
  route("GET", "/api/parts", async ({ query }) => [200, await repo.listParts({
    search: query.get("search") ?? undefined,
    lowOnly: query.get("low") === "true",
  })]);
  route("POST", "/api/parts", async ({ body }) => [201, await repo.createPart(parseNewPart(body))]);
  route("GET", "/api/parts/:sku", async ({ params }) => {
    const [part] = await repo.getParts([sku(params.sku)]);
    return part ? [200, part] : [404, { error: `No part ${params.sku}` }];
  });
  route("PATCH", "/api/parts/:sku", async ({ params, body }) => [200, await repo.updatePart(sku(params.sku), parsePartPatch(body))]);
  route("POST", "/api/parts/:sku/receive", async ({ params, body }) => {
    const { qty, note } = adjustment(body);
    return [200, await repo.receive(sku(params.sku), qty, note)];
  });
  route("POST", "/api/parts/:sku/consume", async ({ params, body }) => {
    const { qty, note } = adjustment(body);
    return [200, await repo.consume(sku(params.sku), qty, note)];
  });
  route("GET", "/api/movements", async ({ query }) => {
    const s = query.get("sku");
    return [200, await repo.movements({ sku: s ? sku(s) : undefined, limit: limit(query, 50, 500) })];
  });

  // ---- Designs and reservations ----
  route("POST", "/api/check", async ({ body }) => [200, await checkDesign(repo, field(body, "design"))]);
  route("POST", "/api/reservations", async ({ body }) => {
    const quoteRef = field(body, "quoteRef");
    if (typeof quoteRef !== "string" || !/^[\w.-]{1,64}$/.test(quoteRef)) {
      throw new ValidationError(["quoteRef must be 1-64 letters, digits, dots, dashes or underscores"]);
    }
    const out = await reserveDesign(repo, quoteRef, field(body, "design"));
    return out.ok ? [201, out] : [409, { error: "Not enough stock", ...out }];
  });
  route("GET", "/api/reservations", async ({ query }) => [200, await repo.reservations(limit(query, 50, 200))]);
  route("POST", "/api/reservations/:id/release", async ({ params }) => [200, await repo.release(params.id)]);
  route("POST", "/api/reservations/:id/fulfil", async ({ params }) => [200, await repo.fulfil(params.id)]);

  // ---- Shapes in the robot arm's scene (Snack 1) ----
  route("GET", "/api/shapes", async () => [200, await repo.listShapes()]);
  route("POST", "/api/shapes", async ({ body }) => {
    const shape = parseNewShape(body);
    // A shape that stands for a part must name one that exists.
    if (shape.sku && (await repo.getParts([shape.sku])).length === 0) throw new ValidationError([`No part ${shape.sku} in the inventory`]);
    return [201, await repo.createShape(shape)];
  });
  route("PATCH", "/api/shapes/:id", async ({ params, body }) => [200, await repo.updateShape(params.id, parseShapePatch(body))]);
  route("DELETE", "/api/shapes/:id", async ({ params }) => {
    await repo.deleteShape(params.id);
    return [200, { deleted: params.id }];
  });

  // ---- Conveyor belts in the robot arm's scene ----
  route("GET", "/api/conveyors", async () => [200, await repo.listConveyors()]);
  route("POST", "/api/conveyors", async ({ body }) => [201, await repo.createConveyor(parseNewConveyor(body))]);
  // Several belts at once, all or none: how a line of sections moves, turns or changes speed as one.
  route("PATCH", "/api/conveyors", async ({ body }) => [200, await repo.updateConveyors(parseConveyorUpdates(body))]);
  route("PATCH", "/api/conveyors/:id", async ({ params, body }) => [200, await repo.updateConveyor(params.id, parseConveyorPatch(body))]);
  route("DELETE", "/api/conveyors/:id", async ({ params }) => {
    await repo.deleteConveyor(params.id);
    return [200, { deleted: params.id }];
  });

  // ---- Splitters: diverter gates on belts, with their sorting rules ----
  /** The gate has to be on its belt: between the belt's start (0) and its length. */
  async function checkFits(conveyorId: string, along: number) {
    const belt = (await repo.listConveyors()).find((c) => c.id === conveyorId);
    if (!belt) throw new ValidationError([`No conveyor ${conveyorId}`]);
    if (belt.kind !== "straight") throw new ValidationError([`${belt.name} is a ${belt.kind}: stations go on straight sections`]);
    if (along > belt.length) throw new ValidationError([`along must be at most ${belt.length} m, the length of ${belt.name}`]);
  }
  route("GET", "/api/splitters", async () => [200, await repo.listSplitters()]);
  route("POST", "/api/splitters", async ({ body }) => {
    const s = parseNewSplitter(body);
    await checkFits(s.conveyorId, s.along);
    return [201, await repo.createSplitter(s)];
  });
  route("PATCH", "/api/splitters/:id", async ({ params, body }) => {
    const patch = parseSplitterPatch(body);
    if (patch.along !== undefined) {
      const current = (await repo.listSplitters()).find((s) => s.id === params.id);
      if (!current) throw new NotFoundError(`No splitter ${params.id}`);
      await checkFits(current.conveyorId, patch.along);
    }
    return [200, await repo.updateSplitter(params.id, patch)];
  });
  route("DELETE", "/api/splitters/:id", async ({ params }) => {
    await repo.deleteSplitter(params.id);
    return [200, { deleted: params.id }];
  });

  // ---- Connection points, per kind of object ----
  function owner(s: string) {
    if (!isOwner(s)) throw new ValidationError([`"${s}" isn't a kind of object: use part:<SKU> or kind:<box|cylinder|sphere|cone>`]);
    return s;
  }
  route("GET", "/api/connectors", async () => [200, { defaultPoints: DEFAULT_POINTS, connectors: await repo.listConnectors() }]);
  route("PUT", "/api/connectors/:owner", async ({ params, body }) => {
    const o = owner(params.owner);
    if (o.startsWith("part:") && (await repo.getParts([o.slice(5)])).length === 0) throw new ValidationError([`No part ${o.slice(5)} in the inventory`]);
    return [200, await repo.setConnectors(o, parsePoints(body))];
  });
  route("DELETE", "/api/connectors/:owner", async ({ params }) => {
    await repo.deleteConnectors(owner(params.owner));
    return [200, { deleted: params.owner, points: DEFAULT_POINTS }];
  });

  // ---- Mergers and joining machines ----
  async function belt(id: string) {
    const b = (await repo.listConveyors()).find((c) => c.id === id);
    if (!b) throw new ValidationError([`No conveyor ${id}`]);
    if (b.kind !== "straight") throw new ValidationError([`${b.name} is a ${b.kind}: a merger's feeders must be straight sections`]);
    return b;
  }
  route("GET", "/api/mergers", async () => [200, await repo.listMergers()]);
  route("POST", "/api/mergers", async ({ body }) => {
    const m = parseNewMerger(body);
    await checkFits(m.conveyorId, m.along);
    for (const f of m.feederIds) await belt(f);
    return [201, await repo.createMerger(m)];
  });
  route("PATCH", "/api/mergers/:id", async ({ params, body }) => {
    const patch = parseMergerPatch(body);
    if (patch.along !== undefined) {
      const m = (await repo.listMergers()).find((x) => x.id === params.id);
      if (!m) throw new NotFoundError(`No merger ${params.id}`);
      if (m.kind === "y" && patch.along !== 0) throw new ValidationError(["a y merger is always at the start of its output belt (along 0)"]);
      await checkFits(m.conveyorId, patch.along);
    }
    return [200, await repo.updateMerger(params.id, patch)];
  });
  route("DELETE", "/api/mergers/:id", async ({ params }) => {
    await repo.deleteMerger(params.id);
    return [200, { deleted: params.id }];
  });

  route("GET", "/api/machines", async () => [200, await repo.listMachines()]);
  route("POST", "/api/machines", async ({ body }) => {
    const m = parseNewMachine(body);
    await checkFits(m.conveyorId, m.along);
    return [201, await repo.createMachine(m)];
  });
  route("PATCH", "/api/machines/:id", async ({ params, body }) => {
    const patch = parseMachinePatch(body);
    if (patch.along !== undefined) {
      const m = (await repo.listMachines()).find((x) => x.id === params.id);
      if (!m) throw new NotFoundError(`No machine ${params.id}`);
      await checkFits(m.conveyorId, patch.along);
    }
    return [200, await repo.updateMachine(params.id, patch)];
  });
  route("DELETE", "/api/machines/:id", async ({ params }) => {
    await repo.deleteMachine(params.id);
    return [200, { deleted: params.id }];
  });

  // ---- Bins: hold the kinds of object you choose; catch items off the line, feed them back on ----
  async function checkFeed(feed: Feed) {
    if (feed.type === "belt") await checkFits(feed.conveyorId, feed.along);
    if (feed.type === "machine" && !(await repo.listMachines()).some((m) => m.id === feed.machineId)) {
      throw new ValidationError([`No machine ${feed.machineId}`]);
    }
  }
  /** A refused bin operation: 404 for something missing, 409 for the rest, with a reason a person can act on. */
  function binAnswer<T>(r: BinResult<T>, ok: number, value: (v: T) => unknown): [number, unknown] {
    if (r.ok) return [ok, value(r.value)];
    const message = {
      not_found: "No such bin, or that shape can't go in one (it's joined onto something, or already in a bin)",
      short: "Not enough stock",
      full: "The bin is full",
      wrong_kind: "That bin doesn't hold that kind of object",
      not_in_bin: "That shape isn't in this bin",
      not_empty: "Empty the bin first",
    }[r.reason];
    return [r.reason === "not_found" || r.reason === "not_in_bin" ? 404 : 409, { error: r.detail ? `${message}: ${r.detail}` : message, reason: r.reason }];
  }
  /** Every part a bin holds must exist. */
  async function checkKinds(holds: readonly string[]) {
    const skus = holds.filter((h) => h.startsWith("part:")).map((h) => h.slice(5));
    const found = new Set((await repo.getParts(skus)).map((p) => p.sku));
    const missing = skus.filter((s) => !found.has(s));
    if (missing.length) throw new ValidationError(missing.map((s) => `No part ${s} in the inventory`));
  }
  // ---- Robots: automated arms with a pick zone and rules ----
  /** Belt targets must be on a straight belt, within its length; bins must exist. */
  async function checkTargets(targets: readonly Target[]) {
    const problems: string[] = [];
    const belts = targets.some((t) => t.type === "belt") ? await repo.listConveyors() : [];
    const bins = targets.some((t) => t.type === "bin") ? await repo.listBins() : [];
    for (const t of targets) {
      if (t.type === "belt") {
        const b = belts.find((c) => c.id === t.conveyorId);
        if (!b) problems.push(`No conveyor ${t.conveyorId}`);
        else if (b.kind !== "straight") problems.push(`${b.name} is a ${b.kind}: robots put items on straight sections`);
        else if (t.along > b.length) problems.push(`along must be at most ${b.length} m, the length of ${b.name}`);
      } else if (t.type === "bin" && !bins.some((b) => b.id === t.binId)) problems.push(`No bin ${t.binId}`);
    }
    if (problems.length) throw new ValidationError([...new Set(problems)]);
  }
  route("GET", "/api/robots", async () => [200, await repo.listRobots()]);
  route("POST", "/api/robots", async ({ body }) => {
    const r = parseNewRobot(body);
    await checkTargets(targetsOf(r));
    return [201, await repo.createRobot(r)];
  });
  route("PATCH", "/api/robots/:id", async ({ params, body }) => {
    const patch = parseRobotPatch(body);
    await checkTargets(targetsOf({ rules: patch.rules ?? [], otherwise: patch.otherwise ?? null }));
    return [200, await repo.updateRobot(params.id, patch)];
  });
  route("DELETE", "/api/robots/:id", async ({ params }) => {
    await repo.deleteRobot(params.id);
    return [200, { deleted: params.id }];
  });

  // ---- The whole scene ----
  // Everything the arm app shows except the arm itself: shapes, belts and their stations, bins,
  // robots. Stock is untouched.
  route("DELETE", "/api/scene", async () => [200, { cleared: await repo.clearScene() }]);

  route("GET", "/api/bins", async () => [200, await repo.listBins()]);
  route("POST", "/api/bins", async ({ body }) => {
    const b = parseNewBin(body);
    await checkKinds(b.holds);
    await checkFeed(b.feed);
    return [201, await repo.createBin(b)];
  });
  route("PATCH", "/api/bins/:id", async ({ params, body }) => {
    const patch = parseBinPatch(body);
    if (patch.holds) await checkKinds(patch.holds);
    if (patch.feed) await checkFeed(patch.feed);
    return [200, await repo.updateBin(params.id, patch)];
  });
  route("DELETE", "/api/bins/:id", async ({ params }) => {
    await repo.deleteBin(params.id);
    return [200, { deleted: params.id }];
  });
  route("POST", "/api/bins/:id/load", async ({ params, body }) => {
    const { lines, addToHolds } = parseLoad(body);
    await checkKinds(lines.map((l) => l.owner));
    return binAnswer(await repo.loadBin(params.id, lines, addToHolds), 200, (v) => v);
  });
  route("POST", "/api/bins/:id/unload", async ({ params, body }) => {
    const qty = field(body, "qty");
    if (!Number.isInteger(qty) || (qty as number) < 1 || (qty as number) > 200) throw new ValidationError(["qty must be a whole number from 1 to 200"]);
    return binAnswer(await repo.unloadBin(params.id, qty as number), 200, (v) => v);
  });
  route("POST", "/api/bins/:id/catch", async ({ params, body }) => {
    const shapeId = field(body, "shapeId");
    if (typeof shapeId !== "string") throw new ValidationError(["shapeId must be a shape's id"]);
    return binAnswer(await repo.catchIntoBin(params.id, shapeId), 200, () => ({ caught: shapeId }));
  });
  route("POST", "/api/bins/:id/release", async ({ params, body }) => {
    const shapeId = field(body, "shapeId");
    const at = field(body, "position") as { x?: unknown; z?: unknown } | undefined;
    const ok = (v: unknown) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= FLOOR_HALF;
    if (typeof shapeId !== "string" || !at || !ok(at.x) || !ok(at.z)) throw new ValidationError([`send { shapeId, position: { x, z } } with x and z from -${FLOOR_HALF} to ${FLOOR_HALF}`]);
    return binAnswer(await repo.releaseFromBin(params.id, shapeId, { x: at.x as number, z: at.z as number }), 200, () => ({ released: shapeId }));
  });

  // ---- Assemblies: join two shapes, using up their parts ----
  route("GET", "/api/assemblies", async ({ query }) => [200, await repo.listAssemblies(limit(query, 50, 200))]);
  route("POST", "/api/assemblies", async ({ body }) => {
    const result = await repo.assemble(parseNewAssembly(body));
    if (result.ok) return [201, result.assembly];
    const message = {
      not_found: "One of the shapes doesn't exist",
      already_attached: "That shape is already joined to something",
      cycle: "That join would make a loop: the shape is already part of this assembly",
      short: "Not enough stock to make this assembly",
    }[result.reason];
    return [result.reason === "not_found" ? 404 : 409, { error: message, reason: result.reason, ...(result.shortages ? { shortages: result.shortages } : {}) }];
  });

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const started = performance.now();
    const url = new URL(req.url ?? "/", "http://localhost");

    // The robot arm app runs on its own dev server (another origin), so the browser asks
    // first (a CORS "preflight") and only sends the request if these headers allow it.
    const cors = corsHeaders(req.headers.origin);
    if (req.method === "OPTIONS") {
      res.writeHead(cors ? 204 : 403, cors ?? {});
      res.end();
      return;
    }

    let status = 500;
    let payload: unknown;
    try {
      const matching = routes.filter((r) => r.pattern.test(url.pathname));
      const r = matching.find((m) => m.method === req.method);
      if (!r) {
        [status, payload] = matching.length ? [405, { error: "Method not allowed" }] : [404, { error: "Not found" }];
      } else {
        const m = r.pattern.exec(url.pathname)!;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decode(m[i + 1])]));
        const body = req.method === "POST" || req.method === "PATCH" || req.method === "PUT" ? await readJson(req) : undefined;
        [status, payload] = await r.handler({ params, query: url.searchParams, body });
      }
    } catch (err) {
      const e = err as Error & { status?: number; problems?: string[] };
      status = e.status ?? 500;
      payload = status === 500 ? { error: "Internal error" } : { error: e.message, ...(e.problems ? { problems: e.problems } : {}) };
      if (status === 500) console.error(err);
    }
    const text = JSON.stringify(payload);
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cors });
    res.end(text);
    if (process.env.LOG_REQUESTS !== "0" && !url.pathname.startsWith("/api/health")) {
      console.log(`${req.method} ${url.pathname} ${status} ${(performance.now() - started).toFixed(1)}ms`);
    }
  };
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new ValidationError([`body is larger than ${MAX_BODY} bytes`]);
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ValidationError(["body is not valid JSON"]);
  }
}

function field(body: unknown, key: string): unknown {
  return body && typeof body === "object" ? (body as Record<string, unknown>)[key] : undefined;
}

function sku(s: string): string {
  if (!isSku(s)) throw new ValidationError([`"${s}" is not a valid SKU`]);
  return s;
}

function adjustment(body: unknown): { qty: number; note: string } {
  const qty = field(body, "qty");
  const note = field(body, "note") ?? "";
  const problems: string[] = [];
  if (!isQty(qty)) problems.push("qty must be a whole number from 1 to 100000");
  if (typeof note !== "string" || note.length > 200) problems.push("note must be text up to 200 characters");
  if (problems.length) throw new ValidationError(problems);
  return { qty: qty as number, note: note as string };
}

function limit(query: URLSearchParams, fallback: number, max: number): number {
  const n = Number(query.get("limit") ?? fallback);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
}

/** A malformed escape like "%E0" in a path is the client's mistake, not a server error. */
function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    throw new ValidationError([`"${s}" is not a valid URL segment`]);
  }
}

/**
 * Which other web pages may call this API from a browser. By default, any page served from
 * this machine (http://localhost:<any port>), which covers the robot arm's Vite dev server.
 * CORS_ORIGINS="https://a.example,https://b.example" replaces that list.
 */
function corsHeaders(origin: string | undefined): Record<string, string> | null {
  if (!origin) return null;
  const allowed = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(",").map((o) => o.trim()).includes(origin)
    : /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!allowed) return null;
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600",
    vary: "origin",
  };
}
