import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { del, get, patch, post } from "../../api/client";
import type { Address, List, Order, User } from "../../api/types";
import { useAuth } from "../../auth/AuthProvider";
import { date, money, PROVINCES } from "../../lib/format";
import { Empty, ErrorNote, Field, Loading, SelectField, StatusBadge, fieldErrors } from "../../components/ui";

/** Only allow same-site paths after sign-in, never "https://evil.example". */
function safeNext(next: string | null) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/account";
}

export function Login() {
  const { login, user } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });
  const m = useMutation({
    mutationFn: () => login(form.email, form.password),
    onSuccess: () => navigate(safeNext(params.get("next")), { replace: true }),
  });
  if (user && !m.isPending) return <Navigate to={safeNext(params.get("next"))} replace />;
  return (
    <div className="wrap section auth">
      <h1>Sign in</h1>
      <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Email" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <Field label="Password" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        <ErrorNote error={m.error} />
        <button className="btn btn-primary btn-wide" disabled={m.isPending}>Sign in</button>
      </form>
      <p><Link to="/forgot-password">Forgot your password?</Link></p>
      <p>New here? <Link to={`/register${params.get("next") ? `?next=${params.get("next")}` : ""}`}>Create an account</Link></p>
    </div>
  );
}

export function Register() {
  const { register } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const m = useMutation({
    mutationFn: () => register(form.name, form.email, form.password),
    onSuccess: () => navigate(safeNext(params.get("next")), { replace: true }),
  });
  const fe = fieldErrors(m.error);
  return (
    <div className="wrap section auth">
      <h1>Create an account</h1>
      <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }} noValidate>
        <Field label="Name" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={fe.name} />
        <Field label="Email" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={fe.email} />
        <Field label="Password" type="password" autoComplete="new-password" value={form.password} hint="At least 10 characters." onChange={(e) => setForm({ ...form, password: e.target.value })} error={fe.password} />
        <ErrorNote error={m.error} />
        <button className="btn btn-primary btn-wide" disabled={m.isPending}>Create account</button>
      </form>
      <p>Already have one? <Link to="/login">Sign in</Link></p>
    </div>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const m = useMutation({ mutationFn: () => post<{ message: string }>("/auth/forgot-password", { email }) });
  return (
    <div className="wrap section auth">
      <h1>Reset your password</h1>
      {m.isSuccess ? (
        <p className="note note-ok">If {email} has an account, a reset link is on its way. In this demo, open Mailpit at <a href="http://localhost:8025">localhost:8025</a> to read it.</p>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
          <Field label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <ErrorNote error={m.error} />
          <button className="btn btn-primary btn-wide" disabled={m.isPending}>Send reset link</button>
        </form>
      )}
    </div>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const [password, setPassword] = useState("");
  const m = useMutation({ mutationFn: () => post("/auth/reset-password", { token: params.get("token") ?? "", password }) });
  return (
    <div className="wrap section auth">
      <h1>Choose a new password</h1>
      {m.isSuccess ? (
        <p className="note note-ok">Password changed. <Link to="/login">Sign in</Link> with your new password.</p>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
          <Field label="New password" type="password" autoComplete="new-password" hint="At least 10 characters." value={password} onChange={(e) => setPassword(e.target.value)} error={fieldErrors(m.error).password} />
          <ErrorNote error={m.error} />
          <button className="btn btn-primary btn-wide" disabled={m.isPending}>Change password</button>
        </form>
      )}
    </div>
  );
}

export function AccountPage() {
  const { user, ready, logout, setUser } = useAuth();
  const navigate = useNavigate();
  const orders = useQuery({ queryKey: ["my-orders"], queryFn: () => get<List<Order>>("/orders"), enabled: !!user });
  if (!ready) return <Loading />;
  if (!user) return <Navigate to="/login?next=/account" replace />;

  return (
    <div className="wrap section account">
      <div className="account-head">
        <h1>Hi, {user.name.split(" ")[0]}</h1>
        <button className="btn btn-ghost" onClick={async () => { await logout(); navigate("/"); }}>Sign out</button>
      </div>

      <section>
        <h2>Orders</h2>
        {orders.isLoading ? <Loading /> : orders.data?.items.length ? (
          <table className="table">
            <thead><tr><th>Order</th><th>Date</th><th>Status</th><th className="num">Total</th></tr></thead>
            <tbody>
              {orders.data.items.map((o) => (
                <tr key={o.id}>
                  <td><Link to={`/orders/${o.id}`}>{o.number}</Link></td>
                  <td>{date(o.createdAt)}</td>
                  <td><StatusBadge status={o.status} /></td>
                  <td className="num">{money(o.totals.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty title="No orders yet"><Link to="/shop">Find something you like</Link></Empty>
        )}
      </section>

      <div className="account-cols">
        <Addresses user={user} onChange={setUser} />
        <Profile user={user} onChange={setUser} />
      </div>
    </div>
  );
}

const blank: Address = { name: "", line1: "", line2: "", city: "", province: "ON", postalCode: "", phone: "" };

function Addresses({ user, onChange }: { user: User; onChange: (u: User) => void }) {
  const [form, setForm] = useState<Address | null>(null);
  const add = useMutation({
    mutationFn: (a: Address) => post<User>("/me/addresses", a),
    onSuccess: (u) => { onChange(u); setForm(null); },
  });
  const remove = useMutation({ mutationFn: (id: string) => del<User>(`/me/addresses/${id}`), onSuccess: onChange });
  const fe = fieldErrors(add.error);
  const set = (k: keyof Address) => (e: { target: { value: string } }) => form && setForm({ ...form, [k]: e.target.value });

  return (
    <section>
      <h2>Addresses</h2>
      {user.addresses.length === 0 && !form && <p className="muted">Saved addresses fill in checkout for you.</p>}
      <ul className="addr-list">
        {user.addresses.map((a) => (
          <li key={a.id}>
            <address>{a.name}<br />{a.line1} {a.line2}<br />{a.city}, {a.province} {a.postalCode}</address>
            <button className="link-btn" onClick={() => remove.mutate(a.id!)}>Remove</button>
          </li>
        ))}
      </ul>
      {form ? (
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); add.mutate(form); }} noValidate>
          <Field label="Full name" value={form.name} onChange={set("name")} error={fe.name} />
          <Field label="Street address" value={form.line1} onChange={set("line1")} error={fe.line1} />
          <Field label="Apartment, suite (optional)" value={form.line2} onChange={set("line2")} />
          <div className="field-row">
            <Field label="City" value={form.city} onChange={set("city")} error={fe.city} />
            <SelectField label="Province" value={form.province} onChange={set("province")} error={fe.province}>
              {PROVINCES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </SelectField>
            <Field label="Postal code" value={form.postalCode} onChange={set("postalCode")} error={fe.postalCode} />
          </div>
          <ErrorNote error={add.error} />
          <div className="actions">
            <button className="btn btn-primary" disabled={add.isPending}>Save address</button>
            <button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button className="btn" onClick={() => setForm(blank)}>Add an address</button>
      )}
    </section>
  );
}

function Profile({ user, onChange }: { user: User; onChange: (u: User) => void }) {
  const { login } = useAuth();
  const [name, setName] = useState(user.name);
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  const rename = useMutation({ mutationFn: () => patch<User>("/me", { name }), onSuccess: onChange });
  // Changing the password ends every session, this one included, so sign straight back in.
  const change = useMutation({
    mutationFn: async () => {
      await post("/me/password", pw);
      await login(user.email, pw.newPassword);
    },
    onSuccess: () => setPw({ currentPassword: "", newPassword: "" }),
  });
  const fe = fieldErrors(change.error);
  return (
    <section>
      <h2>Profile</h2>
      <form onSubmit={(e) => { e.preventDefault(); rename.mutate(); }}>
        <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} error={fieldErrors(rename.error).name} />
        <button className="btn" disabled={rename.isPending}>Save name</button>
        {rename.isSuccess && <span className="saved" role="status">Saved</span>}
      </form>
      <form onSubmit={(e) => { e.preventDefault(); change.mutate(); }}>
        <h3>Change password</h3>
        <Field label="Current password" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} error={fe.currentPassword} />
        <Field label="New password" type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} error={fe.newPassword} />
        <ErrorNote error={change.isError && Object.keys(fe).length === 0 ? change.error : null} />
        <button className="btn" disabled={change.isPending}>Change password</button>
        {change.isSuccess && <p className="note note-ok">Password changed. Other devices have been signed out.</p>}
      </form>
    </section>
  );
}
