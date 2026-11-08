import { lazy, Suspense, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post, qs } from "../../api/client";
import type { Address, Intent, Order } from "../../api/types";
import { useAuth } from "../../auth/AuthProvider";
import { guestKeys, useCart, useCartActions } from "../../lib/cart";
import { dateTime, money, optionText, PROVINCES } from "../../lib/format";
import { Empty, ErrorNote, Field, Loading, SelectField, StatusBadge, StatusTimeline, fieldErrors } from "../../components/ui";

// Stripe's script only loads when the Stripe provider is configured.
const StripePay = lazy(() => import("./StripePay"));

export function CartPage() {
  const cart = useCart();
  const { setQty, remove } = useCartActions();
  if (cart.isLoading) return <Loading />;
  const c = cart.data;
  if (!c || c.lines.length === 0) {
    return <div className="wrap section"><Empty title="Your cart is empty"><Link to="/shop" className="btn btn-primary">Start shopping</Link></Empty></div>;
  }
  const busy = setQty.isPending || remove.isPending;
  return (
    <div className="wrap section cart">
      <h1>Your cart</h1>
      <ul className="lines">
        {c.lines.map((l) => (
          <li key={l.sku} className={l.problem ? "line line-problem" : "line"}>
            <img src={l.image} alt="" />
            <div className="line-main">
              <Link to={`/products/${l.slug}`}>{l.name}</Link>
              <span className="muted">{optionText(l.options)}</span>
              {l.problem && <span className="line-warn">{l.problem}</span>}
            </div>
            <label className="qty">
              <span className="sr-only">Quantity of {l.name}</span>
              <select value={l.qty} disabled={busy} onChange={(e) => setQty.mutate({ sku: l.sku, qty: Number(e.target.value) })}>
                {Array.from({ length: Math.max(l.qty, Math.min(10, l.available)) }, (_, i) => i + 1).map((n) => <option key={n}>{n}</option>)}
              </select>
            </label>
            <span className="line-total">{money(l.lineTotalCents)}</span>
            <button className="link-btn" disabled={busy} onClick={() => remove.mutate(l.sku)}>Remove</button>
          </li>
        ))}
      </ul>
      <ErrorNote error={setQty.error ?? remove.error} />
      <div className="cart-foot">
        <p className="subtotal">Subtotal <strong>{money(c.subtotalCents)}</strong></p>
        <p className="muted">Shipping and tax are worked out at checkout.</p>
        {c.canCheckout ? (
          <Link to="/checkout" className="btn btn-primary btn-wide">Check out</Link>
        ) : (
          <p className="note note-error">Remove or change the flagged items to check out.</p>
        )}
      </div>
    </div>
  );
}

interface Quote {
  totals: Order["totals"];
  couponError?: string;
  freeShippingOverCents: number;
}

const blank: Address = { name: "", line1: "", line2: "", city: "", province: "ON", postalCode: "", phone: "" };

export function Checkout() {
  const { user } = useAuth();
  const cart = useCart();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState<Address>(user?.addresses[0] ?? blank);
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState("");

  useEffect(() => {
    if (user?.addresses[0]) setAddress(user.addresses[0]);
  }, [user]);

  const quote = useQuery({
    queryKey: ["quote", address.province, coupon, cart.data?.subtotalCents],
    queryFn: () => get<Quote>(`/checkout/quote${qs({ province: address.province, coupon })}`),
    enabled: !!cart.data?.canCheckout,
  });

  const place = useMutation({
    mutationFn: () => {
      const { id, ...shipTo } = address; // a saved address's id isn't part of an order
      return post<{ order: Order; guestKey: string }>("/checkout", { email, address: shipTo, couponCode: coupon });
    },
    onSuccess: ({ order, guestKey }) => {
      if (guestKey) guestKeys.save(order.id, guestKey);
      qc.invalidateQueries({ queryKey: ["cart"] });
      navigate(`/checkout/pay/${order.id}${guestKey ? `?key=${guestKey}` : ""}`);
    },
  });
  const fe = fieldErrors(place.error);
  const set = (k: keyof Address) => (e: { target: { value: string } }) => setAddress({ ...address, [k]: e.target.value });

  if (cart.isLoading) return <Loading />;
  if (!cart.data?.canCheckout) {
    return <div className="wrap section"><Empty title="Nothing to check out yet"><Link to="/cart">Back to cart</Link></Empty></div>;
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    place.mutate();
  };
  const t = quote.data?.totals;

  return (
    <div className="wrap section checkout">
      <form className="checkout-form" onSubmit={submit} noValidate>
        <h1>Checkout</h1>
        {user ? (
          <p className="muted">Signed in as {user.email}. Your receipt goes there.</p>
        ) : (
          <>
            <p className="muted">Have an account? <Link to="/login?next=/checkout">Sign in</Link> to use saved addresses, or check out as a guest.</p>
            <Field label="Email for your receipt" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={fe.email} required />
          </>
        )}

        <fieldset className="address">
          <legend>Shipping address</legend>
          {user && user.addresses.length > 0 && (
            <SelectField label="Saved addresses" value={address.id ?? ""} onChange={(e) => setAddress(user.addresses.find((a) => a.id === e.target.value) ?? blank)}>
              {user.addresses.map((a) => <option key={a.id} value={a.id}>{a.name}, {a.line1}, {a.city}</option>)}
              <option value="">A new address</option>
            </SelectField>
          )}
          <Field label="Full name" autoComplete="name" value={address.name} onChange={set("name")} error={fe["address.name"]} />
          <Field label="Street address" autoComplete="address-line1" value={address.line1} onChange={set("line1")} error={fe["address.line1"]} />
          <Field label="Apartment, suite (optional)" autoComplete="address-line2" value={address.line2} onChange={set("line2")} />
          <div className="field-row">
            <Field label="City" autoComplete="address-level2" value={address.city} onChange={set("city")} error={fe["address.city"]} />
            <SelectField label="Province" autoComplete="address-level1" value={address.province} onChange={set("province")} error={fe["address.province"]}>
              {PROVINCES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </SelectField>
            <Field label="Postal code" autoComplete="postal-code" value={address.postalCode} onChange={set("postalCode")} error={fe["address.postalCode"]} />
          </div>
          <Field label="Phone (for delivery questions)" type="tel" autoComplete="tel" value={address.phone} onChange={set("phone")} />
        </fieldset>

        <ErrorNote error={place.error} />
        <button className="btn btn-primary btn-wide" disabled={place.isPending}>
          {place.isPending ? "Reserving your items…" : "Continue to payment"}
        </button>
        <p className="muted small">Your items are held for 15 minutes while you pay.</p>
      </form>

      <aside className="summary" aria-label="Order summary">
        <h2>Summary</h2>
        <ul className="summary-lines">
          {cart.data.lines.map((l) => (
            <li key={l.sku}><span>{l.qty} × {l.name}<small>{optionText(l.options)}</small></span><span>{money(l.lineTotalCents)}</span></li>
          ))}
        </ul>
        <form className="coupon" onSubmit={(e) => { e.preventDefault(); setCoupon(couponInput.trim()); }}>
          <Field label="Discount code" value={couponInput} onChange={(e) => setCouponInput(e.target.value)}
            error={quote.data?.couponError ?? fe.couponCode} hint={coupon && !quote.data?.couponError ? `${coupon.toUpperCase()} applied` : "Try WELCOME10"} />
          <button className="btn btn-small">Apply</button>
        </form>
        {t && (
          <dl className="totals">
            <div><dt>Subtotal</dt><dd>{money(t.subtotalCents)}</dd></div>
            {t.discountCents > 0 && <div><dt>Discount</dt><dd>−{money(t.discountCents)}</dd></div>}
            <div><dt>Shipping</dt><dd>{t.shippingCents ? money(t.shippingCents) : "Free"}</dd></div>
            <div><dt>{t.taxLabel || "Tax"}</dt><dd>{money(t.taxCents)}</dd></div>
            <div className="grand"><dt>Total</dt><dd>{money(t.totalCents)} CAD</dd></div>
          </dl>
        )}
        {t && t.shippingCents > 0 && quote.data && (
          <p className="muted small">Add {money(quote.data.freeShippingOverCents - (t.subtotalCents - t.discountCents))} more for free shipping.</p>
        )}
      </aside>
    </div>
  );
}

export function Pay() {
  const { orderId = "" } = useParams();
  const [params] = useSearchParams();
  const key = params.get("key") ?? guestKeys.get(orderId);
  const navigate = useNavigate();
  const [outcome, setOutcome] = useState<string | null>(null);
  const intent = useQuery({
    queryKey: ["intent", orderId],
    queryFn: () => post<Intent>("/payments/intent", { orderId, guestKey: key }),
    retry: false,
    staleTime: Infinity,
  });
  const done = () => navigate(`/orders/${orderId}${key ? `?key=${key}` : ""}`, { replace: true });

  const mock = useMutation({
    mutationFn: (result: "succeed" | "fail") =>
      post<{ status: string; failureReason?: string }>("/payments/mock/confirm", { paymentId: intent.data!.paymentId, outcome: result }),
    onSuccess: (p) => (p.status === "succeeded" ? done() : setOutcome(p.failureReason ?? "Payment failed.")),
  });

  if (intent.isLoading) return <Loading />;
  if (intent.error) {
    return <div className="wrap section narrow"><ErrorNote error={intent.error} /><Link to={`/orders/${orderId}${key ? `?key=${key}` : ""}`}>View the order</Link></div>;
  }
  const i = intent.data!;
  return (
    <div className="wrap section narrow pay">
      <h1>Payment</h1>
      <p className="pay-amount">{money(i.amountCents)} <span>CAD</span></p>
      {i.provider === "stripe" ? (
        <Suspense fallback={<Loading />}>
          <StripePay intent={i} onPaid={done} />
        </Suspense>
      ) : (
        <div className="test-card">
          <p>
            This store runs with a test payment provider, so no card is needed. Choose what the
            "bank" says. Set Stripe test keys in <code>.env</code> to use real Stripe test mode instead.
          </p>
          {outcome && <p className="note note-error" role="alert">{outcome} Try again.</p>}
          <div className="test-actions">
            <button className="btn btn-primary" disabled={mock.isPending} onClick={() => mock.mutate("succeed")}>Pay {money(i.amountCents)}</button>
            <button className="btn btn-ghost" disabled={mock.isPending} onClick={() => mock.mutate("fail")}>Simulate a declined card</button>
          </div>
          <ErrorNote error={mock.error} />
        </div>
      )}
    </div>
  );
}

export function OrderView() {
  const { orderId = "" } = useParams();
  const [params] = useSearchParams();
  const key = params.get("key") ?? guestKeys.get(orderId);
  const order = useQuery({
    queryKey: ["order", orderId],
    queryFn: () => get<Order>(`/orders/${orderId}${qs({ key })}`),
    // Payment confirmation travels by event (payment-service -> RabbitMQ -> order-service),
    // so poll for a few seconds until the order shows as paid.
    refetchInterval: (q) => (q.state.data?.status === "pending_payment" ? 1500 : false),
  });
  if (order.isLoading) return <Loading />;
  const o = order.data;
  if (!o) return <div className="wrap section"><Empty title="Order not found"><p>Signed out? <Link to="/login">Sign in</Link> to see your orders.</p></Empty></div>;
  const justPaid = o.status === "paid" && Date.now() - new Date(o.history.at(-1)!.at).getTime() < 120_000;
  return (
    <div className="wrap section order">
      {justPaid && <p className="note note-ok" role="status">Thanks! Your order is confirmed. A receipt is on its way to {o.email}.</p>}
      <div className="order-head">
        <h1>Order {o.number}</h1>
        <StatusBadge status={o.status} />
      </div>
      <p className="muted">Placed {dateTime(o.createdAt)}</p>
      <StatusTimeline status={o.status} history={o.history} />
      {o.status === "pending_payment" && (
        <p className="note">
          Waiting for payment. <Link to={`/checkout/pay/${o.id}${key ? `?key=${key}` : ""}`}>Pay now</Link> — items are held until {dateTime(o.reservedUntil)}.
        </p>
      )}
      {o.tracking && <p>Tracking number: <strong>{o.tracking}</strong></p>}
      <div className="order-grid">
        <ul className="summary-lines">
          {o.lines.map((l) => (
            <li key={l.sku}><span>{l.qty} × <Link to={`/products/${l.slug}`}>{l.name}</Link><small>{optionText(l.options)}</small></span><span>{money(l.lineTotalCents)}</span></li>
          ))}
        </ul>
        <div>
          <dl className="totals">
            <div><dt>Subtotal</dt><dd>{money(o.totals.subtotalCents)}</dd></div>
            {o.totals.discountCents > 0 && <div><dt>Discount ({o.couponCode})</dt><dd>−{money(o.totals.discountCents)}</dd></div>}
            <div><dt>Shipping</dt><dd>{o.totals.shippingCents ? money(o.totals.shippingCents) : "Free"}</dd></div>
            <div><dt>{o.totals.taxLabel}</dt><dd>{money(o.totals.taxCents)}</dd></div>
            <div className="grand"><dt>Total</dt><dd>{money(o.totals.totalCents)}</dd></div>
            {o.refundedCents > 0 && <div><dt>Refunded</dt><dd>−{money(o.refundedCents)}</dd></div>}
          </dl>
          <address>
            {o.shippingAddress.name}<br />{o.shippingAddress.line1} {o.shippingAddress.line2}<br />
            {o.shippingAddress.city}, {o.shippingAddress.province} {o.shippingAddress.postalCode}
          </address>
        </div>
      </div>
    </div>
  );
}
