import { beforeEach, describe, expect, it } from "vitest";
import { DriveTreeSync, type DriveApi, type DriveItem, type FolderRecord, type FolderStore } from "../../server/services/driveTree";

/** In-memory Drive with just the behavior the sync relies on. */
class FakeDrive implements DriveApi {
  items = new Map<string, DriveItem & { kind: "folder" | "doc"; html?: string; version: number }>();
  calls: string[] = [];
  private seq = 0;
  private add(kind: "folder" | "doc", name: string, parent: string | null, html?: string) {
    const id = `${kind}-${++this.seq}`;
    this.items.set(id, { id, kind, name, parents: parent ? [parent] : ["my-drive"], trashed: false, html, version: 1 });
    return id;
  }
  async get(id: string) {
    const i = this.items.get(id);
    return i ? { id: i.id, name: i.name, parents: [...i.parents], trashed: i.trashed, version: i.version } : null;
  }
  async findRootFolder(name: string) {
    return [...this.items.values()].find((i) => i.kind === "folder" && i.name === name && !i.trashed && i.parents.includes("my-drive"))?.id ?? null;
  }
  async createFolder(name: string, parent: string | null) {
    this.calls.push(`createFolder ${name}`);
    return this.add("folder", name, parent);
  }
  async update(id: string, c: { name?: string; addParent?: string; removeParents?: string[] }) {
    const i = this.items.get(id)!;
    if (c.name) i.name = c.name;
    if (c.addParent) i.parents = [...i.parents.filter((p) => !(c.removeParents ?? []).includes(p)), c.addParent];
    i.version += 1;
    this.calls.push(`update ${i.name}`);
  }
  async listChildren(folderId: string) {
    return [...this.items.values()].filter((i) => i.parents.includes(folderId) && !i.trashed).map((i) => i.id);
  }
  async trash(id: string) {
    this.items.get(id)!.trashed = true;
  }
  async untrash(id: string) {
    this.items.get(id)!.trashed = false;
    this.calls.push(`untrash ${id}`);
  }
  async exportHtml(id: string) {
    return `<html>${this.items.get(id)?.html ?? ""}</html>`; // Google's rendering of what we uploaded
  }
  async createDoc(name: string, parent: string, html: string) {
    this.calls.push(`createDoc ${name}`);
    return this.add("doc", name, parent, html);
  }
  async updateDoc(id: string, name: string, html: string) {
    const i = this.items.get(id);
    if (!i) return false;
    Object.assign(i, { name, html, version: i.version + 1 });
    return true;
  }
  /** "Root / A / B" path of an item, for readable assertions. */
  path(id: string): string {
    const parts: string[] = [];
    let cur = this.items.get(id);
    while (cur) {
      parts.unshift(cur.name);
      cur = this.items.get(cur.parents[0] ?? "");
    }
    return parts.join(" / ");
  }
}

class MemoryStore implements FolderStore {
  folders = new Map<string, FolderRecord>();
  rootId: string | null = null;
  add(id: string, name: string, parentId: string | null) {
    this.folders.set(id, { id, name, parentId, driveFolderId: null, driveName: null });
  }
  async getFolder(id: string) {
    const f = this.folders.get(id);
    return f ? { ...f } : null;
  }
  async setDriveFolderId(id: string, driveFolderId: string, driveName: string) {
    Object.assign(this.folders.get(id)!, { driveFolderId, driveName });
  }
  async getRootId() {
    return this.rootId;
  }
  async setRootId(id: string) {
    this.rootId = id;
  }
}

let drive: FakeDrive;
let store: MemoryStore;
const sync = (root = "Olive Writer") => new DriveTreeSync(drive, store, root);

beforeEach(() => {
  drive = new FakeDrive();
  store = new MemoryStore();
  store.add("novel", "Novel", null);
  store.add("chapters", "Chapters", "novel");
});

describe("DriveTreeSync", () => {
  it("creates the folder path and uploads the document inside it", async () => {
    const { fileId: id } = await sync().uploadDocument({ title: "Chapter One", html: "<p>x</p>", driveFileId: null, folderId: "chapters" });
    expect(drive.path(id)).toBe("Olive Writer / Novel / Chapters / Chapter One");
    expect(store.folders.get("chapters")?.driveFolderId).toBeTruthy();
  });

  it("reuses existing Drive folders and updates the same file on later saves", async () => {
    const { fileId: id } = await sync().uploadDocument({ title: "Ch1", html: "a", driveFileId: null, folderId: "chapters" });
    drive.calls = [];
    const { fileId: again } = await sync().uploadDocument({ title: "Ch1", html: "b", driveFileId: id, folderId: "chapters" });
    expect(again).toBe(id);
    expect(drive.calls.filter((c) => c.startsWith("create"))).toEqual([]);
    expect(drive.items.get(id)?.html).toBe("b");
  });

  it("mirrors folder renames and moves", async () => {
    await sync().ensureFolder("chapters");
    store.folders.get("chapters")!.name = "Parts";
    store.folders.get("chapters")!.parentId = null; // moved to the top level
    const driveId = await sync().ensureFolder("chapters");
    expect(drive.path(driveId)).toBe("Olive Writer / Parts");
    expect(drive.items.get(driveId)?.parents).toHaveLength(1);
  });

  it("moves a document's file when the document moves to another folder", async () => {
    const { fileId: id } = await sync().uploadDocument({ title: "Doc", html: "", driveFileId: null, folderId: "chapters" });
    await sync().placeDocument(id, null);
    expect(drive.path(id)).toBe("Olive Writer / Doc");
  });

  it("deleting a folder moves its Drive contents up and trashes the empty folder", async () => {
    const { fileId: docId } = await sync().uploadDocument({ title: "Doc", html: "", driveFileId: null, folderId: "chapters" });
    const chaptersDrive = store.folders.get("chapters")!.driveFolderId!;
    // App side: "chapters" deleted, contents moved to "novel".
    store.folders.delete("chapters");
    await sync().removeFolder(chaptersDrive, "novel");
    expect(drive.path(docId)).toBe("Olive Writer / Novel / Doc");
    expect(drive.items.get(chaptersDrive)?.trashed).toBe(true);
  });

  it("repairs folders deleted or renamed by hand in Drive", async () => {
    const { fileId: first } = await sync().uploadDocument({ title: "Doc", html: "", driveFileId: null, folderId: "chapters" });
    const novelDrive = store.folders.get("novel")!.driveFolderId!;
    await drive.trash(store.folders.get("chapters")!.driveFolderId!); // trashed by hand
    await drive.update(novelDrive, { name: "renamed by hand" });
    const { fileId: second } = await sync().uploadDocument({ title: "Doc", html: "", driveFileId: first, folderId: "chapters" });
    expect(drive.path(second)).toBe("Olive Writer / Novel / Chapters / Doc");
  });

  it("renames the root folder instead of creating a second one", async () => {
    await sync().ensureFolder("novel");
    const root = store.rootId;
    await sync("My Writing").ensureFolder("novel");
    expect(store.rootId).toBe(root);
    expect(drive.items.get(root!)?.name).toBe("My Writing");
    expect([...drive.items.values()].filter((i) => i.kind === "folder" && !i.trashed)).toHaveLength(2);
  });

  it("finds an existing root folder by name when none is stored (e.g. after reconnecting)", async () => {
    const existing = await drive.createFolder("Olive Writer", null);
    expect(await sync().ensureFolder(null)).toBe(existing);
  });

  it("checks each folder only once per operation", async () => {
    store.add("a", "A", "chapters");
    store.add("b", "B", "chapters");
    const s = sync();
    await Promise.all([s.ensureFolder("a"), s.ensureFolder("b"), s.ensureFolder("chapters")]);
    expect(drive.calls.filter((c) => c === "createFolder Chapters")).toHaveLength(1);
  });

  it("reports Drive's version and a fingerprint of what Drive holds after an upload", async () => {
    const r = await sync().uploadDocument({ title: "Doc", html: "<p>a</p>", driveFileId: null, folderId: null });
    expect(r.version).toBe(drive.items.get(r.fileId)?.version);
    expect(r.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const r2 = await sync().uploadDocument({ title: "Doc", html: "<p>b</p>", driveFileId: r.fileId, folderId: null });
    expect(r2.version).toBeGreaterThan(r.version);
    expect(r2.contentHash).not.toBe(r.contentHash);
  });

  it("uploading a document whose file is in Drive's trash restores it (edits beat deletions)", async () => {
    const { fileId } = await sync().uploadDocument({ title: "Doc", html: "a", driveFileId: null, folderId: "chapters" });
    await drive.trash(fileId);
    const again = await sync().uploadDocument({ title: "Doc", html: "b", driveFileId: fileId, folderId: "chapters" });
    expect(again.fileId).toBe(fileId);
    expect(drive.items.get(fileId)).toMatchObject({ trashed: false, html: "b" });
  });

  it("trashFile sends a document's file to Drive's trash", async () => {
    const { fileId } = await sync().uploadDocument({ title: "Doc", html: "a", driveFileId: null, folderId: null });
    await sync().trashFile(fileId);
    expect(drive.items.get(fileId)?.trashed).toBe(true);
  });

  it("records the Drive name of mirrored folders (to tell Drive renames from app renames)", async () => {
    await sync().ensureFolder("chapters");
    expect(store.folders.get("chapters")?.driveName).toBe("Chapters");
    store.folders.get("chapters")!.name = "Parts";
    await sync().ensureFolder("chapters");
    expect(store.folders.get("chapters")?.driveName).toBe("Parts");
  });

  it("refuses cyclic folder data instead of looping forever", async () => {
    store.folders.get("novel")!.parentId = "chapters";
    await expect(sync().ensureFolder("chapters")).rejects.toThrow();
  });
});
