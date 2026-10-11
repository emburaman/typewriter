"use client";

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, getMe, logout } from "@/lib/api";
import type { AuthUser } from "@/lib/shared/schemas";
import { adoptLegacyStorage, setStorageScope } from "@/lib/storageScope";

type AuthState =
  | { status: "loading" }
  | { status: "signed-in"; user: AuthUser }
  | { status: "signed-out" }
  | { status: "error"; message: string };

interface AuthContextValue {
  user: AuthUser | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Pages reachable without signing in. */
const PUBLIC_PATHS = new Set(["/login"]);

/**
 * Resolves the signed-in user before rendering the app. Signed-out visitors are sent to
 * /login. Browser storage is scoped to the user before any child reads it.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isPublic = PUBLIC_PATHS.has(pathname);
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((user) => {
        if (cancelled) return;
        setStorageScope(user.id);
        adoptLegacyStorage();
        setState({ status: "signed-in", user });
        if (isPublic) window.location.replace("/");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          setState({ status: "signed-out" });
          if (!isPublic) window.location.replace("/login");
        } else {
          setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isPublic, attempt]);

  const signOut = useCallback(async () => {
    try {
      await logout();
    } finally {
      window.location.assign("/login");
    }
  }, []);

  const value = useMemo(
    () => ({ user: state.status === "signed-in" ? state.user : null, signOut }),
    [state, signOut],
  );

  let content: ReactNode = null;
  if (isPublic || state.status === "signed-in") content = children;
  else if (state.status === "error") {
    content = (
      <div className="auth-message" role="alert">
        <p>Can&apos;t reach the server: {state.message}</p>
        <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </button>
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{content}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
