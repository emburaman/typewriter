"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getSettings, updateSettings as putSettings } from "@/lib/api";
import { DEFAULT_SETTINGS, settingsSchema, type Settings, type SettingsUpdate } from "@/lib/shared/schemas";
import { useGoogleFont } from "@/lib/hooks/useGoogleFont";
import { scopedKey } from "@/lib/storageScope";
import { useAuth } from "./AuthProvider";

/** Mirror of the user's server settings in localStorage, so the theme applies before first paint. */
const settingsKey = () => scopedKey("settings");

interface SettingsContextValue {
  settings: Settings;
  /** True once the server copy has been fetched (or failed to). */
  loaded: boolean;
  /** Optimistically applies the change and persists it; rejects (and reverts) on failure. */
  update: (update: SettingsUpdate) => Promise<void>;
  resolvedTheme: "light" | "dark";
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function readMirror(): Settings {
  try {
    const raw = window.localStorage.getItem(settingsKey());
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = settingsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_SETTINGS;
  } catch (err) {
    console.warn("[settings] could not read local settings mirror:", err);
    return DEFAULT_SETTINGS;
  }
}

function writeMirror(settings: Settings): void {
  try {
    window.localStorage.setItem(settingsKey(), JSON.stringify(settings));
  } catch (err) {
    console.warn("[settings] could not write local settings mirror:", err);
  }
}

function useSystemPrefersDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return dark;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const systemDark = useSystemPrefersDark();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) return; // sign-in page: no account, keep defaults
    setSettings(readMirror());
    let cancelled = false;
    getSettings()
      .then((remote) => {
        if (cancelled) return;
        setSettings(remote);
        writeMirror(remote);
      })
      .catch((err: unknown) => console.error("[settings] could not load settings from server:", err))
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const update = useCallback(async (change: SettingsUpdate) => {
    const previous = settingsRef.current;
    const optimistic = { ...previous, ...change };
    setSettings(optimistic);
    writeMirror(optimistic);
    try {
      const saved = await putSettings(change);
      setSettings(saved);
      writeMirror(saved);
    } catch (err) {
      setSettings(previous);
      writeMirror(previous);
      throw err;
    }
  }, []);

  const resolvedTheme: "light" | "dark" =
    settings.theme === "system" ? (systemDark ? "dark" : "light") : settings.theme;

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--editor-font", `"${settings.fontFamily}"`);
    root.style.setProperty("--editor-size", `${settings.fontSize}px`);
  }, [settings.fontFamily, settings.fontSize]);

  useGoogleFont(settings.fontFamily);

  const value = useMemo(() => ({ settings, loaded, update, resolvedTheme }), [settings, loaded, update, resolvedTheme]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside <SettingsProvider>");
  return ctx;
}
