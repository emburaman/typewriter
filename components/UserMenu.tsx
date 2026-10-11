"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { AuthUser } from "@/lib/shared/schemas";
import { useAuth } from "./AuthProvider";

export function Avatar({ user, size = 28 }: { user: AuthUser; size?: number }) {
  const initial = (user.name ?? user.email).trim().charAt(0).toUpperCase();
  return (
    <span className="avatar" style={{ width: size, height: size }} aria-hidden="true">
      {user.avatarUrl ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" /> : initial}
    </span>
  );
}

/** Header account button: who is signed in, Settings, Sign out. */
export function UserMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof PointerEvent && (e.target as HTMLElement).closest(".user-menu")) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  if (!user) return null;
  return (
    <div className="user-menu">
      <button
        type="button"
        className="icon-btn"
        aria-label={`Account: ${user.email}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar user={user} size={24} />
      </button>
      {open && (
        <ul className="row-menu" role="menu">
          <li role="none" className="user-menu-identity">
            <strong>{user.name ?? user.email}</strong>
            <span className="muted">{user.email}</span>
          </li>
          <li role="none">
            <Link role="menuitem" href="/settings" className="menu-link" onClick={() => setOpen(false)}>
              Settings
            </Link>
          </li>
          <li role="none">
            <button type="button" role="menuitem" onClick={() => void signOut()}>
              Sign out
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
