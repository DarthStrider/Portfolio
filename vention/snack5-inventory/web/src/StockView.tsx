import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, type Category, type Movement, type Part } from "./api";
import { KindPill, StockBar, when } from "./ui";
import { AddPartPanel } from "./AddPartPanel";

const CATEGORIES: (Category | "all")[] = ["all", "extrusion", "plate", "fastener", "motor", "actuator", "controller", "gripper"];

export function StockView({ parts, version, onChanged }: { parts: Part[]; version: number; onChanged: () => void }) {
  const [search, setSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [category, setCategory] = useState<Category | "all">("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [justAdded, setJustAdded] = useState<string | null>(null);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return parts.filter(
      (p) =>
        (!q || p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)) &&
        (!lowOnly || p.low) &&
        (category === "all" || p.category === category),
    );
  }, [parts, search, lowOnly, category]);

  const part = adding ? null : parts.find((p) => p.sku === selected) ?? null;

  return (
    <div className={`stock ${part || adding ? "with-panel" : ""}`}>
      <div>
        <div className="filters">
          <input type="search" placeholder="Search SKU or name" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search parts" />
          <select value={category} onChange={(e) => setCategory(e.target.value as Category | "all")} aria-label="Category">
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c === "all" ? "All categories" : c}</option>
            ))}
          </select>
          <label className="check">
            <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Low stock only
          </label>
          <span className="muted">{shown.length} of {parts.length}</span>
          <button className="add" onClick={() => { setAdding(true); setSelected(null); }}>+ Add part</button>
        </div>

        <table className="grid">
          <thead>
            <tr>
              <th>SKU</th><th>Part</th><th>Bin</th><th className="num">On hand</th><th className="num">Reserved</th>
              <th className="num">Available</th><th className="wide">Level</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.sku} className={[p.sku === selected && !adding ? "selected" : "", p.sku === justAdded ? "new" : ""].join(" ")}
                onClick={() => { setAdding(false); setSelected(p.sku === selected ? null : p.sku); }}>
                <td className="mono">{p.sku}</td>
                <td>{p.name}<span className="unit">{p.unit}</span></td>
                <td className="mono muted">{p.location}</td>
                <td className="num">{p.onHand}</td>
                <td className="num muted">{p.reserved || "–"}</td>
                <td className="num strong">{p.available}</td>
                <td className="wide"><StockBar part={p} /></td>
                <td><Status part={p} /></td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={8} className="empty">No parts match.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {adding && (
        <AddPartPanel
          existing={parts}
          onCancel={() => setAdding(false)}
          onCreated={(p) => {
            setAdding(false);
            setSearch("");
            setCategory("all");
            setLowOnly(false);
            setSelected(p.sku);
            setJustAdded(p.sku);
            onChanged();
          }}
        />
      )}
      {part && <PartPanel key={part.sku} part={part} version={version} onChanged={onChanged} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Status({ part }: { part: Part }) {
  if (part.available === 0) return <span className="pill out">Out</span>;
  if (part.low) return <span className="pill low">Reorder</span>;
  return <span className="pill ok">OK</span>;
}

function PartPanel({ part, version, onChanged, onClose }: { part: Part; version: number; onChanged: () => void; onClose: () => void }) {
  const [history, setHistory] = useState<Movement[]>([]);
  const [qty, setQty] = useState("1");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    api.movements(part.sku, 12).then((m) => live && setHistory(m)).catch(() => {});
    return () => {
      live = false;
    };
  }, [part.sku, part.updatedAt, version]);

  async function submit(kind: "receive" | "consume", e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const n = Number(qty);
      const p = kind === "receive" ? await api.receive(part.sku, n, note) : await api.consume(part.sku, n, note);
      setMessage({ ok: true, text: `${kind === "receive" ? "Received" : "Consumed"} ${n}. On hand is now ${p.onHand}.` });
      setNote("");
      onChanged();
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const short = Math.max(0, part.reorderLevel + 1 - part.available);

  return (
    <aside className="panel" aria-label={`${part.sku} details`}>
      <div className="panel-head">
        <div>
          <p className="mono eyebrow">{part.sku}</p>
          <h2>{part.name}</h2>
          <p className="muted">{part.category} · {part.unit} · bin {part.location}</p>
        </div>
        <button className="ghost" onClick={onClose} aria-label="Close">✕</button>
      </div>

      <div className="figures">
        <div><span>{part.onHand}</span>on hand</div>
        <div><span>{part.reserved}</span>reserved</div>
        <div className="strong"><span>{part.available}</span>available</div>
        <div><span>{part.reorderLevel}</span>reorder at</div>
      </div>
      <StockBar part={part} large />
      {part.low && <p className="banner warn">At or below its reorder level. Receiving {short} would clear it.</p>}

      <form className="adjust" onSubmit={(e) => submit("receive", e)}>
        <label>Quantity<input type="number" min={1} max={100000} step={1} value={qty} onChange={(e) => setQty(e.target.value)} required /></label>
        <label>Note<input type="text" maxLength={200} placeholder="PO number, work order…" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <div className="buttons">
          <button type="submit" disabled={busy}>Receive</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => submit("consume")}>Consume</button>
        </div>
        {message && <p className={`banner ${message.ok ? "ok" : "error"}`}>{message.text}</p>}
      </form>

      <h3>Recent movements</h3>
      <ul className="history">
        {history.map((m) => (
          <li key={m.id}>
            <KindPill kind={m.kind} />
            <span className="num strong">{m.kind === "receive" || m.kind === "release" ? "+" : "−"}{m.qty}</span>
            <span className="note">{m.note || "–"}</span>
            <time className="muted">{when(m.at)}</time>
          </li>
        ))}
        {history.length === 0 && <li className="muted">Nothing yet.</li>}
      </ul>
      <p className="muted small">Reserve and release change what's available; receive, consume and fulfil change what's on hand.</p>
    </aside>
  );
}
