"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { THEMES, type Settings } from "@/lib/shared/schemas";
import { useAuth } from "./AuthProvider";
import { Icon } from "./Icon";
import { useSettings } from "./SettingsProvider";
import { useSound } from "./SoundProvider";
import { useToast } from "./ToastProvider";
import { Avatar } from "./UserMenu";

const THEME_LABEL: Record<Settings["theme"], string> = { light: "Light", dark: "Dark", system: "System" };

interface Props {
  onFiles: () => void;
  onNew: () => void;
  onSave: () => void;
  saveDisabled: boolean;
}

/** Phone-width header: every topbar action, collapsed behind one hamburger button. */
export function HeaderMenu({ onFiles, onNew, onSave, saveDisabled }: Props) {
  const { user, signOut } = useAuth();
  const { enabled: soundOn, setEnabled: setSound } = useSound();
  const { settings, update } = useSettings();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const nextTheme = THEMES[(THEMES.indexOf(settings.theme) + 1) % THEMES.length] ?? "system";

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof PointerEvent && (e.target as HTMLElement).closest(".header-menu")) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  /** Runs a menu action and closes the menu. */
  const pick = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div className="header-menu">
      <button
        type="button"
        className="icon-btn"
        aria-label="Menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name={open ? "x" : "menu"} />
      </button>
      {open && (
        <ul className="row-menu" role="menu">
          {user && (
            <li role="none" className="user-menu-identity header-menu-identity">
              <Avatar user={user} size={28} />
              <span>
                <strong>{user.name ?? user.email}</strong>
                <span className="muted">{user.email}</span>
              </span>
            </li>
          )}
          <li role="none">
            <button type="button" role="menuitem" onClick={pick(onFiles)}>
              <Icon name="files" /> Files
            </button>
          </li>
          <li role="none">
            <button type="button" role="menuitem" onClick={pick(onNew)}>
              <Icon name="plus" /> New document
            </button>
          </li>
          <li role="none">
            <button type="button" role="menuitem" disabled={saveDisabled} onClick={pick(onSave)}>
              <Icon name="save" /> Save to server
            </button>
          </li>
          <li role="none">
            <button type="button" role="menuitemcheckbox" aria-checked={soundOn} onClick={pick(() => setSound(!soundOn))}>
              <Icon name={soundOn ? "volume" : "volumeOff"} /> Typewriter sound: {soundOn ? "on" : "off"}
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                // Stays open so the theme can be cycled while watching it change.
                update({ theme: nextTheme }).catch((err: unknown) =>
                  toast(`Could not save theme: ${err instanceof Error ? err.message : String(err)}`, "error"),
                );
              }}
            >
              <Icon name={settings.theme === "light" ? "sun" : settings.theme === "dark" ? "moon" : "monitor"} /> Theme:{" "}
              {THEME_LABEL[settings.theme]}
            </button>
          </li>
          <li role="none">
            <Link role="menuitem" href="/settings" className="menu-link" onClick={() => setOpen(false)}>
              <Icon name="settings" /> Settings
            </Link>
          </li>
          {user && (
            <li role="none">
              <button type="button" role="menuitem" onClick={pick(() => void signOut())}>
                <Icon name="logOut" /> Sign out
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
