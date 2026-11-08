import { useEffect, useState } from "react";
import { api, ApiError, type CheckResult, type Shortage } from "./api";
import { SAMPLES } from "./samples";

const pretty = (v: unknown) => JSON.stringify(v, null, 2);

export function DesignView({ version, onChanged, onShowReservations }: { version: number; onChanged: () => void; onShowReservations: () => void }) {
  const [text, setText] = useState(pretty(SAMPLES[0].design));
  const [quoteRef, setQuoteRef] = useState(() => `Q-${Date.now()}`);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string; shortages?: Shortage[] } | null>(null);
  const [busy, setBusy] = useState(false);

  function parsed(): unknown {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("The design isn't valid JSON.");
    }
  }

  async function check() {
    setError(null);
    try {
      setResult(await api.check(parsed()));
    } catch (e) {
      setResult(null);
      setError((e as Error).message);
    }
  }

  // Re-check whenever stock changes (including from other tabs or users).
  useEffect(() => {
    if (result) void check();
  }, [version]);

  async function reserve() {
    setBusy(true);
    setOutcome(null);
    try {
      const r = await api.reserve(quoteRef, parsed());
      setOutcome({ ok: true, text: `Reserved ${r.reservation.lines.length} lines for ${r.reservation.quoteRef}.` });
      setQuoteRef(`Q-${Date.now()}`);
      onChanged();
    } catch (e) {
      const shortages = e instanceof ApiError ? (e.body.shortages as Shortage[] | undefined) : undefined;
      setOutcome({ ok: false, text: shortages ? "Nothing was reserved: the database found these short." : (e as Error).message, shortages });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  function load(i: number) {
    setText(pretty(SAMPLES[i].design));
    setResult(null);
    setOutcome(null);
    setError(null);
  }

  const shortLines = result?.lines.filter((l) => l.short > 0).length ?? 0;

  return (
    <div className="design">
      <section className="editor">
        <div className="samples">
          {SAMPLES.map((s, i) => (
            <button key={s.name} className="sample" onClick={() => load(i)} title={s.note}>
              <strong>{s.name}</strong><span>{s.note}</span>
            </button>
          ))}
        </div>
        <label className="json">
          Design JSON <span className="muted">(the format Snack 4's quote calculator takes)</span>
          <textarea spellCheck={false} value={text} onChange={(e) => { setText(e.target.value); setResult(null); }} rows={22} />
        </label>
        <button onClick={check}>Check stock</button>
        {error && <p className="banner error">{error}</p>}
      </section>

      <section className="results">
        {!result && !error && <p className="placeholder">Pick a sample or paste a design, then check it against live stock.</p>}
        {result && (
          <>
            <div className={`verdict ${result.ok ? "ok" : "short"}`}>
              {result.ok ? "Everything is in stock." : `${shortLines} line${shortLines === 1 ? "" : "s"} short.`}
            </div>
            <table className="grid compact">
              <thead>
                <tr><th>Stock SKU</th><th>Needed for</th><th className="num">Need</th><th className="num">Available</th><th className="num">Short</th></tr>
              </thead>
              <tbody>
                {result.lines.map((l) => (
                  <tr key={l.sku} className={l.short ? "is-short" : ""}>
                    <td className="mono">{l.sku}<span className="unit">{l.name ?? "not stocked"}</span></td>
                    <td className="detail">{l.detail}</td>
                    <td className="num strong">{l.qty}</td>
                    <td className="num">{l.available}</td>
                    <td className="num">{l.short || "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result.warnings.map((w) => <p key={w} className="banner warn">{w}</p>)}

            <div className="reserve">
              <label>Quote reference<input value={quoteRef} onChange={(e) => setQuoteRef(e.target.value)} maxLength={64} /></label>
              <button onClick={reserve} disabled={busy}>Reserve for this quote</button>
            </div>
            <p className="muted small">
              The database checks again when reserving, all or nothing, so two people can't promise the same last unit.
              {!result.ok && " Try it: the request will be refused and nothing will be held."}
            </p>
          </>
        )}
        {outcome && (
          <div className={`banner ${outcome.ok ? "ok" : "error"}`}>
            {outcome.text}
            {outcome.shortages && (
              <ul>{outcome.shortages.map((s) => <li key={s.sku}><span className="mono">{s.sku}</span>: need {s.need}, {s.known ? `${s.available} available` : "not stocked"}</li>)}</ul>
            )}
            {outcome.ok && <button className="link" onClick={onShowReservations}>View reservations →</button>}
          </div>
        )}
      </section>
    </div>
  );
}
