"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  ApiError,
  createFolder,
  deleteDocument,
  deleteFolder,
  listDocuments,
  listFolders,
  moveDocument,
  updateFolder,
} from "@/lib/api";
import { listUnsyncedDrafts, removeDraft, type LocalDraft } from "@/lib/editor/drafts";
import { ancestorIds, canDrop, childrenOf, descendantIds, folderOptions, type DragItem } from "@/lib/files/tree";
import type { DocumentSummary, Folder } from "@/lib/shared/schemas";
import { Icon } from "./Icon";
import { Modal } from "./Modal";
import { useToast } from "./ToastProvider";

interface FilesPanelProps {
  open: boolean;
  currentId: string;
  onClose: () => void;
  onOpenDocument: (id: string) => void;
  /** Starts a new document, optionally inside a folder. */
  onNewDocument: (folderId: string | null) => void;
}

const EXPANDED_KEY = "typewriter:expanded-folders";
const DRAG_MIME = "application/x-olive-writer";

const formatDate = (iso: string | number) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

function readExpanded(): Set<string> {
  try {
    const raw = window.localStorage.getItem(EXPANDED_KEY);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : []);
  } catch (err) {
    console.warn("[files] could not read expanded folders:", err);
    return new Set();
  }
}

function writeExpanded(ids: Set<string>): void {
  try {
    window.localStorage.setItem(EXPANDED_KEY, JSON.stringify([...ids]));
  } catch (err) {
    console.warn("[files] could not remember expanded folders:", err);
  }
}

type MoveTarget = DragItem & { name: string };

/**
 * The file structure panel: a tree of folders and documents saved on the server, plus
 * browser-only drafts. Items can be moved by drag and drop, or with "Move to…" (keyboard
 * and touch friendly). Deleting a folder moves its contents up a level.
 */
export function FilesPanel({ open, currentId, onClose, onOpenDocument, onNewDocument }: FilesPanelProps) {
  const toast = useToast();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [docs, setDocs] = useState<DocumentSummary[] | null>(null);
  const [drafts, setDrafts] = useState<LocalDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null); // folder id or "root"
  const dragItem = useRef<DragItem | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [f, d] = await Promise.all([listFolders(), listDocuments()]);
      setFolders(f);
      setDocs(d);
      const serverIds = new Set(d.map((x) => x.id));
      setDrafts(listUnsyncedDrafts().filter((x) => !serverIds.has(x.id)));
    } catch (err) {
      setDocs([]);
      setDrafts(listUnsyncedDrafts());
      setError(err instanceof ApiError && err.isNetworkError ? "Server unreachable — showing browser drafts only." : errorMessage(err));
    }
  }, []);

  useEffect(() => setExpanded(readExpanded()), []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  // Reveal the open document: expand the folders above it.
  useEffect(() => {
    const doc = docs?.find((d) => d.id === currentId);
    if (!doc?.folderId) return;
    const chain = ancestorIds(doc.folderId, folders);
    setExpanded((prev) => (chain.every((id) => prev.has(id)) ? prev : new Set([...prev, ...chain])));
  }, [docs, folders, currentId]);

  useEffect(() => writeExpanded(expanded), [expanded]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || moveTarget) return;
      if (menuFor) setMenuFor(null);
      else if (!renaming) onClose();
    };
    const onPointer = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest(".row-menu, .row-menu-btn")) setMenuFor(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open, onClose, menuFor, renaming, moveTarget]);

  const toggle = (id: string, force?: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (force ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });

  /* ------------------------- actions ------------------------- */

  const run = async (action: () => Promise<unknown>, success?: string) => {
    try {
      const result = await action();
      const warning =
        typeof result === "object" && result !== null && "driveWarning" in result ? (result as { driveWarning?: string }).driveWarning : undefined;
      if (warning) toast(warning, "error");
      else if (success) toast(success, "success");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      await refresh();
    }
  };

  const newFolder = (parentId: string | null) =>
    run(async () => {
      const folder = await createFolder({ name: "New folder", parentId });
      if (parentId) toggle(parentId, true);
      setRenaming(folder.id);
      return folder;
    });

  const rename = (folder: Folder, name: string) => {
    setRenaming(null);
    const trimmed = name.trim();
    if (!trimmed || trimmed === folder.name) return;
    void run(() => updateFolder(folder.id, { name: trimmed }));
  };

  const move = (item: DragItem, folderId: string | null) =>
    run(async () => {
      const result = item.type === "document" ? await moveDocument(item.id, folderId) : await updateFolder(item.id, { parentId: folderId });
      if (folderId) toggle(folderId, true);
      return result;
    });

  const removeFolder = (folder: Folder) => {
    const parent = folders.find((f) => f.id === folder.parentId);
    const where = parent ? `“${parent.name}”` : "the top level";
    if (!window.confirm(`Delete folder “${folder.name}”?\n\nIts documents and sub-folders move to ${where}. No writing is deleted.`)) return;
    void run(() => deleteFolder(folder.id), "Folder deleted");
  };

  const removeDocument = (doc: DocumentSummary) => {
    if (!window.confirm(`Delete “${doc.title || "Untitled"}” from the server? A Google Drive copy is not deleted.`)) return;
    void run(async () => {
      await deleteDocument(doc.id);
      removeDraft(doc.id);
      if (doc.id === currentId) onNewDocument(null);
    }, "Document deleted");
  };

  const discardDraft = (draft: LocalDraft) => {
    if (!window.confirm(`Discard the browser draft “${draft.title || "Untitled"}”? This cannot be undone.`)) return;
    removeDraft(draft.id);
    if (draft.id === currentId) onNewDocument(null);
    void refresh();
  };

  /* ------------------------- drag & drop ------------------------- */

  const dragProps = (item: DragItem) => ({
    draggable: renaming !== item.id,
    onDragStart: (e: DragEvent) => {
      dragItem.current = item;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData(DRAG_MIME, JSON.stringify(item));
      setMenuFor(null);
    },
    onDragEnd: () => {
      dragItem.current = null;
      setDropTarget(null);
    },
  });

  const dropProps = (folderId: string | null) => {
    const key = folderId ?? "root";
    return {
      onDragOver: (e: DragEvent) => {
        const item = dragItem.current;
        if (!item || !docs || !canDrop(item, folderId, folders, docs)) return;
        e.preventDefault(); // allow drop
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        if (dropTarget !== key) setDropTarget(key);
      },
      onDragLeave: (e: DragEvent) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) {
          setDropTarget((t) => (t === key ? null : t));
        }
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const item = dragItem.current;
        setDropTarget(null);
        dragItem.current = null;
        if (item && docs && canDrop(item, folderId, folders, docs)) void move(item, folderId);
      },
    };
  };

  /* ------------------------- rendering ------------------------- */

  const menu = (id: string, items: { label: string; onClick: () => void; danger?: boolean }[]) => (
    <div className="row-actions">
      <button
        type="button"
        className="icon-btn row-menu-btn"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={menuFor === id}
        onClick={() => setMenuFor(menuFor === id ? null : id)}
      >
        <Icon name="more" size={16} />
      </button>
      {menuFor === id && (
        <ul className="row-menu" role="menu">
          {items.map((it) => (
            <li key={it.label} role="none">
              <button
                type="button"
                role="menuitem"
                className={it.danger ? "danger" : undefined}
                onClick={() => {
                  setMenuFor(null);
                  it.onClick();
                }}
              >
                {it.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const renderLevel = (parentId: string | null, depth: number): React.ReactNode => {
    if (!docs) return null;
    const level = childrenOf(parentId, folders, docs);
    if (depth > 0 && level.folders.length === 0 && level.documents.length === 0) {
      return <li className="tree-empty" style={{ paddingLeft: `${depth * 16 + 30}px` }}>Empty</li>;
    }
    return (
      <>
        {level.folders.map((f) => {
          const isOpen = expanded.has(f.id);
          return (
            <li key={f.id} role="treeitem" aria-expanded={isOpen} aria-selected={false}>
              <div
                className={`tree-row folder-row${dropTarget === f.id ? " drop-target" : ""}`}
                style={{ paddingLeft: `${depth * 16}px` }}
                {...dragProps({ type: "folder", id: f.id })}
                {...dropProps(f.id)}
              >
                <button type="button" className="tree-open" onClick={() => toggle(f.id)} aria-label={`${isOpen ? "Collapse" : "Expand"} ${f.name}`}>
                  <span className={`chevron${isOpen ? " open" : ""}`}>
                    <Icon name="chevronRight" size={14} />
                  </span>
                  <Icon name="folder" size={16} />
                  {renaming !== f.id && <span className="tree-label">{f.name}</span>}
                </button>
                {renaming === f.id && (
                  <input
                    className="input rename-input"
                    aria-label="Folder name"
                    defaultValue={f.name}
                    autoFocus
                    maxLength={255}
                    onFocus={(e) => e.target.select()}
                    onBlur={(e) => rename(f, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") rename(f, e.currentTarget.value);
                      if (e.key === "Escape") setRenaming(null);
                    }}
                  />
                )}
                {menu(f.id, [
                  { label: "New document here", onClick: () => onNewDocument(f.id) },
                  { label: "New folder inside", onClick: () => void newFolder(f.id) },
                  { label: "Rename", onClick: () => setRenaming(f.id) },
                  { label: "Move to…", onClick: () => setMoveTarget({ type: "folder", id: f.id, name: f.name }) },
                  { label: "Delete folder", onClick: () => removeFolder(f), danger: true },
                ])}
              </div>
              {isOpen && (
                <ul role="group" className="tree">
                  {renderLevel(f.id, depth + 1)}
                </ul>
              )}
            </li>
          );
        })}
        {level.documents.map((d) => (
          <li key={d.id} role="treeitem" aria-selected={d.id === currentId}>
            <div
              className={`tree-row doc-row${d.id === currentId ? " current" : ""}`}
              style={{ paddingLeft: `${depth * 16 + 16}px` }}
              {...dragProps({ type: "document", id: d.id })}
            >
              <button type="button" className="tree-open" onClick={() => onOpenDocument(d.id)}>
                <Icon name="files" size={16} />
                <span className="tree-label">
                  {d.title || "Untitled"}
                  <span className="doc-meta">
                    {d.wordCount} words · {formatDate(d.updatedAt)}
                    {d.driveSyncedAt && (
                      <span title={`Synced to Google Drive ${formatDate(d.driveSyncedAt)}`}>
                        {" "}· <Icon name="cloud" size={12} />
                      </span>
                    )}
                  </span>
                </span>
              </button>
              {menu(d.id, [
                { label: "Open", onClick: () => onOpenDocument(d.id) },
                { label: "Move to…", onClick: () => setMoveTarget({ type: "document", id: d.id, name: d.title || "Untitled" }) },
                { label: "Delete", onClick: () => removeDocument(d), danger: true },
              ])}
            </div>
          </li>
        ))}
      </>
    );
  };

  if (!open) return null;

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Files" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-header">
          <h2>Files</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </header>
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={() => onNewDocument(null)}>
            <Icon name="plus" size={16} /> New document
          </button>
          <button type="button" className="btn" onClick={() => void newFolder(null)}>
            <Icon name="folderPlus" size={16} /> New folder
          </button>
        </div>

        {error && <p className="muted small">{error}</p>}

        {drafts.length > 0 && (
          <section>
            <h3 className="drawer-section-title">Browser drafts (not on server)</h3>
            <ul className="tree">
              {drafts.map((d) => (
                <li key={d.id}>
                  <div className={`tree-row doc-row${d.id === currentId ? " current" : ""}`}>
                    <button type="button" className="tree-open" onClick={() => onOpenDocument(d.id)}>
                      <Icon name="files" size={16} />
                      <span className="tree-label">
                        {d.title || "Untitled"}
                        <span className="doc-meta">Draft · {formatDate(d.savedAt)}</span>
                      </span>
                    </button>
                    <button type="button" className="icon-btn" aria-label="Discard draft" onClick={() => discardDraft(d)}>
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className={`tree-root${dropTarget === "root" ? " drop-target" : ""}`} {...dropProps(null)}>
          <h3 className="drawer-section-title">Saved on server</h3>
          {docs === null ? (
            <p className="muted small">Loading…</p>
          ) : docs.length === 0 && folders.length === 0 ? (
            <p className="muted small">Nothing saved yet. Press Ctrl+S to save.</p>
          ) : (
            <ul className="tree" role="tree" aria-label="Folders and documents">
              {renderLevel(null, 0)}
            </ul>
          )}
          <p className="hint tree-hint">Drag items onto a folder to move them, or here for the top level.</p>
        </section>

        {moveTarget && (
          <MoveDialog
            target={moveTarget}
            folders={folders}
            currentFolderId={
              moveTarget.type === "document"
                ? docs?.find((d) => d.id === moveTarget.id)?.folderId ?? null
                : folders.find((f) => f.id === moveTarget.id)?.parentId ?? null
            }
            onCancel={() => setMoveTarget(null)}
            onMove={(folderId) => {
              const item = moveTarget;
              setMoveTarget(null);
              void move(item, folderId);
            }}
          />
        )}
      </aside>
    </div>
  );
}

function MoveDialog(props: {
  target: MoveTarget;
  folders: Folder[];
  currentFolderId: string | null;
  onCancel: () => void;
  onMove: (folderId: string | null) => void;
}) {
  const { target, folders } = props;
  // A folder can't move into itself or anything below it.
  const exclude = useMemo(
    () => (target.type === "folder" ? descendantIds(target.id, folders) : new Set<string>()),
    [target, folders],
  );
  const options = folderOptions(folders, exclude);
  const [value, setValue] = useState(props.currentFolderId ?? "");

  return (
    <Modal
      open
      title={`Move “${target.name}”`}
      onClose={props.onCancel}
      onSubmit={() => props.onMove(value || null)}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={props.onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={(value || null) === props.currentFolderId}>
            Move
          </button>
        </>
      }
    >
      <label className="modal-field">
        <span>Destination</span>
        <select className="input" value={value} autoFocus onChange={(e) => setValue(e.target.value)}>
          <option value="">Top level</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {"  ".repeat(o.depth + 1)}
              {o.name}
            </option>
          ))}
        </select>
      </label>
    </Modal>
  );
}
