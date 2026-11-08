import { useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "../../api/client";
import type { Product, Review } from "../../api/types";
import { useAuth } from "../../auth/AuthProvider";
import { useCartActions } from "../../lib/cart";
import { date } from "../../lib/format";
import { Empty, ErrorNote, Field, Loading, Price, SelectField, Stars, TextField, fieldErrors } from "../../components/ui";

export function ProductView() {
  const { slug } = useParams();
  const product = useQuery({ queryKey: ["product", slug], queryFn: () => get<Product>(`/catalog/products/${slug}`) });
  if (product.isLoading) return <Loading />;
  if (!product.data) {
    return <div className="wrap section"><Empty title="We couldn't find that product"><Link to="/shop">Browse the shop</Link></Empty></div>;
  }
  return <ProductDetail p={product.data} />;
}

function ProductDetail({ p }: { p: Product }) {
  const { add } = useCartActions();
  // Option groups ("size", "colour") come from the variants themselves.
  const groups = useMemo(() => {
    const g: Record<string, string[]> = {};
    for (const v of p.variants) for (const [k, val] of Object.entries(v.options)) (g[k] ??= []).includes(val) || g[k].push(val);
    return g;
  }, [p]);
  const firstAvailable = p.variants.find((v) => v.available > 0) ?? p.variants[0];
  const [choice, setChoice] = useState<Record<string, string>>(firstAvailable.options);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const variant = p.variants.find((v) => Object.entries(choice).every(([k, val]) => v.options[k] === val)) ?? p.variants[0];
  const attrs = Array.isArray(p.attributes) ? [] : Object.entries(p.attributes);

  const addToCart = (e: FormEvent) => {
    e.preventDefault();
    setAdded(false);
    add.mutate({ sku: variant.sku, qty }, { onSuccess: () => setAdded(true) });
  };

  return (
    <div className="wrap product">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/shop">Shop</Link>
        {p.breadcrumbs?.map((c) => <Link key={c.id} to={`/shop/${c.slug}`}>{c.name}</Link>)}
      </nav>
      <div className="product-grid">
        <div className="product-media">
          <img src={p.images[0]?.url} alt={p.images[0]?.alt ?? p.name} />
        </div>
        <div className="product-info">
          <h1>{p.name}</h1>
          {p.rating.count > 0 && <a href="#reviews"><Stars value={p.rating.average} count={p.rating.count} /></a>}
          <p className="product-price"><Price cents={variant.priceCents} compareAt={variant.compareAtCents} /></p>
          <form onSubmit={addToCart} className="buy">
            {Object.entries(groups).map(([name, values]) => (
              <fieldset key={name} className="options">
                <legend>{name[0].toUpperCase() + name.slice(1)}</legend>
                {values.map((val) => {
                  const v = p.variants.find((x) => x.options[name] === val && Object.entries(choice).every(([k, cv]) => k === name || x.options[k] === cv));
                  const out = !v || v.available <= 0;
                  return (
                    <label key={val} className={`chip ${choice[name] === val ? "chip-on" : ""} ${out ? "chip-out" : ""}`}>
                      <input type="radio" name={name} value={val} checked={choice[name] === val}
                        onChange={() => { setChoice({ ...choice, [name]: val }); setQty(1); setAdded(false); }} />
                      {val}{out && <span className="sr-only"> (sold out)</span>}
                    </label>
                  );
                })}
              </fieldset>
            ))}
            <p className={`stock ${variant.available <= 0 ? "stock-out" : variant.available <= 5 ? "stock-low" : ""}`}>
              {variant.available <= 0 ? "Sold out" : variant.available <= 5 ? `Only ${variant.available} left` : "In stock, ships in 2 business days"}
            </p>
            <div className="buy-row">
              <label className="qty">
                <span className="sr-only">Quantity</span>
                <select value={qty} onChange={(e) => setQty(Number(e.target.value))} disabled={variant.available <= 0}>
                  {Array.from({ length: Math.max(1, Math.min(10, variant.available)) }, (_, i) => i + 1).map((n) => <option key={n}>{n}</option>)}
                </select>
              </label>
              <button className="btn btn-primary btn-wide" disabled={variant.available <= 0 || add.isPending}>
                {add.isPending ? "Adding…" : "Add to cart"}
              </button>
            </div>
            <ErrorNote error={add.error} />
            {added && <p className="note note-ok" role="status">Added to your cart. <Link to="/cart">View cart</Link></p>}
          </form>
          {p.description && <p className="product-desc">{p.description}</p>}
          {attrs.length > 0 && (
            <dl className="specs">
              {attrs.map(([k, v]) => (<div key={k}><dt>{k[0].toUpperCase() + k.slice(1)}</dt><dd>{v}</dd></div>))}
              <div><dt>SKU</dt><dd>{variant.sku}</dd></div>
            </dl>
          )}
        </div>
      </div>
      <Reviews productId={p.id} />
    </div>
  );
}

interface ReviewList { items: Review[]; average: number; count: number; canReview: boolean }

function Reviews({ productId }: { productId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["reviews", productId, user?.id], queryFn: () => get<ReviewList>(`/catalog/products/${productId}/reviews`) });
  const [form, setForm] = useState({ rating: "5", title: "", body: "" });
  const submit = useMutation({
    mutationFn: () => post<{ message: string }>(`/catalog/products/${productId}/reviews`, {
      rating: Number(form.rating), title: form.title, body: form.body, name: user?.name ?? "",
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reviews", productId] }),
  });
  const fe = fieldErrors(submit.error);

  return (
    <section id="reviews" className="reviews">
      <h2>Reviews</h2>
      {list.data && list.data.count > 0 && <p><Stars value={list.data.average} /> {list.data.average.toFixed(1)} from {list.data.count} {list.data.count === 1 ? "review" : "reviews"}</p>}
      {list.data?.items.length === 0 && <p className="muted">No reviews yet.</p>}
      <ul className="review-list">
        {list.data?.items.map((r) => (
          <li key={r.id}>
            <Stars value={r.rating} />
            <h3>{r.title}</h3>
            <p>{r.body}</p>
            <p className="muted">{r.name}, verified buyer, {date(r.createdAt)}</p>
          </li>
        ))}
      </ul>
      {submit.isSuccess ? (
        <p className="note note-ok">{submit.data?.message}</p>
      ) : list.data?.canReview ? (
        <form className="review-form" onSubmit={(e) => { e.preventDefault(); submit.mutate(); }}>
          <h3>Write a review</h3>
          <SelectField label="Rating" value={form.rating} onChange={(e) => setForm({ ...form, rating: e.target.value })} error={fe.rating}>
            {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} {n === 1 ? "star" : "stars"}</option>)}
          </SelectField>
          <Field label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} error={fe.title} maxLength={120} required />
          <TextField label="Your review" rows={4} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} error={fe.body} maxLength={3000} required />
          <ErrorNote error={submit.error} />
          <button className="btn btn-primary" disabled={submit.isPending}>Submit review</button>
        </form>
      ) : (
        <p className="muted">{user ? "Reviews are open to customers who bought this product." : <>Bought this? <Link to="/login">Sign in</Link> to review it.</>}</p>
      )}
    </section>
  );
}
