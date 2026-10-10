"use client";

import Link from "next/link";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, getDocument, saveDocument } from "@/lib/api";
import {
  EMPTY_DOC,
  getCurrentDocId,
  readDraft,
  setCurrentDocId,
  writeDraft,
} from "@/lib/editor/drafts";
import { countWords, createExtensions, toEditorContent } from "@/lib/editor/extensions";
import { countParagraphs, countVisualLines } from "@/lib/editor/stats";
import { AUTOSAVE_INTERVAL_MS, type DocumentRecord, type EditorJson } from "@/lib/shared/schemas";
import { soundForKey } from "@/lib/sound/keySounds";
import { newUuid } from "@/lib/uuid";
import { LinkDialog, MediaDialog } from "./EditorDialogs";
import { FilesPanel } from "./FilesPanel";
import { Icon } from "./Icon";
import { Logo } from "./Logo";
import { useSettings } from "./SettingsProvider";
import { useSound } from "./SoundProvider";
import { SoundToggle } from "./SoundToggle";
import { ThemeToggle } from "./ThemeToggle";
import { Toolbar } from "./Toolbar";
import { useToast } from "./ToastProvider";

const timeOf = (t: number | string) => new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
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
  const statsTimer = useRef<number | undefined>(undefined);
  const storageWarned = useRef(false);

  const isServerDirty = () => revision.current !== serverRevision.current;

  const markChanged = useCallback(() => {
    revision.current += 1;
    setServerDirty(true);
  }, []);

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
    });
    if (ok) {
      localRevision.current = revision.current;
      setLocalSavedAt(now);
    } else if (!storageWarned.current) {
      storageWarned.current = true;
      toast("Browser storage is unavailable or full — autosave is paused. Save to the server with Ctrl+S.", "error");
    }
  }, [editor, toast]);

  /** Saves to the server (and Google Drive when enabled). Resolves to true on success. */
  const save = useCallback(async (): Promise<boolean> => {
    const id = docIdRef.current;
    if (!editor || !id || savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    const rev = revision.current;
    try {
      const result = await saveDocument(id, {
        title: titleRef.current.trim() || "Untitled",
        folderId: folderIdRef.current,
        contentJson: editor.getJSON() as EditorJson,
        contentHtml: editor.getHTML(),
        wordCount: countWords(editor.getText()),
      });
      if (docIdRef.current !== id) return true; // user switched documents mid-save
      serverRevision.current = rev;
      const clean = revision.current === rev;
      setServerDirty(!clean);
      setServerSavedAt(result.document.updatedAt);
      // Keep a synced copy locally as a recovery point.
      localRevision.current = -1;
      flushLocal();

      if (result.drive.status === "failed") {
        toast(`Saved to server, but Google Drive sync failed: ${result.drive.message ?? "unknown error"}`, "error");
      } else if (result.drive.status === "synced") {
        toast("Saved to server and Google Drive", "success");
      }
      return true;
    } catch (err) {
      flushLocal();
      const reason = err instanceof ApiError && err.isNetworkError ? "server unreachable" : errorMessage(err);
      toast(`Could not save to server (${reason}). Your draft is kept in this browser.`, "error");
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [editor, flushLocal, toast]);

  const saveRef = useRef(save);
  saveRef.current = save;

  /** Loads a document: the server copy, or a newer unsynced browser draft if one exists. */
  const loadDocument = useCallback(
    async (id: string, isNew: boolean, newFolderId: string | null = null) => {
      if (!editor) return;
      setLoading(true);
      editor.setEditable(false);

      let server: DocumentRecord | null = null;
      let offline = false;
      if (!isNew) {
        try {
          server = await getDocument(id);
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) server = null;
          else if (err instanceof ApiError && err.isNetworkError) offline = true;
          else toast(`Could not load document: ${errorMessage(err)}`, "error");
        }
      }

      const draft = readDraft(id);
      const draftIsNewer = Boolean(draft?.unsynced && (!server || draft.savedAt > Date.parse(server.updatedAt)));
      let content: EditorJson = EMPTY_DOC;
      let docTitle = "";
      let dirty = false;

      if (draft && draftIsNewer) {
        content = draft.contentJson;
        docTitle = draft.title;
        dirty = true;
      } else if (server) {
        content = server.contentJson;
        docTitle = server.title === "Untitled" ? "" : server.title;
      } else if (draft) {
        content = draft.contentJson;
        docTitle = draft.title;
        dirty = draft.unsynced;
      }

      editor.commands.setContent(toEditorContent(content), { emitUpdate: false });
      docIdRef.current = id;
      folderIdRef.current = server?.folderId ?? draft?.folderId ?? newFolderId;
      titleRef.current = docTitle;
      revision.current = 0;
      localRevision.current = 0;
      serverRevision.current = dirty ? -1 : 0;

      setDocId(id);
      setCurrentDocId(id);
      setTitle(docTitle);
      setServerDirty(dirty);
      setServerSavedAt(server?.updatedAt ?? null);
      setLocalSavedAt(draft?.savedAt ?? null);
      computeStats(editor);
      setLoading(false);
      editor.setEditable(true);
      editor.commands.focus("end");

      if (offline) {
        toast("Server unreachable — working from the browser draft. Autosave continues locally.", "error");
      } else if (draft && draftIsNewer && server) {
        toast("Restored newer unsaved changes from this browser.", "info", {
          label: "Save to server",
          onClick: () => void saveRef.current(),
        });
      }
    },
    [editor, toast, computeStats],
  );

  // Initial load once the editor exists.
  useEffect(() => {
    if (!editor || docIdRef.current) return;
    const existing = getCurrentDocId();
    void loadDocument(existing ?? newUuid(), !existing);
  }, [editor, loadDocument]);

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
        void saveRef.current();
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
      if (isServerDirty()) {
        const wantsSave = window.confirm(
          "Save your changes to the server before switching?\n\nOK — save now\nCancel — keep them as a browser draft",
        );
        if (wantsSave && !(await save())) return;
      }
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
  else if (saving) status = "Saving…";
  else if (serverDirty) status = localSavedAt ? `Unsaved · browser draft ${timeOf(localSavedAt)}` : "Unsaved changes";
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
            onClick={() => void save()}
          >
            <Icon name="save" />
          </button>
          <SoundToggle />
          <ThemeToggle />
          <Link href="/settings" className="icon-btn" title="Settings" aria-label="Settings">
            <Icon name="settings" />
          </Link>
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
        <span className={serverDirty ? "status-dirty" : undefined}>
          {settings.storageProvider === "google_drive" && <Icon name="cloud" size={12} />} {status}
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
      {editor && (
        <>
          <LinkDialog editor={editor} open={linkOpen} onClose={() => setLinkOpen(false)} />
          <MediaDialog editor={editor} open={mediaOpen} onClose={() => setMediaOpen(false)} />
        </>
      )}
    </div>
  );
}
