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
import { parseConveyorPatch, parseNewConveyor } from "./domain/conveyors.ts";
import { parseNewSplitter, parseSplitterPatch } from "./domain/splitters.ts";
import type { InventoryRepo } from "./domain/types.ts";
import { checkDesign, reserveDesign } from "./service.ts";

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
        const body = req.method === "POST" || req.method === "PATCH" ? await readJson(req) : undefined;
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
    "access-control-allow-methods": "GET, POST, PATCH, DELETE",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600",
    vary: "origin",
  };
}
