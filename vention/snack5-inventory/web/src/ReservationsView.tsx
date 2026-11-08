import { useState } from "react";
import { api, type Part, type Reservation } from "./api";
import { when } from "./ui";

export function ReservationsView({ reservations, parts, onChanged }: { reservations: Reservation[]; parts: Part[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const names = new Map(parts.map((p) => [p.sku, p.name]));

  async function act(r: Reservation, action: "release" | "fulfil") {
    setBusy(r.id);
    setError(null);
    try {
      await (action === "release" ? api.release(r.id) : api.fulfil(r.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      onChanged();
    }
  }

  if (reservations.length === 0) {
    return <p className="placeholder">No reservations yet. Check a design and reserve it to hold its stock for a quote.</p>;
  }

  return (
    <div>
      {error && <p className="banner error">{error}</p>}
      <table className="grid">
        <thead>
          <tr><th>Quote</th><th>Created</th><th>Lines</th><th>Status</th><th /></tr>
        </thead>
        <tbody>
          {reservations.map((r) => (
            <tr key={r.id} className="static">
              <td className="mono">{r.quoteRef}</td>
              <td className="muted">{when(r.createdAt)}</td>
              <td>
                <ul className="lines">
                  {r.lines.map((l) => (
                    <li key={l.sku} title={names.get(l.sku)}><span className="num strong">{l.qty}</span> <span className="mono">{l.sku}</span></li>
                  ))}
                </ul>
              </td>
              <td><span className={`pill status-${r.status}`}>{r.status}</span></td>
              <td className="actions">
                {r.status === "active" && (
                  <>
                    <button className="secondary" disabled={busy === r.id} onClick={() => act(r, "release")}>Release</button>
                    <button disabled={busy === r.id} onClick={() => act(r, "fulfil")}>Ship</button>
                  </>
                )}
                {r.closedAt && <span className="muted small">{when(r.closedAt)}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">Release gives the parts back to available stock. Ship takes them off the shelf for good.</p>
    </div>
  );
}
