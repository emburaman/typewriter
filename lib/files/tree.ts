import type { DocumentSummary, Folder } from "@/lib/shared/schemas";

/** Pure helpers for the file tree (unit tested). */

export interface TreeLevel {
  folders: Folder[];
  documents: DocumentSummary[];
}

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Children of `parentId` (null = top level): folders first, then documents, both A→Z. */
export function childrenOf(parentId: string | null, folders: Folder[], documents: DocumentSummary[]): TreeLevel {
  return {
    folders: folders.filter((f) => f.parentId === parentId).sort((a, b) => byName.compare(a.name, b.name)),
    documents: documents
      .filter((d) => d.folderId === parentId)
      .sort((a, b) => byName.compare(a.title || "Untitled", b.title || "Untitled")),
  };
}

/** Ids of `folderId` and every folder below it. */
export function descendantIds(folderId: string, folders: Folder[]): Set<string> {
  const ids = new Set([folderId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
        ids.add(f.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** Ancestors of a folder, nearest first (guards against cycles in bad data). */
export function ancestorIds(folderId: string | null, folders: Folder[]): string[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out: string[] = [];
  let current = folderId ? byId.get(folderId) : undefined;
  while (current && !out.includes(current.id)) {
    out.push(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return out;
}

export type DragItem = { type: "folder" | "document"; id: string };

/** Whether `item` may be dropped into `targetFolderId` (null = top level). */
export function canDrop(item: DragItem, targetFolderId: string | null, folders: Folder[], documents: DocumentSummary[]): boolean {
  if (item.type === "document") {
    const doc = documents.find((d) => d.id === item.id);
    return Boolean(doc) && doc?.folderId !== targetFolderId;
  }
  const folder = folders.find((f) => f.id === item.id);
  if (!folder || folder.parentId === targetFolderId) return false;
  return targetFolderId === null || !descendantIds(item.id, folders).has(targetFolderId);
}

/** Folder choices for a "Move to…" picker, depth-first with indentation depth. */
export function folderOptions(folders: Folder[], exclude: Set<string> = new Set()): { id: string; name: string; depth: number }[] {
  const out: { id: string; name: string; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const f of childrenOf(parentId, folders, []).folders) {
      if (exclude.has(f.id)) continue;
      out.push({ id: f.id, name: f.name, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
