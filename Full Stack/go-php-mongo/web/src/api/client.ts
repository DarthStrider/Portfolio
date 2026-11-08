// One fetch wrapper for every service. The browser only knows the gateway's /api/v1;
// which service answers is the gateway's business.
//
// Sessions: the short-lived access token lives in this module's memory (never in
// localStorage, where any injected script could read it). The long-lived refresh token
// is an httpOnly cookie the browser sends to /api/v1/auth automatically. When a call
// gets 401, we refresh once and retry.

import type { Session } from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<Session | null> | null = null;
const listeners = new Set<(s: Session | null) => void>();

/** Called by the auth provider so the UI follows sign-in, refresh and sign-out. */
export function onSession(fn: (s: Session | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setSession(s: Session | null) {
  accessToken = s?.accessToken ?? null;
  listeners.forEach((fn) => fn(s));
}

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body; // the browser sets the multipart boundary itself
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  return fetch(`/api/v1${path}`, { method, headers, body: payload, credentials: "same-origin" });
}

async function toError(res: Response): Promise<ApiError> {
  try {
    const data = await res.json();
    const e = data?.error ?? {};
    return new ApiError(res.status, e.code ?? "error", e.message ?? res.statusText, e.fields ?? {});
  } catch {
    return new ApiError(res.status, "error", res.statusText || "Request failed");
  }
}

/** Exchanges the refresh cookie for a new access token. Concurrent callers share one request. */
export function refreshSession(): Promise<Session | null> {
  refreshing ??= (async () => {
    try {
      const res = await send("POST", "/auth/refresh");
      const s = res.ok ? ((await res.json()) as Session) : null;
      setSession(s);
      return s;
    } catch {
      setSession(null);
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res = await send(method, path, body);
  if (res.status === 401 && accessToken && !path.startsWith("/auth/")) {
    if (await refreshSession()) res = await send(method, path, body);
  }
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const get = <T>(path: string) => api<T>("GET", path);
export const post = <T>(path: string, body?: unknown) => api<T>("POST", path, body);
export const put = <T>(path: string, body?: unknown) => api<T>("PUT", path, body);
export const patch = <T>(path: string, body?: unknown) => api<T>("PATCH", path, body);
export const del = <T>(path: string) => api<T>("DELETE", path);

/** Builds a query string, leaving out empty values. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}
