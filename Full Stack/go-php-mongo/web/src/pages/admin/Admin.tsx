import { useState } from "react";
import { Link, Navigate, NavLink, Outlet, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post, put, qs } from "../../api/client";
import type { Coupon, List, Order, Payment, Stats, StockRow, User } from "../../api/types";
import { useAuth } from "../../auth/AuthProvider";
import { Logo } from "../../components/Layout";
import { Empty, ErrorNote, Field, Loading, StatusBadge, StatusTimeline, fieldErrors } from "../../components/ui";
import { date, dateTime, money, optionText, parseDollars, statusLabel } from "../../lib/format";

export function AdminLayout() {
  const { user, ready, isStaff, isAdmin } = useAuth();
  if (!ready) return <Loading />;
  if (!user) return <Navigate to="/login?next=/admin" replace />;
  if (!isStaff) return <div className="wrap section"><Empty title="Staff only"><Link to="/">Back to the shop</Link></Empty></div>;
  return (
    <div className="admin">
      <aside className="admin-nav">
        <Logo />
        <nav aria-label="Admin">
          <NavLink to="/admin" end>Dashboard</NavLink>
          <NavLink to="/admin/orders">Orders</NavLink>
          <NavLink to="/admin/products">Products</NavLink>
          <NavLink to="/admin/inventory">Inventory</NavLink>
          <NavLink to="/admin/categories">Categories</NavLink>
          <NavLink to="/admin/reviews">Reviews</NavLink>
          <NavLink to="/admin/pages">Pages</NavLink>
          <NavLink to="/admin/coupons">Discount codes</NavLink>
          {isAdmin && <NavLink to="/admin/users">People</NavLink>}
        </nav>
        <Link to="/" className="admin-back">View the shop</Link>
      </aside>
      <main className="admin-main" id="main">
        <Outlet />
      </main>
    </div>
  );
}

export function Dashboard() {
  const stats = useQuery({ queryKey: ["stats"], queryFn: () => get<Stats>("/admin/stats?days=14") });
  if (stats.isLoading) return <Loading />;
  const s = stats.data!;
  const peak = Math.max(1, ...s.byDay.map((d) => d.revenueCents));
  return (
    <>
      <h1>Last 14 days</h1>
      <div className="kpis">
        <div><span>Revenue</span><strong>{money(s.revenueCents)}</strong></div>
        <div><span>Orders</span><strong>{s.orders}</strong></div>
        <div><span>Average order</span><strong>{money(s.avgOrderCents)}</strong></div>
        <div><span>Awaiting payment</span><strong>{s.pendingOrders}</strong></div>
        <div><span>Low-stock SKUs</span><strong><Link to="/admin/inventory?low=1">{s.lowStock}</Link></strong></div>
      </div>
      <section className="panel">
        <h2>Revenue by day</h2>
        {s.byDay.length === 0 ? <p className="muted">No paid orders yet. Place one from the shop to see it here.</p> : (
          <div className="bars" role="img" aria-label="Revenue per day">
            {s.byDay.map((d) => (
              <div key={d.date} className="bar" title={`${d.date}: ${money(d.revenueCents)}, ${d.orders} orders`}>
                <span style={{ height: `${(d.revenueCents / peak) * 100}%` }} />
                <small>{d.date.slice(5)}</small>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="panel">
        <h2>Best sellers</h2>
        {s.topProducts.length === 0 ? <p className="muted">Nothing sold yet.</p> : (
          <table className="table">
            <thead><tr><th>Product</th><th>SKU</th><th className="num">Units</th><th className="num">Revenue</th></tr></thead>
            <tbody>{s.topProducts.map((t) => <tr key={t.sku}><td>{t.name}</td><td>{t.sku}</td><td className="num">{t.qty}</td><td className="num">{money(t.revenueCents)}</td></tr>)}</tbody>
          </table>
        )}
      </section>
    </>
  );
}

export function AdminOrders() {
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const page = Number(params.get("page") ?? 1);
  const [q, setQ] = useState(params.get("q") ?? "");
  const query = qs({ status, q: params.get("q"), page });
  const list = useQuery({ queryKey: ["admin-orders", query], queryFn: () => get<List<Order>>(`/admin/orders${query}`) });
  const pages = list.data ? Math.ceil((list.data.total ?? 0) / (list.data.perPage ?? 25)) : 0;
  return (
    <>
      <h1>Orders</h1>
      <div className="toolbar">
        <select aria-label="Status" value={status} onChange={(e) => setParams(e.target.value ? { status: e.target.value } : {})}>
          <option value="">All statuses</option>
          {Object.entries(statusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <form onSubmit={(e) => { e.preventDefault(); setParams(q ? { q } : {}); }}>
          <input type="search" placeholder="Order number or email" aria-label="Search orders" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
      </div>
      {list.isLoading ? <Loading /> : list.data?.items.length === 0 ? <p className="muted">No orders match.</p> : (
        <table className="table">
          <thead><tr><th>Order</th><th>Placed</th><th>Customer</th><th>Status</th><th className="num">Total</th></tr></thead>
          <tbody>
            {list.data?.items.map((o) => (
              <tr key={o.id}>
                <td><Link to={`/admin/orders/${o.id}`}>{o.number}</Link></td>
                <td>{dateTime(o.createdAt)}</td>
                <td>{o.email}{!o.userId && <span className="muted"> (guest)</span>}</td>
                <td><StatusBadge status={o.status} /></td>
                <td className="num">{money(o.totals.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pages > 1 && (
        <nav className="pager">
          <button className="btn btn-small" disabled={page <= 1} onClick={() => setParams({ ...Object.fromEntries(params), page: String(page - 1) })}>Previous</button>
          <span>Page {page} of {pages}</span>
          <button className="btn btn-small" disabled={page >= pages} onClick={() => setParams({ ...Object.fromEntries(params), page: String(page + 1) })}>Next</button>
        </nav>
      )}
    </>
  );
}

const ACTION_LABEL: Record<string, string> = {
  processing: "Start packing",
  shipped: "Mark shipped",
  delivered: "Mark delivered",
  cancelled: "Cancel order",
};

export function AdminOrder() {
  const { id = "" } = useParams();
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const order = useQuery({ queryKey: ["admin-order", id], queryFn: () => get<Order>(`/admin/orders/${id}`) });
  const payments = useQuery({ queryKey: ["payments", id], queryFn: () => get<List<Payment>>(`/admin/payments?orderId=${id}`) });
  const [tracking, setTracking] = useState("");
  const [refund, setRefund] = useState("");
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin-order", id] });
    qc.invalidateQueries({ queryKey: ["payments", id] });
    // Cancellations refund and refunds update the order by event; look again shortly.
    setTimeout(() => {
      qc.invalidateQueries({ queryKey: ["admin-order", id] });
      qc.invalidateQueries({ queryKey: ["payments", id] });
    }, 1500);
  };
  const move = useMutation({
    mutationFn: (status: string) => post<Order>(`/admin/orders/${id}/status`, { status, tracking }),
    onSuccess: refresh,
  });
  const doRefund = useMutation({
    mutationFn: () => post<Payment>("/admin/payments/refund", { orderId: id, amountCents: refund ? parseDollars(refund) ?? -1 : 0 }),
    onSuccess: () => { setRefund(""); refresh(); },
  });
  if (order.isLoading) return <Loading />;
  const o = order.data;
  if (!o) return <Empty title="Order not found" />;
  const paid = payments.data?.items.find((p) => p.status === "succeeded" || p.status === "partially_refunded");

  return (
    <>
      <p><Link to="/admin/orders">Orders</Link></p>
      <div className="order-head"><h1>{o.number}</h1><StatusBadge status={o.status} /></div>
      <p className="muted">{o.email}{o.userId ? "" : " (guest)"}, placed {dateTime(o.createdAt)}</p>
      <StatusTimeline status={o.status} history={o.history} />

      {o.next && o.next.length > 0 && (
        <section className="panel">
          <h2>Next step</h2>
          {o.next.includes("shipped") && (
            <Field label="Tracking number" value={tracking} onChange={(e) => setTracking(e.target.value)} error={fieldErrors(move.error).tracking} />
          )}
          <div className="actions">
            {o.next.map((s) => (
              <button key={s} className={`btn ${s === "cancelled" ? "btn-danger" : "btn-primary"}`} disabled={move.isPending}
                onClick={() => (s !== "cancelled" || confirm("Cancel this order? Paid orders are refunded in full.")) && move.mutate(s)}>
                {ACTION_LABEL[s] ?? s}
              </button>
            ))}
          </div>
          <ErrorNote error={move.error} />
        </section>
      )}

      <div className="order-grid">
        <section className="panel">
          <h2>Items</h2>
          <ul className="summary-lines">
            {o.lines.map((l) => <li key={l.sku}><span>{l.qty} × {l.name}<small>{l.sku} {optionText(l.options)}</small></span><span>{money(l.lineTotalCents)}</span></li>)}
          </ul>
          <dl className="totals">
            <div><dt>Subtotal</dt><dd>{money(o.totals.subtotalCents)}</dd></div>
            {o.totals.discountCents > 0 && <div><dt>Discount ({o.couponCode})</dt><dd>−{money(o.totals.discountCents)}</dd></div>}
            <div><dt>Shipping</dt><dd>{money(o.totals.shippingCents)}</dd></div>
            <div><dt>{o.totals.taxLabel}</dt><dd>{money(o.totals.taxCents)}</dd></div>
            <div className="grand"><dt>Total</dt><dd>{money(o.totals.totalCents)}</dd></div>
          </dl>
          <address>{o.shippingAddress.name}<br />{o.shippingAddress.line1} {o.shippingAddress.line2}<br />{o.shippingAddress.city}, {o.shippingAddress.province} {o.shippingAddress.postalCode}<br />{o.shippingAddress.phone}</address>
        </section>
        <section className="panel">
          <h2>Payments</h2>
          {payments.data?.items.length === 0 && <p className="muted">No payment attempts yet.</p>}
          <ul className="history">
            {payments.data?.items.map((p) => (
              <li key={p.id}>
                <StatusBadge status={p.status} /> {money(p.amountCents)} via {p.provider}, {dateTime(p.createdAt)}
                {p.refunds.map((r) => <div key={r.id} className="muted">Refunded {money(r.amountCents)} on {date(r.at)}</div>)}
              </li>
            ))}
          </ul>
          {isAdmin && paid && (
            <form className="refund" onSubmit={(e) => { e.preventDefault(); doRefund.mutate(); }}>
              <Field label="Refund amount" placeholder={`Up to ${money(paid.amountCents - paid.refundedCents)}`} hint="Leave empty to refund everything left."
                value={refund} onChange={(e) => setRefund(e.target.value)} error={fieldErrors(doRefund.error).amountCents} />
              <button className="btn btn-danger" disabled={doRefund.isPending}>Refund</button>
              <ErrorNote error={doRefund.error} />
            </form>
          )}
          <h3>History</h3>
          <ul className="history">
            {o.history.map((h, i) => <li key={i}><strong>{statusLabel[h.status]}</strong> {dateTime(h.at)}{h.note && <span className="muted"> — {h.note}</span>}</li>)}
          </ul>
        </section>
      </div>
    </>
  );
}

export function Inventory() {
  const [params, setParams] = useSearchParams();
  const low = params.get("low") === "1";
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["inventory", low], queryFn: () => get<List<StockRow>>(`/admin/inventory${low ? "?low=1" : ""}`) });
  const [delta, setDelta] = useState<Record<string, string>>({});
  const adjust = useMutation({
    mutationFn: (sku: string) => post(`/admin/inventory/${encodeURIComponent(sku)}/adjust`, { delta: Number(delta[sku]) }),
    onSuccess: (_, sku) => { setDelta({ ...delta, [sku]: "" }); qc.invalidateQueries({ queryKey: ["inventory"] }); },
  });
  return (
    <>
      <h1>Inventory</h1>
      <p className="muted">Stock lives in order-service. "Reserved" is held by checkouts waiting for payment.</p>
      <label className="check"><input type="checkbox" checked={low} onChange={(e) => setParams(e.target.checked ? { low: "1" } : {})} /> Low stock only</label>
      <ErrorNote error={adjust.error} />
      {list.isLoading ? <Loading /> : (
        <table className="table">
          <thead><tr><th>SKU</th><th>Product</th><th className="num">On hand</th><th className="num">Reserved</th><th className="num">Available</th><th>Receive (+) or write off (−)</th></tr></thead>
          <tbody>
            {list.data?.items.map((s) => (
              <tr key={s.sku} className={s.low ? "row-warn" : ""}>
                <td>{s.sku}</td>
                <td>{s.name} <span className="muted">{optionText(s.options)}</span>{!s.active && <span className="muted"> (inactive)</span>}</td>
                <td className="num">{s.onHand}</td>
                <td className="num">{s.reserved}</td>
                <td className="num"><strong>{s.available}</strong></td>
                <td>
                  <form className="inline" onSubmit={(e) => { e.preventDefault(); adjust.mutate(s.sku); }}>
                    <input aria-label={`Change stock for ${s.sku}`} inputMode="numeric" placeholder="+10" value={delta[s.sku] ?? ""} onChange={(e) => setDelta({ ...delta, [s.sku]: e.target.value })} />
                    <button className="btn btn-small" disabled={!delta[s.sku] || adjust.isPending}>Apply</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export function Coupons() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const list = useQuery({ queryKey: ["coupons"], queryFn: () => get<List<Coupon>>("/admin/coupons") });
  const [form, setForm] = useState({ code: "", kind: "percent", value: "", min: "", maxUses: "" });
  const save = useMutation({
    mutationFn: (c: Partial<Coupon>) => put<Coupon>("/admin/coupons", c),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["coupons"] }); setForm({ code: "", kind: "percent", value: "", min: "", maxUses: "" }); },
  });
  const fe = fieldErrors(save.error);
  const create = () => save.mutate({
    code: form.code,
    percentOff: form.kind === "percent" ? Number(form.value) || 0 : 0,
    amountOffCents: form.kind === "amount" ? parseDollars(form.value) ?? 0 : 0,
    minSubtotalCents: parseDollars(form.min || "0") ?? 0,
    maxUses: Number(form.maxUses) || 0,
    active: true,
  });
  const toggle = (c: Coupon) => {
    const { uses, ...rest } = c;
    save.mutate({ ...rest, active: !c.active });
  };
  return (
    <>
      <h1>Discount codes</h1>
      <table className="table">
        <thead><tr><th>Code</th><th>Discount</th><th>Minimum</th><th className="num">Used</th><th>Status</th>{isAdmin && <th />}</tr></thead>
        <tbody>
          {list.data?.items.map((c) => (
            <tr key={c.code}>
              <td><strong>{c.code}</strong></td>
              <td>{c.percentOff ? `${c.percentOff}% off` : `${money(c.amountOffCents)} off`}</td>
              <td>{c.minSubtotalCents ? money(c.minSubtotalCents) : "None"}</td>
              <td className="num">{c.uses}{c.maxUses ? ` of ${c.maxUses}` : ""}</td>
              <td>{c.active ? "Active" : "Paused"}</td>
              {isAdmin && <td><button className="link-btn" onClick={() => toggle(c)}>{c.active ? "Pause" : "Resume"}</button></td>}
            </tr>
          ))}
        </tbody>
      </table>
      {isAdmin && (
        <form className="panel form-grid" onSubmit={(e) => { e.preventDefault(); create(); }}>
          <h2>New code</h2>
          <Field label="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} error={fe.code} />
          <div className="field">
            <label htmlFor="kind">Type</label>
            <select id="kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="percent">Percentage off</option>
              <option value="amount">Fixed amount off</option>
            </select>
          </div>
          <Field label={form.kind === "percent" ? "Percent" : "Amount ($)"} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} error={fe.percentOff ?? fe.amountOffCents} />
          <Field label="Minimum order ($)" value={form.min} onChange={(e) => setForm({ ...form, min: e.target.value })} />
          <Field label="Max uses (0 = no limit)" value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} />
          <ErrorNote error={save.error} />
          <button className="btn btn-primary">Create code</button>
        </form>
      )}
    </>
  );
}

export function People() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const list = useQuery({ queryKey: ["users", search], queryFn: () => get<List<User>>(`/admin/users${qs({ q: search })}`) });
  const setRoles = useMutation({
    mutationFn: (v: { id: string; roles: string[] }) => put<User>(`/admin/users/${v.id}/roles`, { roles: v.roles }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
  return (
    <>
      <h1>People</h1>
      <form className="toolbar" onSubmit={(e) => { e.preventDefault(); setSearch(q); }}>
        <input type="search" aria-label="Search people" placeholder="Name or email" value={q} onChange={(e) => setQ(e.target.value)} />
      </form>
      <ErrorNote error={setRoles.error} />
      <table className="table">
        <thead><tr><th>Name</th><th>Email</th><th>Joined</th><th>Staff</th><th>Admin</th></tr></thead>
        <tbody>
          {list.data?.items.map((u) => {
            const has = (r: string) => u.roles.includes(r as User["roles"][number]);
            const toggle = (r: string) => setRoles.mutate({ id: u.id, roles: has(r) ? u.roles.filter((x) => x !== r) : [...u.roles, r] });
            return (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{date(u.createdAt)}</td>
                <td><input type="checkbox" aria-label={`${u.name} is staff`} checked={has("staff")} onChange={() => toggle("staff")} /></td>
                <td><input type="checkbox" aria-label={`${u.name} is admin`} checked={has("admin")} onChange={() => toggle("admin")} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">Role changes sign the person out, so their next sign-in picks up the new access.</p>
    </>
  );
}
