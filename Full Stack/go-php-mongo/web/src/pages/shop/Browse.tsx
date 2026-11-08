import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { get, qs } from "../../api/client";
import type { Category, CmsPage, ProductPage } from "../../api/types";
import { Contours } from "../../components/Contours";
import { useCategories } from "../../components/Layout";
import { Empty, Loading, ProductTile } from "../../components/ui";

export function Home() {
  const featured = useQuery({
    queryKey: ["products", "home"],
    queryFn: () => get<ProductPage>("/catalog/products?sort=featured&perPage=8"),
  });
  const cats = useCategories();
  return (
    <>
      <section className="hero">
        <Contours className="hero-map" seed={11} />
        <div className="wrap hero-copy">
          <h1>Made for the long weekend outside.</h1>
          <p>Hoodies that survive the campfire, mugs that survive the hike in, and a rain shell that packs into its own pocket.</p>
          <div className="hero-actions">
            <Link to="/shop" className="btn btn-primary">Shop everything</Link>
            <Link to="/pages/about" className="btn btn-ghost">Our story</Link>
          </div>
        </div>
      </section>

      <section className="wrap section">
        <div className="dept-row">
          {cats.data?.items.map((c) => (
            <Link key={c.id} to={`/shop/${c.slug}`} className="dept">
              <span className="dept-name">{c.name}</span>
              <span className="dept-subs">{c.children?.map((s) => s.name).join(", ")}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="wrap section">
        <div className="section-head">
          <h2>Customer favourites</h2>
          <Link to="/shop">See all products</Link>
        </div>
        {featured.isLoading ? <Loading /> : (
          <div className="grid">{featured.data?.items.map((p) => <ProductTile key={p.id} p={p} />)}</div>
        )}
      </section>

      <section className="wrap section promise">
        <div><h3>Free shipping over $75</h3><p>Flat $9.99 below that, anywhere in Canada.</p></div>
        <div><h3>30-day returns</h3><p>Unused items, refunded to your original card.</p></div>
        <div><h3>Built to be repaired</h3><p>Spare buttons, zips and laces for the life of the item.</p></div>
      </section>
    </>
  );
}

const SORTS = [
  ["featured", "Featured"],
  ["newest", "Newest"],
  ["price_asc", "Price: low to high"],
  ["price_desc", "Price: high to low"],
  ["rating", "Top rated"],
] as const;

function findCat(tree: Category[] | undefined, slug: string | undefined): Category | undefined {
  for (const c of tree ?? []) {
    if (c.slug === slug) return c;
    const hit = findCat(c.children, slug);
    if (hit) return hit;
  }
  return undefined;
}

export function Catalog() {
  const { category } = useParams();
  const [params, setParams] = useSearchParams();
  const cats = useCategories();
  const page = Number(params.get("page") ?? 1);
  const q = params.get("q") ?? "";
  const sort = params.get("sort") ?? (q ? "relevance" : "featured");
  const [minPrice, setMin] = useState(params.get("minPrice") ?? "");
  const [maxPrice, setMax] = useState(params.get("maxPrice") ?? "");
  useEffect(() => {
    setMin(params.get("minPrice") ?? "");
    setMax(params.get("maxPrice") ?? "");
  }, [params]);

  const query = qs({
    q, category, sort, page,
    minPrice: params.get("minPrice"), maxPrice: params.get("maxPrice"), inStock: params.get("inStock"),
  });
  const res = useQuery({
    queryKey: ["products", query],
    queryFn: () => get<ProductPage>(`/catalog/products${query}`),
    placeholderData: keepPreviousData, // keep the grid on screen while the next page loads
  });

  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) (v ? next.set(k, v) : next.delete(k));
    if (!("page" in changes)) next.delete("page");
    setParams(next);
  };

  const current = findCat(cats.data?.items, category);
  const title = q ? `Results for “${q}”` : current?.name ?? "All products";
  const pages = res.data ? Math.ceil(res.data.total / res.data.perPage) : 0;

  return (
    <div className="wrap shop">
      <aside className="filters" aria-label="Filters">
        <h2 className="filters-title">Departments</h2>
        <ul className="cat-tree">
          <li><Link to={`/shop${q ? `?q=${encodeURIComponent(q)}` : ""}`} aria-current={!category ? "page" : undefined}>All products</Link></li>
          {cats.data?.items.map((c) => (
            <li key={c.id}>
              <Link to={`/shop/${c.slug}`} aria-current={category === c.slug ? "page" : undefined}>{c.name}</Link>
              {c.children && c.children.length > 0 && (
                <ul>
                  {c.children.map((s) => (
                    <li key={s.id}><Link to={`/shop/${s.slug}`} aria-current={category === s.slug ? "page" : undefined}>{s.name}</Link></li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>

        <h2 className="filters-title">Price</h2>
        <form className="price-filter" onSubmit={(e) => { e.preventDefault(); set({ minPrice, maxPrice }); }}>
          <input inputMode="decimal" placeholder="Min $" aria-label="Minimum price in dollars" value={minPrice} onChange={(e) => setMin(e.target.value)} />
          <input inputMode="decimal" placeholder="Max $" aria-label="Maximum price in dollars" value={maxPrice} onChange={(e) => setMax(e.target.value)} />
          <button className="btn btn-small">Apply</button>
        </form>
        <label className="check">
          <input type="checkbox" checked={params.get("inStock") === "1"} onChange={(e) => set({ inStock: e.target.checked ? "1" : null })} />
          In stock only
        </label>
      </aside>

      <section className="results">
        <div className="results-head">
          <div>
            <h1>{title}</h1>
            {res.data && <p className="muted">{res.data.total} {res.data.total === 1 ? "product" : "products"}</p>}
          </div>
          <label className="sort">
            Sort by
            <select value={sort} onChange={(e) => set({ sort: e.target.value })}>
              {q && <option value="relevance">Best match</option>}
              {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>
        {res.isLoading ? <Loading /> : res.data && res.data.items.length === 0 ? (
          <Empty title="Nothing matches those filters">
            <p>Try a wider price range, or <Link to="/shop">browse everything</Link>.</p>
          </Empty>
        ) : (
          <div className="grid" aria-busy={res.isFetching}>{res.data?.items.map((p) => <ProductTile key={p.id} p={p} />)}</div>
        )}
        {pages > 1 && (
          <nav className="pager" aria-label="Pages">
            <button className="btn btn-small" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>Previous</button>
            <span>Page {page} of {pages}</span>
            <button className="btn btn-small" disabled={page >= pages} onClick={() => set({ page: String(page + 1) })}>Next</button>
          </nav>
        )}
      </section>
    </div>
  );
}

/** About, Shipping, Returns: written in the admin panel, stored by catalog-service. */
export function ContentPage() {
  const { slug } = useParams();
  const page = useQuery({ queryKey: ["page", slug], queryFn: () => get<CmsPage>(`/content/pages/${slug}`) });
  if (page.isLoading) return <Loading />;
  if (!page.data) return <div className="wrap section"><Empty title="Page not found"><Link to="/">Back to the shop</Link></Empty></div>;
  return (
    <article className="wrap prose section">
      <h1>{page.data.title}</h1>
      {page.data.body.split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>)}
    </article>
  );
}
