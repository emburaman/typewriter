"use client";

import Link from "next/link";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, getDocument, listDocuments, pullFromDrive, saveDocument } from "@/lib/api";
import {
  EMPTY_DOC,
  getCurrentDocId,
  readDraft,
  setCurrentDocId,
  writeDraft,
} from "@/lib/editor/drafts";
import { countWords, createExtensions, toEditorContent } from "@/lib/editor/extensions";
import { normalizeGoogleDocsHtml } from "@/lib/editor/googleImport";
import { countParagraphs, countVisualLines } from "@/lib/editor/stats";
import { AUTOSAVE_INTERVAL_MS, type DocumentRecord, type EditorJson } from "@/lib/shared/schemas";
import { soundForKey } from "@/lib/sound/keySounds";
import { newUuid } from "@/lib/uuid";
import { ConflictDialog } from "./ConflictDialog";
import { LinkDialog, MediaDialog } from "./EditorDialogs";
import { FilesPanel } from "./FilesPanel";
import { Icon } from "./Icon";
import { Logo } from "./Logo";
import { useSettings } from "./SettingsProvider";
import { useSound } from "./SoundProvider";
import { SoundToggle } from "./SoundToggle";
import { ThemeToggle } from "./ThemeToggle";
import { UserMenu } from "./UserMenu";
import { Toolbar } from "./Toolbar";
import { useToast } from "./ToastProvider";

const timeOf = (t: number | string) => new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
/** Server autosave: this long after typing pauses… */
const SERVER_AUTOSAVE_IDLE_MS = 3_000;
/** …but at least this often while typing continues. */
const SERVER_AUTOSAVE_MAX_WAIT_MS = 20_000;
/** How often an open, idle document checks for changes saved on another device. */
const REMOTE_CHECK_INTERVAL_MS = 30_000;
/** While the server is unreachable (or erroring), retry this often instead of per keystroke. */
const SAVE_RETRY_MS = 10_000;

/** manual = Ctrl+S; auto = background; convert = re-encode content pulled from Google Docs. */
type SaveMode = "manual" | "auto" | "convert";

/** What to put in the editor for a server document (Google Docs pulls arrive as HTML). */
const editorContentOf = (doc: DocumentRecord) =>
  doc.contentSource === "html" ? normalizeGoogleDocsHtml(doc.contentHtml) : toEditorContent(doc.contentJson);
type SaveOutcome = "saved" | "conflict" | "failed";

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function TypewriterApp() {
  const { settings } = useSettings();
  const { play } = useSound();
  const toast = useToast();

  // Palette is read lazily by the Ctrl+1…5 shortcuts so settings changes apply instantly.
  const colorsRef = useRef(settings.toolbarColors);
  colorsRef.current = settings.toolbarColors;
  const [linkOpen, setLinkOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const extensions = useMemo(
    () =>
      createExtensions(
        () => colorsRef.current,
        () => setLinkOpen(true),
      ),
    [],
  );

  const [docId, setDocId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ words: 0, paragraphs: 0, lines: 0 });
  const [serverDirty, setServerDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [localSavedAt, setLocalSavedAt] = useState<number | null>(null);
  const [serverSavedAt, setServerSavedAt] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  /** Set when another device saved this document while it had unsaved edits here. */
  const [conflict, setConflict] = useState<{ server: DocumentRecord; dialogOpen: boolean } | null>(null);
  const [offline, setOfflineState] = useState(false);

  /**
   * Change tracking with revision counters instead of content comparison:
   * every edit bumps `revision`; a save records the revision it persisted.
   */
  const revision = useRef(0);
  const serverRevision = useRef(0);
  const localRevision = useRef(0);
  const docIdRef = useRef<string | null>(null);
  /** Folder a brand-new document belongs to; sent on save, but only applied by the server on create. */
  const folderIdRef = useRef<string | null>(null);
  const titleRef = useRef("");
  const savingRef = useRef(false);
  /** Server revision our content is based on (null = not on the server yet). */
  const baseRevisionRef = useRef<number | null>(null);
  /** A save requested while another was running ("manual" wins over "auto"). */
  const pendingSaveRef = useRef<SaveMode | null>(null);
  const conflictRef = useRef(false);
  const autosaveTimer = useRef<number | undefined>(undefined);
  const firstDirtyAt = useRef<number | null>(null);
  const driveWarned = useRef(false);
  const saveErrorWarned = useRef(false);
  /** Mirrors `offline` for callbacks (and makes autosave back off while the server is unreachable). */
  const offlineRef = useRef(false);
  const statsTimer = useRef<number | undefined>(undefined);
  const storageWarned = useRef(false);

  const isServerDirty = () => revision.current !== serverRevision.current;

  /**
   * Server autosave: a few seconds after typing pauses, but at least every 20 s while typing
   * continues. Paused while a conflict with another device is unresolved.
   */
  const scheduleServerSave = useCallback(() => {
    if (conflictRef.current) return;
    if (offlineRef.current) {
      // Back off: one retry every SAVE_RETRY_MS, not one per keystroke.
      if (autosaveTimer.current === undefined) {
        autosaveTimer.current = window.setTimeout(() => {
          autosaveTimer.current = undefined;
          void saveRef.current("auto");
        }, SAVE_RETRY_MS);
      }
      return;
    }
    const now = Date.now();
    firstDirtyAt.current ??= now;
    const delay = Math.min(SERVER_AUTOSAVE_IDLE_MS, Math.max(0, SERVER_AUTOSAVE_MAX_WAIT_MS - (now - firstDirtyAt.current)));
    window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = window.setTimeout(() => {
      autosaveTimer.current = undefined;
      void saveRef.current("auto");
    }, delay);
  }, []);

  const setOffline = useCallback((value: boolean) => {
    offlineRef.current = value;
    setOfflineState(value);
  }, []);

  const markChanged = useCallback(() => {
    revision.current += 1;
    setServerDirty(true);
    scheduleServerSave();
  }, [scheduleServerSave]);

  const computeStats = useCallback((ed: Editor) => {
    setStats({
      words: countWords(ed.getText()),
      paragraphs: countParagraphs(ed.state.doc),
      lines: countVisualLines(ed.view.dom),
    });
  }, []);

  /** Debounced: counting lines measures the layout, so don't do it on every keystroke. */
  const scheduleStats = useCallback(
    (ed: Editor) => {
      window.clearTimeout(statsTimer.current);
      statsTimer.current = window.setTimeout(() => computeStats(ed), 250);
    },
    [computeStats],
  );

  const editor = useEditor({
    extensions,
    content: toEditorContent(EMPTY_DOC),
    immediatelyRender: false,
    editable: false,
    editorProps: {
      attributes: { class: "editor-content", "aria-label": "Document text", spellcheck: "true" },
    },
    onUpdate: ({ editor: ed }) => {
      markChanged();
      setTyping(true);
      scheduleStats(ed);
    },
  });

  /** Writes the current state to localStorage if it changed since the last local save. */
  const flushLocal = useCallback(() => {
    const id = docIdRef.current;
    if (!editor || !id || revision.current === localRevision.current) return;
    const now = Date.now();
    const ok = writeDraft({
      id,
      title: titleRef.current,
      contentJson: editor.getJSON() as EditorJson,
      savedAt: now,
      unsynced: isServerDirty(),
      folderId: folderIdRef.current,
      baseRevision: baseRevisionRef.current,
    });
    if (ok) {
      localRevision.current = revision.current;
      setLocalSavedAt(now);
    } else if (!storageWarned.current) {
      storageWarned.current = true;
      toast("Browser storage is unavailable or full — autosave is paused. Save to the server with Ctrl+S.", "error");
    }
  }, [editor, toast]);

  /** Shows another device's version in the editor (discarding unsaved edits here). */
  const applyServerVersion = useCallback(
    (doc: DocumentRecord) => {
      if (!editor) return;
      const { from } = editor.state.selection;
      editor.commands.setContent(editorContentOf(doc), { emitUpdate: false });
      // Keep the cursor roughly where it was.
      const max = Math.max(1, editor.state.doc.content.size - 1);
      editor.commands.setTextSelection(Math.min(from, max));
      const docTitle = doc.title === "Untitled" ? "" : doc.title;
      titleRef.current = docTitle;
      setTitle(docTitle);
      baseRevisionRef.current = doc.revision;
      revision.current = 0;
      serverRevision.current = 0;
      localRevision.current = -1; // refresh the browser copy too
      firstDirtyAt.current = null;
      window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = undefined;
      setServerDirty(false);
      setServerSavedAt(doc.updatedAt);
      computeStats(editor);
      flushLocal();
      if (doc.contentSource === "html") convertPulledContent();
    },
    // convertPulledContent only goes through refs, so it needs no dependency entry.
    [editor, computeStats, flushLocal],
  );

  const openConflict = useCallback((server: DocumentRecord) => {
    conflictRef.current = true;
    window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = undefined;
    setConflict({ server, dialogOpen: true });
  }, []);

  const closeConflict = useCallback(() => {
    conflictRef.current = false;
    setConflict(null);
  }, []);

  /**
   * Saves to the server. "manual" (Ctrl+S) also uploads to Google Drive right away and reports
   * problems loudly; "auto" (background) refreshes Drive at most every couple of minutes and
   * stays quiet when offline (the browser copy is kept and the next autosave retries).
   */
  const save = useCallback(
    async (mode: SaveMode): Promise<SaveOutcome> => {
      const id = docIdRef.current;
      if (!editor || !id) return "failed";
      if (conflictRef.current) {
        if (mode === "manual") setConflict((c) => (c ? { ...c, dialogOpen: true } : c));
        return "conflict";
      }
      if (savingRef.current) {
        pendingSaveRef.current = pendingSaveRef.current === "manual" || mode === "manual" ? "manual" : mode;
        return "failed";
      }
      if (mode !== "manual" && !isServerDirty()) return "saved";
      window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = undefined;
      savingRef.current = true;
      setSaving(true);
      const rev = revision.current;
      let outcome: SaveOutcome = "failed";
      try {
        const result = await saveDocument(id, {
          title: titleRef.current.trim() || "Untitled",
          folderId: folderIdRef.current,
          contentJson: editor.getJSON() as EditorJson,
          contentHtml: editor.getHTML(),
          wordCount: countWords(editor.getText()),
          baseRevision: baseRevisionRef.current,
          driveSync: mode === "manual" ? "now" : mode === "convert" ? "skip" : "auto",
          sameAsDrive: mode === "convert" ? true : undefined,
        });
        outcome = "saved";
        if (docIdRef.current !== id) return outcome; // user switched documents mid-save
        baseRevisionRef.current = result.document.revision;
        serverRevision.current = rev;
        const clean = revision.current === rev;
        if (clean) firstDirtyAt.current = null;
        setServerDirty(!clean);
        setServerSavedAt(result.document.updatedAt);
        setOffline(false);
        saveErrorWarned.current = false;
        // Keep a synced copy locally as a recovery point.
        localRevision.current = -1;
        flushLocal();

        if (result.drive.status === "failed" && (mode === "manual" || !driveWarned.current)) {
          driveWarned.current = true;
          toast(`Saved to server, but Google Drive sync failed: ${result.drive.message ?? "unknown error"}`, "error");
        } else if (result.drive.status === "synced" && mode === "manual") {
          toast("Saved to server and Google Drive", "success");
        }
        return outcome;
      } catch (err) {
        flushLocal();
        if (err instanceof ApiError && err.status === 409 && err.code === "conflict") {
          const server = (err.details as { document?: DocumentRecord } | undefined)?.document;
          if (server && docIdRef.current === id) openConflict(server);
          outcome = "conflict";
        } else if (err instanceof ApiError && err.isNetworkError) {
          setOffline(true);
          if (mode === "manual") toast("Server unreachable. Your writing is kept in this browser and will be saved when it's back.", "error");
        } else if (mode === "manual" || !saveErrorWarned.current) {
          saveErrorWarned.current = true;
          setOffline(true); // retry with back-off
          toast(`Could not save to server (${errorMessage(err)}). Your draft is kept in this browser.`, "error");
        } else {
          setOffline(true);
        }
        return outcome;
      } finally {
        savingRef.current = false;
        setSaving(false);
        const pending = pendingSaveRef.current;
        pendingSaveRef.current = null;
        if (pending && outcome !== "conflict") void saveRef.current(pending);
        else if (outcome === "failed" && isServerDirty()) scheduleServerSave(); // retry later
      }
    },
    [editor, flushLocal, toast, openConflict, scheduleServerSave, setOffline],
  );

  const saveRef = useRef(save);
  saveRef.current = save;

  /**
   * Content just pulled from Google Docs is HTML; once it's in the editor, store it as editor
   * JSON. `convert` saves don't count as an app-side edit and don't upload back to Drive.
   */
  function convertPulledContent() {
    revision.current += 1;
    setServerDirty(true);
    void saveRef.current("convert");
  }

  /**
   * Loads a document: the server copy, or this browser's unsaved draft when it continues from
   * the server's current revision. A draft based on an older revision (another device saved
   * meanwhile) opens the conflict dialog.
   */
  const loadDocument = useCallback(
    async (id: string, isNew: boolean, newFolderId: string | null = null) => {
      if (!editor) return;
      setLoading(true);
      editor.setEditable(false, false); // false: not a content change (no update event)
      closeConflict();
      window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = undefined;
      firstDirtyAt.current = null;
      driveWarned.current = false;

      let server: DocumentRecord | null = null;
      let unreachable = false;
      if (!isNew) {
        try {
          server = await getDocument(id);
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) server = null;
          else if (err instanceof ApiError && err.isNetworkError) unreachable = true;
          else toast(`Could not load document: ${errorMessage(err)}`, "error");
        }
      }

      const draft = readDraft(id);
      const unsyncedDraft = draft?.unsynced ? draft : null;
      // Drafts written before revisions existed: fall back to comparing timestamps.
      const draftContinuesServer =
        unsyncedDraft !== null &&
        (!server ||
          (unsyncedDraft.baseRevision !== undefined
            ? unsyncedDraft.baseRevision === server.revision
            : unsyncedDraft.savedAt > Date.parse(server.updatedAt)));
      const draftConflicts = Boolean(server && unsyncedDraft && !draftContinuesServer && unsyncedDraft.baseRevision !== undefined);

      let content: EditorJson | string = EMPTY_DOC;
      let docTitle = "";
      let dirty = false;
      let base: number | null = server?.revision ?? null;

      if (unsyncedDraft && (draftContinuesServer || draftConflicts)) {
        content = unsyncedDraft.contentJson;
        docTitle = unsyncedDraft.title;
        dirty = true;
        if (unsyncedDraft.baseRevision !== undefined) base = unsyncedDraft.baseRevision;
      } else if (server) {
        content = server.contentSource === "html" ? normalizeGoogleDocsHtml(server.contentHtml) : server.contentJson;
        docTitle = server.title === "Untitled" ? "" : server.title;
      } else if (draft) {
        content = draft.contentJson;
        docTitle = draft.title;
        dirty = draft.unsynced;
        base = draft.baseRevision ?? null;
      }

      editor.commands.setContent(typeof content === "string" ? content : toEditorContent(content), { emitUpdate: false });
      docIdRef.current = id;
      folderIdRef.current = server?.folderId ?? draft?.folderId ?? newFolderId;
      titleRef.current = docTitle;
      baseRevisionRef.current = base;
      revision.current = 0;
      localRevision.current = 0;
      serverRevision.current = dirty ? -1 : 0;

      setDocId(id);
      setCurrentDocId(id);
      setTitle(docTitle);
      setServerDirty(dirty);
      setOffline(unreachable);
      setServerSavedAt(server?.updatedAt ?? null);
      setLocalSavedAt(draft?.savedAt ?? null);
      computeStats(editor);
      setLoading(false);
      editor.setEditable(true, false);
      editor.commands.focus("end");

      if (typeof content === "string" && !dirty) {
        convertPulledContent(); // pulled from Google Docs: store as editor JSON
      } else if (draftConflicts && server) {
        openConflict(server);
      } else if (unreachable) {
        toast("Server unreachable — working from the browser draft. It will be saved when the server is back.", "error");
      } else if (dirty && server) {
        toast("Restored unsaved changes from this browser.", "info");
        scheduleServerSave();
      } else if (dirty) {
        scheduleServerSave();
      }
    },
    [editor, toast, computeStats, closeConflict, openConflict, scheduleServerSave, setOffline],
  );

  /**
   * Picks up changes saved on another device: when this tab becomes visible again, and every
   * 30 s while it's open. Unchanged here → the new version is shown; changed in both places
   * → conflict dialog.
   */
  const checkForRemoteChanges = useCallback(async () => {
    const id = docIdRef.current;
    if (!editor || !id || loading || savingRef.current || conflictRef.current || document.visibilityState !== "visible") return;
    const base = baseRevisionRef.current;
    if (base === null) return; // not on the server yet
    let server: DocumentRecord;
    try {
      server = await getDocument(id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404 && docIdRef.current === id) {
        baseRevisionRef.current = null;
        toast("This document was deleted on another device. Keep writing to save it again, or open another one.", "info");
      } else if (err instanceof ApiError && err.isNetworkError) {
        setOffline(true);
      }
      return;
    }
    if (offlineRef.current) {
      setOffline(false);
      if (isServerDirty() && server.revision === base) {
        void saveRef.current("auto"); // back online: push what was written meanwhile
        return;
      }
    }
    if (docIdRef.current !== id || savingRef.current || server.revision <= base) return;
    if (isServerDirty()) {
      openConflict(server);
    } else {
      applyServerVersion(server);
      toast("Updated with changes from another device.", "info");
    }
  }, [editor, loading, toast, openConflict, applyServerVersion, setOffline]);

  /* ------------------------- conflict choices ------------------------- */

  const keepBoth = useCallback(async () => {
    if (!editor || !conflict) return;
    const copyTitle = `${titleRef.current.trim() || "Untitled"} (conflict copy)`;
    try {
      await saveDocument(newUuid(), {
        title: copyTitle,
        folderId: folderIdRef.current,
        contentJson: editor.getJSON() as EditorJson,
        contentHtml: editor.getHTML(),
        wordCount: countWords(editor.getText()),
        baseRevision: null,
        driveSync: "auto",
      });
    } catch (err) {
      toast(`Couldn't save your copy (${errorMessage(err)}). Nothing was changed.`, "error");
      return;
    }
    closeConflict();
    applyServerVersion(conflict.server);
    toast(`Your version was saved as “${copyTitle}” (see Files).`, "success");
  }, [editor, conflict, toast, closeConflict, applyServerVersion]);

  const chooseTheirs = useCallback(() => {
    if (!conflict) return;
    closeConflict();
    applyServerVersion(conflict.server);
  }, [conflict, closeConflict, applyServerVersion]);

  const overwriteWithMine = useCallback(() => {
    if (!conflict) return;
    baseRevisionRef.current = conflict.server.revision;
    closeConflict();
    void saveRef.current("manual");
  }, [conflict, closeConflict]);

  // Initial load once the editor exists.
  useEffect(() => {
    if (!editor || docIdRef.current) return;
    const existing = getCurrentDocId();
    if (existing) {
      void loadDocument(existing, false);
      return;
    }
    // First visit on this device: continue with the most recently edited document.
    listDocuments()
      .then((docs) => {
        const latest = [...docs].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
        return loadDocument(latest?.id ?? newUuid(), !latest);
      })
      .catch(() => loadDocument(newUuid(), true));
  }, [editor, loadDocument]);

  // Changes from other devices: check when the tab comes back, and every 30 s while visible.
  useEffect(() => {
    // Coming back to the tab: ask the server to pull Drive edits first, then check this document.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void pullFromDrive()
        .catch((err: unknown) => console.warn("[drive] pull on focus failed:", err))
        .then(() => checkForRemoteChanges());
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const timer = window.setInterval(() => void checkForRemoteChanges(), REMOTE_CHECK_INTERVAL_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.clearInterval(timer);
    };
  }, [checkForRemoteChanges]);

  // Line counts depend on layout: recount when the page width, font or font size changes.
  useEffect(() => {
    if (!editor) return;
    const observer = new ResizeObserver(() => scheduleStats(editor));
    observer.observe(editor.view.dom);
    return () => observer.disconnect();
  }, [editor, scheduleStats, settings.fontFamily, settings.fontSize]);

  // Autosave to browser storage every 5 seconds.
  useEffect(() => {
    const timer = window.setInterval(flushLocal, AUTOSAVE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [flushLocal]);

  // Leaving the page: flush the local draft, and ask the browser to confirm if the
  // server copy is behind. (Browsers show their own generic wording for this dialog.)
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      flushLocal();
      if (isServerDirty()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const onHidden = () => document.visibilityState === "hidden" && flushLocal();
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [flushLocal]);

  // Ctrl/Cmd+S saves to the server from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveRef.current("manual");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Focus mode: chrome fades while typing and returns on mouse movement.
  useEffect(() => {
    if (!typing) return;
    const wake = () => setTyping(false);
    window.addEventListener("mousemove", wake, { once: true });
    return () => window.removeEventListener("mousemove", wake);
  }, [typing]);

  const switchTo = useCallback(
    async (id: string | null, newFolderId: string | null = null) => {
      setDrawerOpen(false);
      if (id !== null && id === docIdRef.current) return;
      // Save first. Offline is fine (the browser draft is kept); a conflict must be resolved first.
      if (isServerDirty() && (await save("auto")) === "conflict") return;
      flushLocal();
      await loadDocument(id ?? newUuid(), id === null, newFolderId);
    },
    [flushLocal, loadDocument, save],
  );

  const onTitleChange = (value: string) => {
    titleRef.current = value;
    setTitle(value);
    markChanged();
  };

  let status: string;
  if (loading) status = "Loading…";
  else if (conflict) status = "Changed on another device";
  else if (saving) status = "Saving…";
  else if (offline && serverDirty)
    status = localSavedAt ? `Offline · saved in this browser ${timeOf(localSavedAt)}` : "Offline · not saved yet";
  else if (serverDirty) status = localSavedAt ? `Editing · browser draft ${timeOf(localSavedAt)}` : "Editing…";
  else if (serverSavedAt) status = `Saved ${timeOf(serverSavedAt)}`;
  else status = "New document";

  return (
    <div className={`app${typing ? " is-typing" : ""}`}>
      <header className="chrome topbar">
        <Link href="/" className="brand" aria-label="Olive Writer">
          <Logo height={20} />
        </Link>
        <nav className="topbar-actions" aria-label="Document actions">
          <button type="button" className="icon-btn" title="Files" aria-label="Files" onClick={() => setDrawerOpen(true)}>
            <Icon name="files" />
          </button>
          <button type="button" className="icon-btn" title="New document" aria-label="New document" onClick={() => void switchTo(null)}>
            <Icon name="plus" />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Save to server (Ctrl+S)"
            aria-label="Save to server"
            disabled={saving || loading}
            onClick={() => void save("manual")}
          >
            <Icon name="save" />
          </button>
          <SoundToggle />
          <ThemeToggle />
          <Link href="/settings" className="icon-btn" title="Settings" aria-label="Settings">
            <Icon name="settings" />
          </Link>
          <UserMenu />
        </nav>
      </header>

      {editor && (
        <div className="chrome toolbar-wrap">
          <Toolbar
            editor={editor}
            colors={settings.toolbarColors}
            onLink={() => setLinkOpen(true)}
            onMedia={() => setMediaOpen(true)}
          />
        </div>
      )}

      <main
        className="page"
        aria-busy={loading}
        // Capture phase so the editor's own key handling can't swallow the event first.
        onKeyDownCapture={(e) => {
          const kind = soundForKey(e.nativeEvent);
          if (kind) play(kind);
        }}
      >
        <input
          className="doc-title-input"
          value={title}
          placeholder="Untitled"
          aria-label="Document title"
          maxLength={255}
          onChange={(e) => onTitleChange(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === "ArrowDown") && editor) {
              e.preventDefault();
              // Move DOM focus synchronously: TipTap's focus() is deferred a frame, and
              // keystrokes typed in that gap would otherwise land in the title.
              editor.view.focus();
              editor.commands.focus("start");
            }
          }}
        />
        <EditorContent editor={editor} className="editor" />
      </main>

      <footer className="chrome statusbar" aria-live="polite">
        <span className={conflict ? "status-conflict" : serverDirty ? "status-dirty" : undefined}>
          {settings.storageProvider === "google_drive" && <Icon name="cloud" size={12} />} {status}
          {conflict && !conflict.dialogOpen && (
            <button type="button" className="status-link" onClick={() => setConflict({ ...conflict, dialogOpen: true })}>
              Resolve
            </button>
          )}
        </span>
        <span>
          {plural(stats.paragraphs, "paragraph")} · <span title="Lines as wrapped on screen">{plural(stats.lines, "line")}</span> ·{" "}
          {plural(stats.words, "word")}
        </span>
      </footer>

      {docId && (
        <FilesPanel
          open={drawerOpen}
          currentId={docId}
          onClose={() => setDrawerOpen(false)}
          onOpenDocument={(id) => void switchTo(id)}
          onNewDocument={(folderId) => void switchTo(null, folderId)}
        />
      )}
      {conflict && (
        <ConflictDialog
          open={conflict.dialogOpen}
          server={conflict.server}
          onKeepBoth={() => void keepBoth()}
          onUseTheirs={chooseTheirs}
          onOverwrite={overwriteWithMine}
          onLater={() => setConflict((c) => (c ? { ...c, dialogOpen: false } : c))}
        />
      )}
      {editor && (
        <>
          <LinkDialog editor={editor} open={linkOpen} onClose={() => setLinkOpen(false)} />
          <MediaDialog editor={editor} open={mediaOpen} onClose={() => setMediaOpen(false)} />
        </>
      )}
    </div>
  );
}
