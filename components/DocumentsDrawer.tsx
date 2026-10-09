"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, deleteDocument, listDocuments } from "@/lib/api";
import { listUnsyncedDrafts, removeDraft, type LocalDraft } from "@/lib/editor/drafts";
import type { DocumentSummary } from "@/lib/shared/schemas";
import { Icon } from "./Icon";
import { useToast } from "./ToastProvider";

interface DocumentsDrawerProps {
  open: boolean;
  currentId: string;
  onClose: () => void;
  onOpenDocument: (id: string) => void;
  onNewDocument: () => void;
}

const formatDate = (iso: string | number) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function DocumentsDrawer({ open, currentId, onClose, onOpenDocument, onNewDocument }: DocumentsDrawerProps) {
  const toast = useToast();
  const [docs, setDocs] = useState<DocumentSummary[] | null>(null);
  const [drafts, setDrafts] = useState<LocalDraft[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const server = await listDocuments();
      setDocs(server);
      const serverIds = new Set(server.map((d) => d.id));
      // Browser-only drafts: never saved to the server.
      setDrafts(listUnsyncedDrafts().filter((d) => !serverIds.has(d.id)));
    } catch (err) {
      setDocs([]);
      setDrafts(listUnsyncedDrafts());
      setError(err instanceof ApiError && err.isNetworkError ? "Server unreachable — showing browser drafts only." : String(err instanceof Error ? err.message : err));
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const remove = async (doc: DocumentSummary) => {
    if (!window.confirm(`Delete “${doc.title || "Untitled"}” from the server? A Google Drive copy is not deleted.`)) return;
    try {
      await deleteDocument(doc.id);
      removeDraft(doc.id);
      toast("Document deleted", "success");
      if (doc.id === currentId) onNewDocument();
      await refresh();
    } catch (err) {
      toast(`Could not delete: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  };

  const discardDraft = (draft: LocalDraft) => {
    if (!window.confirm(`Discard the browser draft “${draft.title || "Untitled"}”? This cannot be undone.`)) return;
    removeDraft(draft.id);
    if (draft.id === currentId) onNewDocument();
    void refresh();
  };

  if (!open) return null;

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Documents" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-header">
          <h2>Documents</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </header>
        <button type="button" className="btn btn-primary btn-block" onClick={onNewDocument}>
          <Icon name="plus" size={16} /> New document
        </button>

        {error && <p className="muted small">{error}</p>}

        {drafts.length > 0 && (
          <section>
            <h3 className="drawer-section-title">Browser drafts (not on server)</h3>
            <ul className="doc-list">
              {drafts.map((d) => (
                <li key={d.id} className={d.id === currentId ? "current" : undefined}>
                  <button type="button" className="doc-open" onClick={() => onOpenDocument(d.id)}>
                    <span className="doc-title">{d.title || "Untitled"}</span>
                    <span className="doc-meta">Draft · {formatDate(d.savedAt)}</span>
                  </button>
                  <button type="button" className="icon-btn" aria-label="Discard draft" onClick={() => discardDraft(d)}>
                    <Icon name="trash" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3 className="drawer-section-title">Saved on server</h3>
          {docs === null ? (
            <p className="muted small">Loading…</p>
          ) : docs.length === 0 ? (
            <p className="muted small">Nothing saved yet. Press Ctrl+S to save.</p>
          ) : (
            <ul className="doc-list">
              {docs.map((d) => (
                <li key={d.id} className={d.id === currentId ? "current" : undefined}>
                  <button type="button" className="doc-open" onClick={() => onOpenDocument(d.id)}>
                    <span className="doc-title">{d.title || "Untitled"}</span>
                    <span className="doc-meta">
                      {d.wordCount} words · {formatDate(d.updatedAt)}
                      {d.driveSyncedAt && (
                        <span title={`Synced to Google Drive ${formatDate(d.driveSyncedAt)}`}>
                          {" "}· <Icon name="cloud" size={12} />
                        </span>
                      )}
                    </span>
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Delete ${d.title || "Untitled"}`} onClick={() => void remove(d)}>
                    <Icon name="trash" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}
