import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Link } from "react-router-dom";
import type { OrderStatus, Product } from "../api/types";
import { ApiError } from "../api/client";
import { money, statusLabel } from "../lib/format";

/** A labelled input with its error message underneath, wired up for screen readers. */
export function Field({
  label,
  error,
  hint,
  ...input
}: { label: string; error?: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} aria-invalid={!!error} aria-describedby={error || hint ? `${id}-msg` : undefined} {...input} />
      {(error || hint) && (
        <p id={`${id}-msg`} className={error ? "field-error" : "field-hint"}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function SelectField({
  label,
  error,
  children,
  ...select
}: { label: string; error?: string; children: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} aria-invalid={!!error} {...select}>
        {children}
      </select>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

export function TextField({
  label,
  error,
  ...ta
}: { label: string; error?: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea id={id} aria-invalid={!!error} {...ta} />
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

/** Shows an API error's message; field errors are shown next to their inputs instead. */
export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const msg =
    error instanceof ApiError
      ? Object.keys(error.fields).length
        ? "Check the highlighted fields."
        : error.message
      : "Couldn't reach the store. Check your connection and try again.";
  return (
    <p className="note note-error" role="alert">
      {msg}
    </p>
  );
}

export const fieldErrors = (e: unknown): Record<string, string> => (e instanceof ApiError ? e.fields : {});

export function Price({ cents, compareAt }: { cents: number; compareAt?: number | null }) {
  return (
    <span className="price">
      {money(cents)}
      {compareAt ? <s className="price-was">{money(compareAt)}</s> : null}
    </span>
  );
}

export function Stars({ value, count }: { value: number; count?: number }) {
  const label = `${value.toFixed(1)} out of 5${count !== undefined ? `, ${count} reviews` : ""}`;
  return (
    <span className="stars" aria-label={label} title={label}>
      <span className="stars-track" aria-hidden>
        ★★★★★
        <span className="stars-fill" style={{ width: `${(value / 5) * 100}%` }}>
          ★★★★★
        </span>
      </span>
      {count !== undefined && <span className="stars-count">({count})</span>}
    </span>
  );
}

export function ProductTile({ p }: { p: Product }) {
  const range = p.priceMin === p.priceMax ? money(p.priceMin) : `${money(p.priceMin)} – ${money(p.priceMax)}`;
  const sale = p.variants.some((v) => v.compareAtCents);
  return (
    <Link to={`/products/${p.slug}`} className="tile">
      <div className="tile-img">
        <img src={p.images[0]?.url} alt={p.images[0]?.alt ?? p.name} loading="lazy" />
        {!p.inStock && <span className="tag tag-out">Sold out</span>}
        {p.inStock && sale && <span className="tag tag-sale">On sale</span>}
      </div>
      <h3 className="tile-name">{p.name}</h3>
      <p className="tile-meta">
        <span className="price">{range}</span>
        {p.rating.count > 0 && <Stars value={p.rating.average} count={p.rating.count} />}
      </p>
    </Link>
  );
}

const FLOW: OrderStatus[] = ["pending_payment", "paid", "processing", "shipped", "delivered"];

/** The order's progress. These steps really are a sequence, so they're numbered. */
export function StatusTimeline({ status, history }: { status: OrderStatus; history: { status: string; at: string }[] }) {
  if (status === "cancelled" || status === "refunded") {
    return <p className={`note ${status === "cancelled" ? "note-error" : ""}`}>This order was {statusLabel[status].toLowerCase()}.</p>;
  }
  const at = FLOW.indexOf(status);
  return (
    <ol className="timeline">
      {FLOW.map((s, i) => {
        const when = history.find((h) => h.status === s)?.at;
        return (
          <li key={s} className={i < at ? "done" : i === at ? "current" : ""} aria-current={i === at ? "step" : undefined}>
            <span className="timeline-dot">{i + 1}</span>
            <span className="timeline-label">{statusLabel[s]}</span>
            {when && <span className="timeline-when">{new Date(when).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}</span>}
          </li>
        );
      })}
    </ol>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{statusLabel[status] ?? status}</span>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export function Loading() {
  return (
    <p className="loading" role="status">
      Loading…
    </p>
  );
}
