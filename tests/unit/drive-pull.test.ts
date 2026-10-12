import { beforeEach, describe, expect, it } from "vitest";
import {
  FOLDER_MIME,
  GOOGLE_DOC_MIME,
  pullFromDrive,
  sha256,
  type DriveEntry,
  type ImportedContent,
  type PullStore,
  type SyncDoc,
  type SyncFolder,
} from "../../server/services/drivePull";

const ROOT = "root";
const ME = "me@gmail.com";

/** Drive snapshot + exported HTML per file. */
let entries: DriveEntry[];
let html: Map<string, string>;
const api = {
  listAll: async () => entries.map((e) => ({ ...e, parents: [...e.parents] })),
  exportHtml: async (id: string) => html.get(id) ?? "",
};

/** In-memory app side. */
class Store implements PullStore {
  folders: SyncFolder[] = [];
  docs: (SyncDoc & { html?: string })[] = [];
  log: string[] = [];
  private n = 0;
  async listFolders() {
    return this.folders.map((f) => ({ ...f }));
  }
  async listDocs() {
    return this.docs.map((d) => ({ ...d }));
  }
  private f(id: string) {
    return this.folders.find((x) => x.id === id)!;
  }
  private d(id: string) {
    return this.docs.find((x) => x.id === id)!;
  }
  async renameFolder(id: string, name: string) {
    Object.assign(this.f(id), { name, driveName: name });
    this.log.push(`renameFolder ${name}`);
  }
  async moveFolder(id: string, parentId: string | null) {
    this.f(id).parentId = parentId;
    this.log.push(`moveFolder ${id}->${parentId}`);
  }
  async deleteFolder(id: string) {
    this.folders = this.folders.filter((x) => x.id !== id);
    this.log.push(`deleteFolder ${id}`);
  }
  async createFolder(name: string, parentId: string | null, driveFolderId: string) {
    const id = `f${++this.n}`;
    this.folders.push({ id, name, parentId, driveFolderId, driveName: name });
    this.log.push(`createFolder ${name}`);
    return id;
  }
  async importContent(id: string, c: ImportedContent) {
    const d = this.d(id);
    Object.assign(d, { title: c.title, html: c.html, revision: d.revision + 1, driveVersion: c.driveVersion, driveContentHash: c.contentHash });
    d.driveSyncedRevision = d.revision;
    this.log.push(`import ${id}`);
  }
  async createDocFromDrive(c: ImportedContent & { folderId: string | null; driveFileId: string | null; account: string }) {
    const id = `d${++this.n}`;
    this.docs.push({
      id,
      title: c.title,
      folderId: c.folderId,
      revision: 1,
      deletedAt: null,
      driveFileId: c.driveFileId,
      driveVersion: c.driveVersion,
      driveContentHash: c.contentHash,
      driveSyncedRevision: 1,
      driveAccount: c.account,
      html: c.html,
    });
    this.log.push(`create ${c.title}`);
    return id;
  }
  async setTitle(id: string, title: string) {
    this.d(id).title = title;
    this.log.push(`title ${title}`);
  }
  async moveDoc(id: string, folderId: string | null) {
    this.d(id).folderId = folderId;
    this.log.push(`moveDoc ${id}->${folderId}`);
  }
  async markInSync(id: string, s: { driveVersion: number; contentHash?: string }) {
    const d = this.d(id);
    d.driveVersion = s.driveVersion;
    if (s.contentHash) d.driveContentHash = s.contentHash;
  }
  async trashDoc(id: string) {
    this.d(id).deletedAt = "now";
    this.log.push(`trash ${id}`);
  }
  async restoreDoc(id: string) {
    this.d(id).deletedAt = null;
    this.log.push(`restore ${id}`);
  }
  async unlinkDoc(id: string) {
    Object.assign(this.d(id), { driveFileId: null, driveVersion: null, driveContentHash: null });
    this.log.push(`unlink ${id}`);
  }
}

let store: Store;
const pull = () => pullFromDrive({ api, store, rootId: ROOT, account: ME });

const file = (id: string, name: string, parent = ROOT, version = 5, extra: Partial<DriveEntry> = {}): DriveEntry => ({
  id,
  name,
  mimeType: GOOGLE_DOC_MIME,
  parents: [parent],
  trashed: false,
  version,
  ...extra,
});
const folder = (id: string, name: string, parent = ROOT, extra: Partial<DriveEntry> = {}): DriveEntry => ({
  ...file(id, name, parent, 1, extra),
  mimeType: FOLDER_MIME,
});

/** An app document in sync with Drive file `fileId` at version 5. */
function syncedDoc(id: string, fileId: string, over: Partial<SyncDoc> = {}) {
  html.set(fileId, `<p>${id} original</p>`);
  store.docs.push({
    id,
    title: id,
    folderId: null,
    revision: 3,
    deletedAt: null,
    driveFileId: fileId,
    driveVersion: 5,
    driveContentHash: sha256(`<p>${id} original</p>`),
    driveSyncedRevision: 3,
    driveAccount: ME,
    ...over,
  });
}

beforeEach(() => {
  entries = [folder(ROOT, "Olive Writer", "my-drive")];
  html = new Map();
  store = new Store();
});

describe("pull: document content", () => {
  it("pulls an edit made in Google Docs", async () => {
    syncedDoc("a", "fa");
    entries.push(file("fa", "a", ROOT, 6));
    html.set("fa", "<p>edited in Google Docs</p>");
    expect((await pull()).pulled).toBe(1);
    expect(store.docs[0]).toMatchObject({ html: "<p>edited in Google Docs</p>", revision: 4, driveVersion: 6 });
  });

  it("ignores version bumps that didn't change the content", async () => {
    syncedDoc("a", "fa");
    entries.push(file("fa", "a", ROOT, 9)); // e.g. starred or shared
    expect((await pull()).pulled).toBe(0);
    expect(store.log).toEqual([]);
    expect(store.docs[0]?.driveVersion).toBe(9);
  });

  it("does nothing when Drive is unchanged", async () => {
    syncedDoc("a", "fa");
    entries.push(file("fa", "a", ROOT, 5));
    html.set("fa", "<p>would be different</p>");
    await pull();
    expect(store.log).toEqual([]);
  });

  it("both sides edited: keeps the app version and imports Drive's as a copy", async () => {
    syncedDoc("a", "fa", { revision: 4 }); // app edited since the last sync (synced at 3)
    entries.push(file("fa", "a", ROOT, 6));
    html.set("fa", "<p>drive edit</p>");
    const r = await pull();
    expect(r.conflicts).toBe(1);
    expect(store.docs[0]?.html).toBeUndefined(); // app version untouched
    expect(store.docs[1]).toMatchObject({ title: "a (Google Docs version)", html: "<p>drive edit</p>", driveFileId: null });
  });

  it("records a baseline (no import) for files uploaded before version tracking", async () => {
    syncedDoc("a", "fa", { driveVersion: null, driveContentHash: null });
    entries.push(file("fa", "a", ROOT, 42));
    html.set("fa", "<p>google's rendering of our upload</p>");
    await pull();
    expect(store.log).toEqual([]);
    expect(store.docs[0]).toMatchObject({ driveVersion: 42, driveContentHash: sha256("<p>google's rendering of our upload</p>") });
  });
});

describe("pull: names and locations", () => {
  it("applies a rename made in Drive", async () => {
    syncedDoc("a", "fa");
    entries.push(file("fa", "Renamed in Drive", ROOT, 6));
    await pull();
    expect(store.docs[0]?.title).toBe("Renamed in Drive");
  });

  it("doesn't take Drive's name when the app renamed it since", async () => {
    syncedDoc("a", "fa", { revision: 4, title: "New app title" });
    entries.push(file("fa", "a", ROOT, 6));
    await pull();
    expect(store.docs[0]?.title).toBe("New app title");
  });

  it("applies a move between Olive Writer folders made in Drive", async () => {
    store.folders.push({ id: "novel", name: "Novel", parentId: null, driveFolderId: "dnovel", driveName: "Novel" });
    entries.push(folder("dnovel", "Novel"));
    syncedDoc("a", "fa");
    entries.push(file("fa", "a", "dnovel", 6));
    await pull();
    expect(store.docs[0]?.folderId).toBe("novel");
  });

  it("ignores moves out of the Olive Writer tree (the next push moves it back)", async () => {
    syncedDoc("a", "fa");
    entries.push(file("fa", "a", "somewhere-else", 6));
    await pull();
    expect(store.docs[0]?.folderId).toBeNull();
    expect(store.log.filter((l) => l.startsWith("moveDoc"))).toEqual([]);
  });
});

describe("pull: deletions (always to the app's Trash)", () => {
  it("trashed in Drive → moved to the app's Trash", async () => {
    syncedDoc("a", "fa");
    entries.push(file("fa", "a", ROOT, 6, { trashed: true }));
    expect((await pull()).trashed).toBe(1);
    expect(store.docs[0]?.deletedAt).toBe("now");
  });

  it("edits beat deletions: trashed in Drive but edited in the app → kept and re-uploaded", async () => {
    syncedDoc("a", "fa", { revision: 4 });
    entries.push(file("fa", "a", ROOT, 6, { trashed: true }));
    await pull();
    expect(store.docs[0]).toMatchObject({ deletedAt: null, driveFileId: null });
  });

  it("missing file of another Google account is never treated as deleted", async () => {
    syncedDoc("a", "fa", { driveAccount: "old@gmail.com" });
    await pull(); // fa not visible at all
    expect(store.docs[0]).toMatchObject({ deletedAt: null, driveFileId: null });
  });

  it("missing file of this account (deleted forever) → app Trash", async () => {
    syncedDoc("a", "fa");
    await pull();
    expect(store.docs[0]?.deletedAt).toBe("now");
  });

  it("restored from Drive's trash → restored in the app", async () => {
    syncedDoc("a", "fa", { deletedAt: "yesterday" });
    entries.push(file("fa", "a", ROOT, 5));
    expect((await pull()).restored).toBe(1);
    expect(store.docs[0]?.deletedAt).toBeNull();
  });

  it("a trashed Drive folder trashes its documents and removes the folder", async () => {
    store.folders.push({ id: "novel", name: "Novel", parentId: null, driveFolderId: "dnovel", driveName: "Novel" });
    entries.push(folder("dnovel", "Novel", ROOT, { trashed: true }));
    syncedDoc("a", "fa", { folderId: "novel" });
    entries.push(file("fa", "a", "dnovel", 6, { trashed: true }));
    await pull();
    expect(store.docs[0]?.deletedAt).toBe("now");
    expect(store.folders).toEqual([]);
  });
});

describe("pull: folders and new items", () => {
  it("applies folder renames and moves made in Drive", async () => {
    store.folders.push(
      { id: "a", name: "A", parentId: null, driveFolderId: "da", driveName: "A" },
      { id: "b", name: "B", parentId: null, driveFolderId: "db", driveName: "B" },
    );
    entries.push(folder("da", "A renamed"), folder("db", "B", "da"));
    await pull();
    expect(store.folders.find((f) => f.id === "a")?.name).toBe("A renamed");
    expect(store.folders.find((f) => f.id === "b")?.parentId).toBe("a");
  });

  it("refuses a Drive move that would make a folder its own ancestor in the app", async () => {
    store.folders.push(
      { id: "a", name: "A", parentId: null, driveFolderId: "da", driveName: "A" },
      { id: "b", name: "B", parentId: "a", driveFolderId: "db", driveName: "B" },
    );
    entries.push(folder("da", "A", "db"), folder("db", "B", "da")); // impossible in Drive, but be safe
    await pull();
    expect(store.folders.find((f) => f.id === "a")?.parentId).toBeNull();
  });

  it("imports folders and Google Docs in the tree that the app doesn't know, parents first", async () => {
    entries.push(folder("dx", "Restored"), folder("dy", "Inner", "dx"), file("fz", "Old chapter", "dy", 3));
    html.set("fz", "<p>restored text</p>");
    const r = await pull();
    expect(r.imported).toBe(1);
    const inner = store.folders.find((f) => f.name === "Inner")!;
    expect(inner.parentId).toBe(store.folders.find((f) => f.name === "Restored")!.id);
    expect(store.docs[0]).toMatchObject({ title: "Old chapter", folderId: inner.id, driveFileId: "fz", html: "<p>restored text</p>" });
  });

  it("ignores Drive items outside the Olive Writer tree", async () => {
    entries.push(file("elsewhere", "Not ours", "my-drive"), folder("df", "Other", "my-drive"));
    await pull();
    expect(store.docs).toEqual([]);
    expect(store.folders).toEqual([]);
  });
});
