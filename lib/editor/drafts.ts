import type { EditorJson } from "@/lib/shared/schemas";

/**
 * Browser-side draft storage ("browser memory" autosave). Everything is namespaced under
 * `typewriter:` in localStorage. Storage can be unavailable (private mode) or full; those
 * failures are reported to the caller rather than thrown into the editor.
 */
const PREFIX = "typewriter:draft:";
const CURRENT_KEY = "typewriter:current";

export interface LocalDraft {
  id: string;
  title: string;
  contentJson: EditorJson;
  /** ms epoch of this local save */
  savedAt: number;
  /** true when the draft has changes the server does not have yet */
  unsynced: boolean;
  /** Folder chosen when a new document was created there (applied on its first server save). */
  folderId?: string | null;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch (err) {
    // Accessing localStorage throws when the browser blocks storage entirely.
    console.warn("[drafts] localStorage unavailable:", err);
    return null;
  }
}

function isDraft(value: unknown): value is LocalDraft {
  if (typeof value !== "object" || value === null) return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d.id === "string" &&
    typeof d.title === "string" &&
    typeof d.savedAt === "number" &&
    typeof d.unsynced === "boolean" &&
    (d.folderId === undefined || d.folderId === null || typeof d.folderId === "string") &&
    typeof d.contentJson === "object" &&
    d.contentJson !== null &&
    (d.contentJson as { type?: unknown }).type === "doc"
  );
}

function parseDraft(raw: string | null): LocalDraft | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return isDraft(value) ? value : null;
  } catch (err) {
    console.warn("[drafts] ignoring corrupt draft:", err);
    return null;
  }
}

export function readDraft(id: string): LocalDraft | null {
  return parseDraft(storage()?.getItem(PREFIX + id) ?? null);
}

/** Returns false if the draft could not be written (storage blocked or quota exceeded). */
export function writeDraft(draft: LocalDraft): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(PREFIX + draft.id, JSON.stringify(draft));
    return true;
  } catch (err) {
    console.error("[drafts] could not save draft locally:", err);
    return false;
  }
}

export function removeDraft(id: string): void {
  storage()?.removeItem(PREFIX + id);
}

/** Drafts that never reached the server (or have newer local edits). */
export function listUnsyncedDrafts(): LocalDraft[] {
  const s = storage();
  if (!s) return [];
  const drafts: LocalDraft[] = [];
  for (let i = 0; i < s.length; i++) {
    const key = s.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    const draft = parseDraft(s.getItem(key));
    if (draft?.unsynced) drafts.push(draft);
  }
  return drafts.sort((a, b) => b.savedAt - a.savedAt);
}

export function getCurrentDocId(): string | null {
  return storage()?.getItem(CURRENT_KEY) ?? null;
}

export function setCurrentDocId(id: string): void {
  try {
    storage()?.setItem(CURRENT_KEY, id);
  } catch (err) {
    console.warn("[drafts] could not remember current document:", err);
  }
}

export const EMPTY_DOC: EditorJson = { type: "doc", content: [{ type: "paragraph" }] };
