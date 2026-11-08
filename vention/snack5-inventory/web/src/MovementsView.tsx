import { useEffect, useState } from "react";
import { api, type Movement } from "./api";
import { KindPill, when } from "./ui";

export function MovementsView({ version }: { version: number }) {
  const [moves, setMoves] = useState<Movement[] | null>(null);

  useEffect(() => {
    let live = true;
    api.movements(undefined, 200).then((m) => live && setMoves(m)).catch(() => live && setMoves([]));
    return () => {
      live = false;
    };
  }, [version]);

  if (!moves) return <p className="placeholder">Loading…</p>;
  if (moves.length === 0) return <p className="placeholder">The ledger is empty. Every receive, consume and reservation adds a line here.</p>;

  return (
    <table className="grid">
      <thead>
        <tr><th className="num">#</th><th>When</th><th>Change</th><th>SKU</th><th className="num">Qty</th><th>Note</th></tr>
      </thead>
      <tbody>
        {moves.map((m) => (
          <tr key={m.id} className="static">
            <td className="num muted">{m.id}</td>
            <td className="muted">{when(m.at)}</td>
            <td><KindPill kind={m.kind} /></td>
            <td className="mono">{m.sku}</td>
            <td className="num strong">{m.qty}</td>
            <td>{m.note || <span className="muted">–</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
