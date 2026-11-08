import { useState, type FormEvent } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { get } from "../api/client";
import type { Category, List } from "../api/types";
import { useAuth } from "../auth/AuthProvider";
import { useCart } from "../lib/cart";

export function Logo() {
  return (
    <Link to="/" className="logo" aria-label="Northline home">
      <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden>
        <path d="M5 24 L13 10 L17 17 L20 13 L27 24 Z" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
      </svg>
      <span>Northline</span>
    </Link>
  );
}

export function useCategories() {
  return useQuery({ queryKey: ["categories"], queryFn: () => get<List<Category>>("/catalog/categories"), staleTime: 300_000 });
}

export function ShopLayout() {
  const { user, isStaff } = useAuth();
  const cart = useCart();
  const cats = useCategories();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const count = cart.data?.itemCount ?? 0;

  const search = (e: FormEvent) => {
    e.preventDefault();
    navigate(`/shop?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <>
      <a href="#main" className="skip">Skip to content</a>
      <header className="site-header">
        <div className="wrap header-row">
          <Logo />
          <nav className="main-nav" aria-label="Departments">
            {cats.data?.items.map((c) => (
              <NavLink key={c.id} to={`/shop/${c.slug}`}>
                {c.name}
              </NavLink>
            ))}
          </nav>
          <form className="search" role="search" onSubmit={search}>
            <input type="search" placeholder="Search" aria-label="Search products" value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
          <nav className="user-nav" aria-label="Account">
            {isStaff && <Link to="/admin">Admin</Link>}
            <Link to={user ? "/account" : "/login"}>{user ? user.name.split(" ")[0] : "Sign in"}</Link>
            <Link to="/cart" className="cart-link">
              Cart{count > 0 && <span className="cart-count" aria-label={`${count} items`}>{count}</span>}
            </Link>
          </nav>
        </div>
      </header>
      <main id="main">
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="wrap footer-row">
          <div>
            <Logo />
            <p>Durable goods for weekends outside. Designed in Toronto, shipped across Canada.</p>
          </div>
          <nav aria-label="Help">
            <Link to="/pages/shipping">Shipping</Link>
            <Link to="/pages/returns">Returns</Link>
            <Link to="/pages/about">About us</Link>
          </nav>
          <p className="footer-note">
            A portfolio project: a Go, PHP, MongoDB and React store. Payments run in test mode; nothing is charged.
          </p>
        </div>
      </footer>
    </>
  );
}
