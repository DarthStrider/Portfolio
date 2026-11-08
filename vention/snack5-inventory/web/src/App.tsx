import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Info, type Part, type Reservation } from "./api";
import { StockView } from "./StockView";
import { DesignView } from "./DesignView";
import { ReservationsView } from "./ReservationsView";
import { MovementsView } from "./MovementsView";

type Tab = "stock" | "design" | "reservations" | "movements";
const TABS: { id: Tab; label: string }[] = [
  { id: "stock", label: "Stock" },
  { id: "design", label: "Check a design" },
  { id: "reservations", label: "Reservations" },
  { id: "movements", label: "Ledger" },
];

const DB_LABEL: Record<Info["db"], string> = { postgres: "PostgreSQL", mongo: "MongoDB", memory: "In-memory" };

export function App() {
  const [tab, setTab] = useState<Tab>("stock");
  const [info, setInfo] = useState<Info | null>(null);
  const [parts, setParts] = useState<Part[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [version, setVersion] = useState(0); // bumps after every change, so views refetch
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [p, r, i] = await Promise.all([api.parts(), api.reservations(), api.info()]);
      setParts(p);
      setReservations(r);
      setInfo(i);
      setError(null);
    } catch (e) {
      setError(`Can't reach the API: ${(e as Error).message}`);
    }
  }, []);

  const changed = useCallback(() => {
    setVersion((v) => v + 1);
    void refresh();
  }, [refresh]);

  // Load now, then every 10 s and whenever the tab gets focus, so changes made elsewhere show up.
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 10_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const kpis = useMemo(() => {
    const active = reservations.filter((r) => r.status === "active");
    return [
      { label: "SKUs", value: parts.length },
      { label: "Low stock", value: parts.filter((p) => p.low).length, tone: parts.some((p) => p.low) ? "warn" : undefined },
      { label: "Units reserved", value: parts.reduce((n, p) => n + p.reserved, 0) },
      { label: "Active reservations", value: active.length },
    ];
  }, [parts, reservations]);

  return (
    <div className="app">
      <header className="top">
        <div>
          <p className="eyebrow">Vention · Snack 5</p>
          <h1>Parts inventory</h1>
        </div>
        {info && (
          <div className="dbinfo" title={`API pod ${info.host}`}>
            <span className={`db db-${info.db}`}>{DB_LABEL[info.db]}</span>
            <span className="host">served by {info.host}</span>
          </div>
        )}
      </header>

      {error && <div className="banner error">{error}</div>}

      <section className="kpis">
        {kpis.map((k) => (
          <div key={k.label} className={`kpi ${k.tone ?? ""}`}>
            <span className="kpi-value">{k.value}</span>
            <span className="kpi-label">{k.label}</span>
          </div>
        ))}
      </section>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === "stock" && kpis[1].value > 0 && <span className="count warn">{kpis[1].value}</span>}
            {t.id === "reservations" && kpis[3].value > 0 && <span className="count">{kpis[3].value}</span>}
          </button>
        ))}
      </nav>

      <main>
        {tab === "stock" && <StockView parts={parts} version={version} onChanged={changed} />}
        {tab === "design" && <DesignView version={version} onChanged={changed} onShowReservations={() => setTab("reservations")} />}
        {tab === "reservations" && <ReservationsView reservations={reservations} parts={parts} onChanged={changed} />}
        {tab === "movements" && <MovementsView version={version} />}
      </main>
    </div>
  );
}
