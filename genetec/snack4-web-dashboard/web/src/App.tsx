import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { OUTCOMES, relativeTime, tone } from "./filters";
import type { AccessEvent, DeniedByDoorRow, NoisyDeviceRow, Outcome } from "./types";

const REFRESH_MS = 3000;

export default function App() {
  const [outcome, setOutcome] = useState<Outcome>("all");
  const [search, setSearch] = useState("");
  const [events, setEvents] = useState<AccessEvent[]>([]);
  const [denied, setDenied] = useState<DeniedByDoorRow[]>([]);
  const [noisy, setNoisy] = useState<NoisyDeviceRow[]>([]);
  const [store, setStore] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    try {
      const [e, d, n] = await Promise.all([api.events(outcome, search), api.deniedByDoor(), api.noisiest()]);
      setEvents(e);
      setDenied(d);
      setNoisy(n);
      setNow(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [outcome, search]);

  // Reload when the filters change, and every few seconds to pick up new events.
  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    api.health().then((h) => setStore(h.store)).catch(() => setStore("API not reachable"));
  }, []);

  return (
    <main>
      <header>
        <h1>Access Dashboard</h1>
        <p className="muted">{store}</p>
      </header>

      <section className="filters" aria-label="Filters">
        <div className="segmented" role="radiogroup" aria-label="Outcome">
          {OUTCOMES.map((o) => (
            <button key={o.value} role="radio" aria-checked={outcome === o.value}
                    className={outcome === o.value ? "on" : ""} onClick={() => setOutcome(o.value)}>
              {o.label}
            </button>
          ))}
        </div>
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
               placeholder="Door, camera, location or person" aria-label="Search" />
      </section>

      {error && <p className="error" role="alert">{error}</p>}

      <div className="layout">
        <section aria-label="Events">
          <table>
            <thead>
              <tr><th>When</th><th>Device</th><th>Location</th><th>Cardholder</th><th>Outcome</th></tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td title={e.occurredAtUtc}>{relativeTime(e.occurredAtUtc, now)}</td>
                  <td>{e.deviceName}</td>
                  <td>{e.location}</td>
                  <td>{e.cardholderName ?? "—"}</td>
                  <td><span className={`badge ${tone(e)}`}>{e.outcome}</span></td>
                </tr>
              ))}
              {events.length === 0 && <tr><td colSpan={5} className="muted">No events match.</td></tr>}
            </tbody>
          </table>
        </section>

        <aside>
          <h2>Denied by door, 24 h</h2>
          <ul className="bars">
            {denied.map((d) => (
              <li key={d.deviceId}>
                <span>{d.deviceName}</span><strong>{d.denied}</strong>
              </li>
            ))}
            {denied.length === 0 && <li className="muted">None</li>}
          </ul>
          <h2>Noisiest devices, 24 h</h2>
          <ol className="bars">
            {noisy.map((n) => (
              <li key={n.deviceId}>
                <span>{n.deviceName} <small className="muted">{n.kind}</small></span><strong>{n.events}</strong>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </main>
  );
}
