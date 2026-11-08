/** Typed calls to the inventory API. Types mirror api/src/domain/types.ts. */

export type Category = "extrusion" | "plate" | "fastener" | "motor" | "actuator" | "controller" | "gripper";

export interface Part {
  sku: string; name: string; category: Category; unit: string;
  onHand: number; reserved: number; available: number; reorderLevel: number; low: boolean;
  location: string; updatedAt: string;
}
export interface Movement {
  id: string; sku: string; kind: "receive" | "consume" | "reserve" | "release" | "fulfil";
  qty: number; note: string; reservationId: string | null; at: string;
}
export interface Line { sku: string; qty: number }
export interface Reservation {
  id: string; quoteRef: string; status: "active" | "released" | "fulfilled"; lines: Line[]; createdAt: string; closedAt: string | null;
}
export interface Shortage { sku: string; need: number; available: number; known: boolean }
export interface CheckLine { sku: string; qty: number; detail: string; name: string | null; unit: string | null; available: number; short: number }
export interface CheckResult { ok: boolean; lines: CheckLine[]; warnings: string[] }
export interface Info { db: "postgres" | "mongo" | "memory"; host: string; version: string }

export class ApiError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;
  constructor(status: number, message: string, body: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const problems = Array.isArray(data.problems) ? `: ${(data.problems as string[]).join("; ")}` : "";
    throw new ApiError(res.status, `${String(data.error ?? res.statusText)}${problems}`, data);
  }
  return data as T;
}

export const api = {
  info: () => call<Info>("GET", "/info"),
  parts: () => call<Part[]>("GET", "/parts"),
  movements: (sku?: string, limit = 50) => call<Movement[]>("GET", `/movements?limit=${limit}${sku ? `&sku=${encodeURIComponent(sku)}` : ""}`),
  createPart: (part: Omit<Part, "reserved" | "available" | "low" | "updatedAt">) => call<Part>("POST", "/parts", part),
  receive: (sku: string, qty: number, note: string) => call<Part>("POST", `/parts/${encodeURIComponent(sku)}/receive`, { qty, note }),
  consume: (sku: string, qty: number, note: string) => call<Part>("POST", `/parts/${encodeURIComponent(sku)}/consume`, { qty, note }),
  check: (design: unknown) => call<CheckResult>("POST", "/check", { design }),
  reserve: (quoteRef: string, design: unknown) =>
    call<{ ok: true; reservation: Reservation; warnings: string[] }>("POST", "/reservations", { quoteRef, design }),
  reservations: () => call<Reservation[]>("GET", "/reservations"),
  release: (id: string) => call<Reservation>("POST", `/reservations/${id}/release`),
  fulfil: (id: string) => call<Reservation>("POST", `/reservations/${id}/fulfil`),
};
