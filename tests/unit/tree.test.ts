import { describe, expect, it } from "vitest";
import { ancestorIds, canDrop, childrenOf, descendantIds, folderOptions } from "../../lib/files/tree";
import type { DocumentSummary, Folder } from "../../lib/shared/schemas";

const folder = (id: string, name: string, parentId: string | null): Folder => ({
  id,
  name,
  parentId,
  createdAt: "",
  updatedAt: "",
});
const doc = (id: string, title: string, folderId: string | null): DocumentSummary => ({
  id,
  title,
  folderId,
  wordCount: 0,
  updatedAt: "",
  driveFileId: null,
  driveSyncedAt: null,
});

// novel ─ chapters ─ scenes ; essays (top level)
const folders = [
  folder("novel", "Novel", null),
  folder("chapters", "Chapters", "novel"),
  folder("scenes", "Scenes", "chapters"),
  folder("essays", "Essays", null),
];
const docs = [doc("d1", "Chapter 10", "chapters"), doc("d2", "Chapter 2", "chapters"), doc("d3", "Loose", null)];

describe("file tree helpers", () => {
  it("lists children folders-first, naturally sorted", () => {
    const level = childrenOf("chapters", folders, docs);
    expect(level.folders.map((f) => f.id)).toEqual(["scenes"]);
    expect(level.documents.map((d) => d.title)).toEqual(["Chapter 2", "Chapter 10"]);
    expect(childrenOf(null, folders, docs).folders.map((f) => f.name)).toEqual(["Essays", "Novel"]);
  });

  it("finds descendants and ancestors", () => {
    expect([...descendantIds("novel", folders)].sort()).toEqual(["chapters", "novel", "scenes"]);
    expect(ancestorIds("scenes", folders)).toEqual(["scenes", "chapters", "novel"]);
    expect(ancestorIds(null, folders)).toEqual([]);
  });

  it("survives cyclic data without looping forever", () => {
    const bad = [folder("a", "A", "b"), folder("b", "B", "a")];
    expect(ancestorIds("a", bad)).toEqual(["a", "b"]);
  });

  it("refuses moving a folder into itself, a descendant, or where it already is", () => {
    const item = { type: "folder" as const, id: "novel" };
    expect(canDrop(item, "novel", folders, docs)).toBe(false);
    expect(canDrop(item, "scenes", folders, docs)).toBe(false);
    expect(canDrop(item, null, folders, docs)).toBe(false); // already top level
    expect(canDrop(item, "essays", folders, docs)).toBe(true);
  });

  it("allows moving documents anywhere except where they already are", () => {
    expect(canDrop({ type: "document", id: "d1" }, "chapters", folders, docs)).toBe(false);
    expect(canDrop({ type: "document", id: "d1" }, null, folders, docs)).toBe(true);
    expect(canDrop({ type: "document", id: "missing" }, null, folders, docs)).toBe(false);
  });

  it("builds an indented move-to list without the excluded subtree", () => {
    expect(folderOptions(folders)).toEqual([
      { id: "essays", name: "Essays", depth: 0 },
      { id: "novel", name: "Novel", depth: 0 },
      { id: "chapters", name: "Chapters", depth: 1 },
      { id: "scenes", name: "Scenes", depth: 2 },
    ]);
    expect(folderOptions(folders, descendantIds("chapters", folders)).map((o) => o.id)).toEqual(["essays", "novel"]);
  });
});
