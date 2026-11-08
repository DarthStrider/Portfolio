import type { Movement, Part } from "./api";

/**
 * On hand as a bar: the reserved share, the available share, and a tick at the reorder
 * level. Scaled to whichever is bigger, stock or twice the reorder level, so a part
 * near its reorder level always looks it.
 */
export function StockBar({ part, large = false }: { part: Part; large?: boolean }) {
  const scale = Math.max(part.onHand, part.reorderLevel * 2, 1);
  const pct = (n: number) => `${Math.min(100, (n / scale) * 100)}%`;
  return (
    <div className={`bar ${large ? "large" : ""} ${part.low ? "is-low" : ""}`} role="img"
      aria-label={`${part.available} available, ${part.reserved} reserved, reorder at ${part.reorderLevel}`}>
      <span className="reserved" style={{ width: pct(part.reserved) }} />
      <span className="available" style={{ width: pct(part.available) }} />
      <span className="reorder" style={{ left: pct(part.reorderLevel) }} />
    </div>
  );
}

const KIND_LABEL: Record<Movement["kind"], string> = {
  receive: "Received", consume: "Consumed", reserve: "Reserved", release: "Released", fulfil: "Shipped",
};

export function KindPill({ kind }: { kind: Movement["kind"] }) {
  return <span className={`pill kind-${kind}`}>{KIND_LABEL[kind]}</span>;
}

export function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : d.toLocaleString();
}
