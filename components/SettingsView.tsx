"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { disconnectGoogle, getFonts, getGoogleAuthUrl, getGoogleStatus, type FontCatalog } from "@/lib/api";
import { useGoogleFont } from "@/lib/hooks/useGoogleFont";
import {
  CURATED_FONTS,
  DEFAULT_TOOLBAR_COLORS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  MAX_TOOLBAR_COLORS,
  settingsSchema,
  type GoogleStatus,
  type Settings,
  type SettingsUpdate,
} from "@/lib/shared/schemas";
import { Icon } from "./Icon";
import { Logo } from "./Logo";
import { useSettings } from "./SettingsProvider";
import { useSound } from "./SoundProvider";
import { useToast } from "./ToastProvider";

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function SettingsView() {
  const { settings, update, loaded } = useSettings();
  const toast = useToast();

  const save = async (change: SettingsUpdate, okMessage = "Settings saved") => {
    try {
      await update(change);
      toast(okMessage, "success");
      return true;
    } catch (err) {
      toast(`Could not save settings: ${errorMessage(err)}`, "error");
      return false;
    }
  };

  return (
    <div className="settings-page">
      <header className="settings-header">
        <Link href="/" className="btn btn-ghost">
          <Icon name="arrowLeft" size={16} /> Back to writing
        </Link>
        <Logo height={18} />
        <h1>Settings</h1>
      </header>
      {!loaded && <p className="muted">Loading settings…</p>}
      <AppearanceSection settings={settings} save={save} />
      <ColorsSection settings={settings} save={save} />
      <StorageSection settings={settings} save={save} />
      <ShortcutsSection />
    </div>
  );
}

type SaveFn = (change: SettingsUpdate, okMessage?: string) => Promise<boolean>;

/* ---------------------------------------------------------------- */

function AppearanceSection({ settings, save }: { settings: Settings; save: SaveFn }) {
  const fontListId = useId();
  const sound = useSound();
  const [catalog, setCatalog] = useState<FontCatalog>({ source: "curated", families: [...CURATED_FONTS] });
  const [fontDraft, setFontDraft] = useState(settings.fontFamily);
  const [size, setSize] = useState(settings.fontSize);

  useEffect(() => setFontDraft(settings.fontFamily), [settings.fontFamily]);
  useEffect(() => setSize(settings.fontSize), [settings.fontSize]);

  useEffect(() => {
    getFonts()
      .then(setCatalog)
      .catch((err: unknown) => console.warn("[settings] font catalog unavailable, using curated list:", err));
  }, []);

  const fontValid = settingsSchema.shape.fontFamily.safeParse(fontDraft).success;
  // Live preview of the font being considered, in its own <link> so the editor font is untouched.
  useGoogleFont(fontValid ? fontDraft.trim() : null, "tw-font-preview");

  const applyFont = () => {
    const family = fontDraft.trim();
    if (!fontValid || family === settings.fontFamily) return;
    void save({ fontFamily: family }, `Font set to ${family}`);
  };

  return (
    <section className="card" aria-labelledby="appearance-h">
      <h2 id="appearance-h">Appearance</h2>

      <fieldset className="field">
        <legend>Theme</legend>
        <div className="segmented" role="radiogroup">
          {(["light", "dark", "system"] as const).map((t) => (
            <label key={t} className={settings.theme === t ? "active" : undefined}>
              <input
                type="radio"
                name="theme"
                value={t}
                checked={settings.theme === t}
                onChange={() => void save({ theme: t })}
              />
              <Icon name={t === "light" ? "sun" : t === "dark" ? "moon" : "monitor"} size={16} />
              {t[0]!.toUpperCase() + t.slice(1)}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="field">
        <label className="radio">
          <input type="checkbox" checked={sound.enabled} onChange={(e) => sound.setEnabled(e.target.checked)} />
          Typewriter sound on every keystroke
        </label>
        <p className="hint">Remembered in this browser (cookie). Also toggled with the speaker icon in the editor's header.</p>
      </div>

      <div className="field">
        <label htmlFor="font-family">Font face (Google Fonts)</label>
        <div className="row">
          <input
            id="font-family"
            className="input"
            list={fontListId}
            value={fontDraft}
            aria-invalid={!fontValid}
            onChange={(e) => setFontDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyFont()}
          />
          <button type="button" className="btn" disabled={!fontValid || fontDraft.trim() === settings.fontFamily} onClick={applyFont}>
            Apply
          </button>
        </div>
        <datalist id={fontListId}>
          {catalog.families.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        <p className="hint">
          {catalog.source === "google"
            ? `${catalog.families.length} Google Fonts available — start typing to search.`
            : "Pick a suggestion or type the exact name of any Google Font (e.g. “Roboto Mono”)."}
        </p>
        <p className="font-preview" style={{ fontFamily: fontValid ? `"${fontDraft.trim()}", monospace` : undefined }}>
          The quick brown fox jumps over the lazy dog. <strong>Bold</strong> <em>italic</em>
        </p>
      </div>

      <div className="field">
        <label htmlFor="font-size">
          Font size <span className="muted">{size}px</span>
        </label>
        <input
          id="font-size"
          type="range"
          min={FONT_SIZE_MIN}
          max={FONT_SIZE_MAX}
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
          onPointerUp={() => size !== settings.fontSize && void save({ fontSize: size })}
          onKeyUp={() => size !== settings.fontSize && void save({ fontSize: size })}
        />
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- */

function ColorsSection({ settings, save }: { settings: Settings; save: SaveFn }) {
  const [colors, setColors] = useState(settings.toolbarColors);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => setColors(settings.toolbarColors), [settings.toolbarColors]);

  /** Color pickers fire continuously while dragging, so persist on a short debounce. */
  const commit = (next: string[], immediate = false) => {
    setColors(next);
    window.clearTimeout(timer.current);
    const run = () => void save({ toolbarColors: next }, "Toolbar colors saved");
    if (immediate) run();
    else timer.current = window.setTimeout(run, 500);
  };

  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= colors.length) return;
    const next = [...colors];
    [next[i], next[j]] = [next[j]!, next[i]!];
    commit(next, true);
  };

  return (
    <section className="card" aria-labelledby="colors-h">
      <h2 id="colors-h">Toolbar colors</h2>
      <p className="hint">
        Up to {MAX_TOOLBAR_COLORS} colors. Position <em>n</em> is applied with <kbd>Ctrl</kbd>+<kbd>n</kbd> (or{" "}
        <kbd>Alt</kbd>+<kbd>n</kbd>); <kbd>Ctrl</kbd>+<kbd>0</kbd> resets to the default text color.
      </p>
      <ol className="color-list">
        {colors.map((c, i) => (
          <li key={i} className="color-row">
            <span className="color-index">
              <kbd>{i + 1}</kbd>
            </span>
            <input
              type="color"
              value={c}
              aria-label={`Color ${i + 1}`}
              onChange={(e) => commit(colors.map((x, k) => (k === i ? e.target.value : x)))}
            />
            <code>{c}</code>
            <span className="color-actions">
              <button type="button" className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                <Icon name="chevronUp" size={16} />
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label="Move down"
                disabled={i === colors.length - 1}
                onClick={() => move(i, 1)}
              >
                <Icon name="chevronDown" size={16} />
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remove color ${i + 1}`}
                disabled={colors.length <= 1}
                onClick={() => commit(colors.filter((_, k) => k !== i), true)}
              >
                <Icon name="trash" size={16} />
              </button>
            </span>
          </li>
        ))}
      </ol>
      <div className="row">
        <button
          type="button"
          className="btn"
          disabled={colors.length >= MAX_TOOLBAR_COLORS}
          onClick={() => commit([...colors, "#555555"], true)}
        >
          <Icon name="plus" size={16} /> Add color
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => commit([...DEFAULT_TOOLBAR_COLORS], true)}>
          Reset to defaults
        </button>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- */

function StorageSection({ settings, save }: { settings: Settings; save: SaveFn }) {
  const toast = useToast();
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [folder, setFolder] = useState(settings.driveFolderName);
  useEffect(() => setFolder(settings.driveFolderName), [settings.driveFolderName]);

  const refresh = () =>
    getGoogleStatus()
      .then((s) => {
        setStatus(s);
        setStatusError(null);
      })
      .catch((err: unknown) => setStatusError(errorMessage(err)));

  useEffect(() => {
    void refresh();
    // Outcome of the OAuth round-trip is passed back as ?google=…
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("google");
    if (outcome) {
      if (outcome === "connected") toast("Google Drive connected", "success");
      else toast(`Google Drive was not connected: ${params.get("message") ?? outcome}`, "error");
      window.history.replaceState(null, "", window.location.pathname);
    }
    // Runs once on mount: `toast` is stable and refresh only reads module functions.
  }, []);

  const connect = async () => {
    setBusy(true);
    try {
      const { url } = await getGoogleAuthUrl();
      window.location.assign(url);
    } catch (err) {
      toast(`Could not start Google sign-in: ${errorMessage(err)}`, "error");
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect Google Drive? Files already in Drive stay there.")) return;
    setBusy(true);
    try {
      await disconnectGoogle();
      if (settings.storageProvider === "google_drive") await save({ storageProvider: "server" }, "Storage set to server only");
      toast("Google Drive disconnected", "success");
      await refresh();
    } catch (err) {
      toast(`Could not disconnect: ${errorMessage(err)}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const connected = Boolean(status?.connected);
  const folderValid = folder.trim().length > 0 && folder.trim().length <= 255;

  return (
    <section className="card" aria-labelledby="storage-h">
      <h2 id="storage-h">Storage</h2>
      <p className="hint">
        Your writing is always auto-saved in this browser every 5 seconds. Saving (<kbd>Ctrl</kbd>+<kbd>S</kbd>) stores it
        on the server, and optionally in Google Drive.
      </p>

      <fieldset className="field">
        <legend>Save documents to</legend>
        <label className="radio">
          <input
            type="radio"
            name="storage"
            checked={settings.storageProvider === "server"}
            onChange={() => void save({ storageProvider: "server" })}
          />
          Server only
        </label>
        <label className="radio">
          <input
            type="radio"
            name="storage"
            disabled={!connected}
            checked={settings.storageProvider === "google_drive"}
            onChange={() => void save({ storageProvider: "google_drive" })}
          />
          Server + Google Drive {!connected && <span className="muted">(connect Google Drive first)</span>}
        </label>
      </fieldset>

      <div className="drive-card">
        <div className="drive-card-title">
          <Icon name="cloud" /> Google Drive
        </div>
        {statusError && <p className="error-text">Could not check connection: {statusError}</p>}
        {status && !status.configured && (
          <p className="hint">
            Google Drive is not configured on this server. Set <code>GOOGLE_CLIENT_ID</code>,{" "}
            <code>GOOGLE_CLIENT_SECRET</code> and <code>TOKEN_ENCRYPTION_KEY</code> in the environment and restart. See the
            README for step-by-step setup.
          </p>
        )}
        {status?.configured && !connected && (
          <>
            <p className="hint">
              Connect to save copies of your documents as Google Docs. The app can only access files it creates. On
              Google&apos;s screen, make sure the box for Google Drive access is <strong>ticked</strong>.
            </p>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void connect()}>
              Connect Google Drive
            </button>
          </>
        )}
        {connected && (
          <>
            <p>
              Connected as <strong>{status?.accountEmail ?? "unknown account"}</strong>
            </p>
            {status && !status.driveAccess && (
              <div className="warning-box" role="alert">
                <p>
                  Google Drive access wasn&apos;t granted, so documents can&apos;t be uploaded. Reconnect and tick the
                  box that lets the app see and edit the Drive files it creates.
                </p>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void connect()}>
                  Reconnect Google Drive
                </button>
              </div>
            )}
            <div className="field">
              <label htmlFor="drive-folder">Drive folder</label>
              <div className="row">
                <input
                  id="drive-folder"
                  className="input"
                  value={folder}
                  maxLength={255}
                  aria-invalid={!folderValid}
                  onChange={(e) => setFolder(e.target.value)}
                />
                <button
                  type="button"
                  className="btn"
                  disabled={!folderValid || folder.trim() === settings.driveFolderName}
                  onClick={() => void save({ driveFolderName: folder.trim() }, "Drive folder updated")}
                >
                  Save
                </button>
              </div>
              <p className="hint">Created automatically on the next save if it does not exist.</p>
            </div>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void disconnect()}>
              Disconnect
            </button>
          </>
        )}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- */

const SHORTCUTS: [string, string][] = [
  ["Ctrl+B / Ctrl+I / Ctrl+U", "Bold / italic / underline"],
  ["Ctrl+E or `code`", "Inline code"],
  ["Ctrl+K", "Insert or edit a link (or type [text](https://…))"],
  ["# … ###### then space", "Heading 1–6 (also Ctrl+Alt+1…6; Ctrl+Alt+0 for paragraph)"],
  ["> then space", "Quote (also Ctrl+Shift+B)"],
  ["--- ", "Horizontal line"],
  ["``` then space (or ```js then space)", "Code block (also Ctrl+Alt+C)"],
  ["Ctrl+Alt+F", "Insert a footnote and jump to its note"],
  ["![alt](https://…)", "Insert an image from a URL"],
  ["Ctrl+click a link", "Open it in a new tab"],
  ["Ctrl+1 … Ctrl+5", "Apply toolbar color 1–5 (press again to remove). Alt+1…5 also works."],
  ["Ctrl+0", "Default text color"],
  ["1. then space", "Start a numbered list (any number sets the start)"],
  ["- then space", "Start a bulleted list"],
  ["Tab (right after the bullet/number)", "Nest the list item one level"],
  ["Shift+Tab", "Un-nest the list item"],
  ["Enter on an empty item / Backspace at its start", "Leave the list"],
  ["Ctrl+S", "Save to server (and Google Drive if enabled)"],
  ["Ctrl+Z / Ctrl+Shift+Z", "Undo / redo"],
  ["Esc", "Leave the editor (move keyboard focus out)"],
];

function ShortcutsSection() {
  return (
    <section className="card" aria-labelledby="shortcuts-h">
      <h2 id="shortcuts-h">Keyboard shortcuts</h2>
      <p className="hint">On macOS use ⌘ instead of Ctrl.</p>
      <table className="shortcuts">
        <tbody>
          {SHORTCUTS.map(([keys, action]) => (
            <tr key={keys}>
              <th scope="row">{keys}</th>
              <td>{action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
