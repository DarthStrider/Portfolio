import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, del, get, post, put, qs } from "../../api/client";
import type { Category, CmsPage, List, Product, Review } from "../../api/types";
import { useAuth } from "../../auth/AuthProvider";
import { Empty, ErrorNote, Field, Loading, SelectField, Stars, TextField, fieldErrors } from "../../components/ui";
import { date, money, parseDollars } from "../../lib/format";

const useAdminCategories = () =>
  useQuery({ queryKey: ["admin-categories"], queryFn: () => get<List<Category>>("/admin/catalog/categories") });

export function Products() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const query = qs({ q: params.get("q"), status: params.get("status") });
  const list = useQuery({ queryKey: ["admin-products", query], queryFn: () => get<List<Product>>(`/admin/catalog/products${query}`) });
  return (
    <>
      <div className="page-head"><h1>Products</h1><Link to="/admin/products/new" className="btn btn-primary">Add a product</Link></div>
      <div className="toolbar">
        <select aria-label="Status" value={params.get("status") ?? ""} onChange={(e) => setParams(e.target.value ? { status: e.target.value } : {})}>
          <option value="">Every status</option><option value="active">Active</option><option value="draft">Draft</option><option value="archived">Archived</option>
        </select>
        <form onSubmit={(e) => { e.preventDefault(); setParams(q ? { q } : {}); }}>
          <input type="search" aria-label="Search products" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
      </div>
      {list.isLoading ? <Loading /> : (
        <table className="table">
          <thead><tr><th /><th>Name</th><th>Status</th><th>Variants</th><th className="num">Price</th><th className="num">Available</th></tr></thead>
          <tbody>
            {list.data?.items.map((p) => (
              <tr key={p.id}>
                <td><img className="thumb" src={p.images[0]?.url} alt="" /></td>
                <td><Link to={`/admin/products/${p.id}`}>{p.name}</Link></td>
                <td>{p.status}</td>
                <td>{p.variants.length}</td>
                <td className="num">{p.priceMin === p.priceMax ? money(p.priceMin) : `${money(p.priceMin)}–${money(p.priceMax)}`}</td>
                <td className="num">{p.variants.reduce((n, v) => n + (v.available ?? 0), 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

interface VariantRow { sku: string; options: string; price: string; compareAt: string; initialStock: string; saved: boolean }

const optionsToText = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${k}: ${v}`).join(", ");
const textToOptions = (t: string) =>
  Object.fromEntries(t.split(",").map((p) => p.split(/[:=]/).map((s) => s.trim())).filter((kv) => kv.length === 2 && kv[0] && kv[1]));
const dollars = (c: number | null | undefined) => (c || c === 0 ? (c / 100).toFixed(2) : "");

export function ProductEdit() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const cats = useAdminCategories();
  const existing = useQuery({ queryKey: ["admin-product", id], queryFn: () => get<Product>(`/admin/catalog/products/${id}`), enabled: !isNew });

  const [f, setF] = useState({ name: "", slug: "", description: "", brand: "Northline", status: "draft", categoryIds: [] as string[] });
  const [images, setImages] = useState<{ url: string; alt: string }[]>([]);
  const [attrs, setAttrs] = useState<[string, string][]>([["", ""]]);
  const [variants, setVariants] = useState<VariantRow[]>([{ sku: "", options: "", price: "", compareAt: "", initialStock: "0", saved: false }]);

  useEffect(() => {
    const p = existing.data;
    if (!p) return;
    setF({ name: p.name, slug: p.slug, description: p.description ?? "", brand: p.brand, status: p.status, categoryIds: p.categoryIds });
    setImages(p.images);
    setAttrs([...(Array.isArray(p.attributes) ? [] : Object.entries(p.attributes)), ["", ""]]);
    setVariants(p.variants.map((v) => ({ sku: v.sku, options: optionsToText(v.options), price: dollars(v.priceCents), compareAt: dollars(v.compareAtCents), initialStock: "0", saved: true })));
  }, [existing.data]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        images,
        attributes: Object.fromEntries(attrs.filter(([k, v]) => k.trim() && v.trim())),
        variants: variants.map((v) => ({
          sku: v.sku,
          options: textToOptions(v.options),
          priceCents: parseDollars(v.price),
          compareAtCents: v.compareAt ? parseDollars(v.compareAt) : null,
          initialStock: v.saved ? 0 : Number(v.initialStock) || 0,
        })),
      };
      return isNew ? post<Product>("/admin/catalog/products", body) : put<Product>(`/admin/catalog/products/${id}`, body);
    },
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["admin-products"] });
      qc.setQueryData(["admin-product", p.id], p);
      if (isNew) navigate(`/admin/products/${p.id}`, { replace: true });
    },
  });
  const remove = useMutation({
    mutationFn: () => del(`/admin/catalog/products/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-products"] }); navigate("/admin/products"); },
  });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return api<{ url: string }>("POST", "/admin/catalog/images", fd);
    },
    onSuccess: ({ url }) => setImages([...images, { url, alt: f.name }]),
  });
  const fe = fieldErrors(save.error);
  const setV = (i: number, k: keyof VariantRow) => (e: ChangeEvent<HTMLInputElement>) =>
    setVariants(variants.map((v, j) => (j === i ? { ...v, [k]: e.target.value } : v)));

  if (!isNew && existing.isLoading) return <Loading />;
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(); };

  return (
    <form className="editor" onSubmit={submit} noValidate>
      <p><Link to="/admin/products">Products</Link></p>
      <div className="page-head">
        <h1>{isNew ? "New product" : f.name || "Product"}</h1>
        <div className="actions">
          {!isNew && f.status === "active" && <Link to={`/products/${f.slug}`} className="btn btn-ghost">View in shop</Link>}
          <button className="btn btn-primary" disabled={save.isPending}>{save.isPending ? "Saving…" : isNew ? "Create product" : "Save changes"}</button>
        </div>
      </div>
      <ErrorNote error={save.error} />
      {save.isSuccess && <p className="note note-ok" role="status">Saved. Order-service has been told about the change.</p>}

      <section className="panel form-grid">
        <Field label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={fe.name} />
        <Field label="URL slug" value={f.slug} hint="Leave empty to make one from the name." onChange={(e) => setF({ ...f, slug: e.target.value })} error={fe.slug} />
        <Field label="Brand" value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} />
        <SelectField label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} error={fe.status}>
          <option value="draft">Draft (hidden)</option><option value="active">Active (for sale)</option><option value="archived">Archived</option>
        </SelectField>
        <TextField label="Description" rows={5} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} error={fe.description} />
      </section>

      <section className="panel">
        <h2>Categories</h2>
        <div className="check-grid">
          {cats.data?.items.map((c) => (
            <label key={c.id} className="check">
              <input type="checkbox" checked={f.categoryIds.includes(c.id)}
                onChange={(e) => setF({ ...f, categoryIds: e.target.checked ? [...f.categoryIds, c.id] : f.categoryIds.filter((x) => x !== c.id) })} />
              {c.path.length > 0 && "— "}{c.name}
            </label>
          ))}
        </div>
        {fe.categoryIds && <p className="field-error">{fe.categoryIds}</p>}
      </section>

      <section className="panel">
        <h2>Images</h2>
        <div className="image-row">
          {images.map((img, i) => (
            <figure key={img.url + i}>
              <img src={img.url} alt={img.alt} />
              <button type="button" className="link-btn" onClick={() => setImages(images.filter((_, j) => j !== i))}>Remove</button>
              {fe[`images.${i}.url`] && <p className="field-error">{fe[`images.${i}.url`]}</p>}
            </figure>
          ))}
        </div>
        <label className="btn btn-small upload">
          {upload.isPending ? "Uploading…" : "Upload an image"}
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
        </label>
        <ErrorNote error={upload.error} />
      </section>

      <section className="panel">
        <h2>Variants</h2>
        <p className="muted small">Each variant is a SKU you stock and sell. Options look like "size: M, colour: Navy". Starting stock applies to new SKUs only; change stock later on the Inventory page.</p>
        {fe.variants && <p className="field-error">{fe.variants}</p>}
        <table className="table variants">
          <thead><tr><th>SKU</th><th>Options</th><th>Price ($)</th><th>Was ($)</th><th>Starting stock</th><th /></tr></thead>
          <tbody>
            {variants.map((v, i) => (
              <tr key={i}>
                <td><input aria-label="SKU" value={v.sku} readOnly={v.saved} onChange={setV(i, "sku")} aria-invalid={!!fe[`variants.${i}.sku`]} />{fe[`variants.${i}.sku`] && <p className="field-error">{fe[`variants.${i}.sku`]}</p>}</td>
                <td><input aria-label="Options" value={v.options} onChange={setV(i, "options")} /></td>
                <td><input aria-label="Price" inputMode="decimal" value={v.price} onChange={setV(i, "price")} aria-invalid={!!fe[`variants.${i}.priceCents`]} />{fe[`variants.${i}.priceCents`] && <p className="field-error">{fe[`variants.${i}.priceCents`]}</p>}</td>
                <td><input aria-label="Compare-at price" inputMode="decimal" value={v.compareAt} onChange={setV(i, "compareAt")} />{fe[`variants.${i}.compareAtCents`] && <p className="field-error">{fe[`variants.${i}.compareAtCents`]}</p>}</td>
                <td>{v.saved ? <span className="muted">See inventory</span> : <input aria-label="Starting stock" inputMode="numeric" value={v.initialStock} onChange={setV(i, "initialStock")} />}</td>
                <td>{variants.length > 1 && <button type="button" className="link-btn" onClick={() => setVariants(variants.filter((_, j) => j !== i))}>Remove</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="btn btn-small" onClick={() => setVariants([...variants, { sku: "", options: "", price: variants.at(-1)?.price ?? "", compareAt: "", initialStock: "0", saved: false }])}>Add a variant</button>
      </section>

      <section className="panel">
        <h2>Details</h2>
        {attrs.map(([k, v], i) => (
          <div className="field-row" key={i}>
            <Field label="Detail" placeholder="Material" value={k} onChange={(e) => setAttrs(attrs.map((a, j): [string, string] => (j === i ? [e.target.value, a[1]] : a)).concat(i === attrs.length - 1 && e.target.value ? [["", ""]] : []))} />
            <Field label="Value" placeholder="Organic cotton" value={v} onChange={(e) => setAttrs(attrs.map((a, j): [string, string] => (j === i ? [a[0], e.target.value] : a)))} />
          </div>
        ))}
      </section>

      {!isNew && isAdmin && (
        <section className="panel danger-zone">
          <h2>Delete product</h2>
          <p className="muted">Removes it from the shop and stops it being sold. Past orders keep their copy. To hide it for now, set the status to Archived instead.</p>
          <button type="button" className="btn btn-danger" onClick={() => confirm(`Delete ${f.name}? This can't be undone.`) && remove.mutate()}>Delete product</button>
          <ErrorNote error={remove.error} />
        </section>
      )}
    </form>
  );
}

export function Categories() {
  const qc = useQueryClient();
  const cats = useAdminCategories();
  const [editing, setEditing] = useState<Partial<Category> | null>(null);
  const save = useMutation({
    mutationFn: (c: Partial<Category>) => {
      const body = { name: c.name, slug: c.slug, parentId: c.parentId || null, description: c.description ?? "", position: Number(c.position) || 0 };
      return c.id ? put<Category>(`/admin/catalog/categories/${c.id}`, body) : post<Category>("/admin/catalog/categories", body);
    },
    onSuccess: () => { setEditing(null); qc.invalidateQueries({ queryKey: ["admin-categories"] }); qc.invalidateQueries({ queryKey: ["categories"] }); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/admin/catalog/categories/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-categories"] }); qc.invalidateQueries({ queryKey: ["categories"] }); },
  });
  const all = cats.data?.items ?? [];
  const nameOf = (id: string) => all.find((c) => c.id === id)?.name ?? "?";
  const fe = fieldErrors(save.error);
  return (
    <>
      <div className="page-head"><h1>Categories</h1><button className="btn btn-primary" onClick={() => setEditing({ name: "", parentId: null, position: 0 })}>Add a category</button></div>
      <ErrorNote error={remove.error} />
      <table className="table">
        <thead><tr><th>Name</th><th>Inside</th><th>URL</th><th className="num">Order</th><th /></tr></thead>
        <tbody>
          {[...all].sort((a, b) => [...a.path, a.id].map(nameOf).join("/").localeCompare([...b.path, b.id].map(nameOf).join("/"))).map((c) => (
            <tr key={c.id}>
              <td style={{ paddingLeft: `${0.75 + c.path.length * 1.25}rem` }}>{c.name}</td>
              <td>{c.path.map(nameOf).join(" / ") || <span className="muted">Top level</span>}</td>
              <td>/shop/{c.slug}</td>
              <td className="num">{c.position}</td>
              <td className="actions">
                <button className="link-btn" onClick={() => setEditing(c)}>Edit</button>
                <button className="link-btn" onClick={() => confirm(`Delete ${c.name}?`) && remove.mutate(c.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && (
        <form className="panel form-grid" onSubmit={(e) => { e.preventDefault(); save.mutate(editing); }}>
          <h2>{editing.id ? `Edit ${editing.name}` : "New category"}</h2>
          <Field label="Name" value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} error={fe.name} />
          <Field label="URL slug" value={editing.slug ?? ""} hint="Leave empty to make one from the name." onChange={(e) => setEditing({ ...editing, slug: e.target.value })} error={fe.slug} />
          <SelectField label="Inside" value={editing.parentId ?? ""} onChange={(e) => setEditing({ ...editing, parentId: e.target.value || null })} error={fe.parentId}>
            <option value="">Top level</option>
            {all.filter((c) => c.id !== editing.id).map((c) => <option key={c.id} value={c.id}>{[...c.path, c.id].map(nameOf).join(" / ")}</option>)}
          </SelectField>
          <Field label="Menu order" inputMode="numeric" value={String(editing.position ?? 0)} onChange={(e) => setEditing({ ...editing, position: Number(e.target.value) || 0 })} />
          <ErrorNote error={save.error} />
          <div className="actions">
            <button className="btn btn-primary" disabled={save.isPending}>Save category</button>
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      )}
    </>
  );
}

export function Reviews() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("pending");
  const list = useQuery({ queryKey: ["admin-reviews", status], queryFn: () => get<List<Review>>(`/admin/catalog/reviews?status=${status}`) });
  const moderate = useMutation({
    mutationFn: (v: { id: string; status: string }) => post(`/admin/catalog/reviews/${v.id}/status`, { status: v.status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-reviews"] }),
  });
  return (
    <>
      <h1>Reviews</h1>
      <div className="tabs" role="tablist">
        {["pending", "approved", "rejected"].map((s) => (
          <button key={s} role="tab" aria-selected={status === s} className={status === s ? "tab tab-on" : "tab"} onClick={() => setStatus(s)}>{s[0].toUpperCase() + s.slice(1)}</button>
        ))}
      </div>
      {list.isLoading ? <Loading /> : list.data?.items.length === 0 ? (
        <p className="muted">{status === "pending" ? "Nothing waiting. New reviews from verified buyers land here." : "None yet."}</p>
      ) : (
        <ul className="review-list admin-reviews">
          {list.data?.items.map((r) => (
            <li key={r.id}>
              <p className="muted">{r.productName}, by {r.name}, {date(r.createdAt)}</p>
              <Stars value={r.rating} />
              <h3>{r.title}</h3>
              <p>{r.body}</p>
              <div className="actions">
                {r.status !== "approved" && <button className="btn btn-small btn-primary" onClick={() => moderate.mutate({ id: r.id, status: "approved" })}>Publish</button>}
                {r.status !== "rejected" && <button className="btn btn-small" onClick={() => moderate.mutate({ id: r.id, status: "rejected" })}>Reject</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function Pages() {
  const list = useQuery({ queryKey: ["admin-pages"], queryFn: () => get<List<CmsPage>>("/admin/content/pages") });
  const [slug, setSlug] = useState("");
  const navigate = useNavigate();
  return (
    <>
      <h1>Pages</h1>
      <table className="table">
        <thead><tr><th>Title</th><th>URL</th><th>Status</th><th>Updated</th></tr></thead>
        <tbody>
          {list.data?.items.map((p) => (
            <tr key={p.id}><td><Link to={`/admin/pages/${p.id}`}>{p.title}</Link></td><td>/pages/{p.id}</td><td>{p.published ? "Published" : "Hidden"}</td><td>{date(p.updatedAt)}</td></tr>
          ))}
        </tbody>
      </table>
      <form className="toolbar" onSubmit={(e) => { e.preventDefault(); if (slug) navigate(`/admin/pages/${slug.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`); }}>
        <input aria-label="New page URL" placeholder="new-page-url" value={slug} onChange={(e) => setSlug(e.target.value)} />
        <button className="btn btn-small">Create page</button>
      </form>
    </>
  );
}

export function PageEdit() {
  const { slug = "" } = useParams();
  const qc = useQueryClient();
  const page = useQuery({ queryKey: ["admin-page", slug], queryFn: () => get<CmsPage>(`/admin/content/pages/${slug}`).catch(() => null) });
  const [f, setF] = useState({ title: "", body: "", published: true });
  useEffect(() => { if (page.data) setF({ title: page.data.title, body: page.data.body, published: page.data.published }); }, [page.data]);
  const save = useMutation({
    mutationFn: () => put<CmsPage>(`/admin/content/pages/${slug}`, f),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-pages"] }); qc.invalidateQueries({ queryKey: ["page", slug] }); },
  });
  const fe = fieldErrors(save.error);
  if (page.isLoading) return <Loading />;
  return (
    <form className="editor" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <p><Link to="/admin/pages">Pages</Link></p>
      <h1>/pages/{slug}</h1>
      <section className="panel form-grid">
        <Field label="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} error={fe.title} />
        <TextField label="Text" rows={12} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} error={fe.body} />
        <p className="muted small">Leave a blank line between paragraphs.</p>
        <label className="check"><input type="checkbox" checked={f.published} onChange={(e) => setF({ ...f, published: e.target.checked })} /> Published</label>
        <ErrorNote error={save.error} />
        <div className="actions">
          <button className="btn btn-primary" disabled={save.isPending}>Save page</button>
          {save.isSuccess && <span className="saved" role="status">Saved</span>}
        </div>
      </section>
      {!page.data && !save.isSuccess && <Empty title="New page"><p>Fill in the title and text, then save.</p></Empty>}
    </form>
  );
}
