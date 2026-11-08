import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { onSession, post, refreshSession, setSession } from "../api/client";
import type { Session, User } from "../api/types";

interface AuthState {
  user: User | null;
  ready: boolean; // false until the first refresh attempt finishes
  isStaff: boolean;
  isAdmin: boolean;
  login(email: string, password: string): Promise<void>;
  register(name: string, email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  setUser(u: User): void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    const off = onSession((s) => setUserState(s?.user ?? null));
    // On page load the access token is gone (it only lived in memory), but the
    // httpOnly refresh cookie may still be valid: trade it for a new session.
    refreshSession().finally(() => setReady(true));
    return () => {
      off();
    };
  }, []);

  const afterSignIn = useCallback(
    async (s: Session) => {
      setSession(s);
      // Anything put in the cart as a guest moves into the account's cart.
      await post("/cart/merge").catch(() => undefined);
      await qc.invalidateQueries();
    },
    [qc],
  );

  const value = useMemo<AuthState>(() => {
    const roles = user?.roles ?? [];
    return {
      user,
      ready,
      isStaff: roles.includes("staff") || roles.includes("admin"),
      isAdmin: roles.includes("admin"),
      login: async (email, password) => afterSignIn(await post<Session>("/auth/login", { email, password })),
      register: async (name, email, password) =>
        afterSignIn(await post<Session>("/auth/register", { name, email, password })),
      logout: async () => {
        await post("/auth/logout").catch(() => undefined);
        setSession(null);
        qc.clear();
      },
      setUser: setUserState,
    };
  }, [user, ready, afterSignIn, qc]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
