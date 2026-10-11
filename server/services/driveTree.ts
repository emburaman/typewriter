/**
 * Mirrors the app's folder tree in Google Drive, under one root folder ("Olive Writer").
 *
 * The database is the source of truth. Each app folder caches the id of its Drive folder;
 * every operation re-checks that the Drive side matches (exists, not trashed, right name,
 * right parent) and repairs it if not. So a sync that failed half-way, or folders moved or
 * deleted by hand in Drive, are fixed by the next operation.
 *
 * Talks to Drive only through `DriveApi`, so it can be tested with an in-memory fake.
 */

export interface DriveItem {
  id: string;
  name: string;
  parents: string[];
  trashed: boolean;
}

export interface DriveApi {
  /** null when the item doesn't exist (or isn't visible to the app). */
  get(id: string): Promise<DriveItem | null>;
  /** A non-trashed folder with this name in My Drive (used for the root folder only). */
  findRootFolder(name: string): Promise<string | null>;
  createFolder(name: string, parentId: string | null): Promise<string>;
  /** Rename and/or move (Drive moves = add new parent, remove the old ones). */
  update(id: string, change: { name?: string; addParent?: string; removeParents?: string[] }): Promise<void>;
  listChildren(folderId: string): Promise<string[]>;
  trash(id: string): Promise<void>;
  createDoc(name: string, parentId: string, html: string): Promise<string>;
  /** false when the file doesn't exist any more. */
  updateDoc(id: string, name: string, html: string): Promise<boolean>;
}

export interface FolderRecord {
  id: string;
  name: string;
  parentId: string | null;
  driveFolderId: string | null;
}

export interface FolderStore {
  getFolder(id: string): Promise<FolderRecord | null>;
  setDriveFolderId(id: string, driveFolderId: string): Promise<void>;
  getRootId(): Promise<string | null>;
  setRootId(id: string): Promise<void>;
}

export class DriveTreeSync {
  /** Per-instance memo: within one operation, each folder is checked at most once. */
  private readonly resolved = new Map<string | null, Promise<string>>();

  constructor(
    private readonly api: DriveApi,
    private readonly store: FolderStore,
    private readonly rootName: string,
  ) {}

  /** The Drive folder for an app folder (null = the root "Olive Writer" folder), created or repaired. */
  ensureFolder(folderId: string | null): Promise<string> {
    let pending = this.resolved.get(folderId);
    if (!pending) {
      pending = folderId === null ? this.ensureRoot() : this.ensureAppFolder(folderId, []);
      this.resolved.set(folderId, pending);
    }
    return pending;
  }

  /** Uploads (creates or updates) a document's Google Doc inside its folder. Returns the file id. */
  async uploadDocument(doc: { title: string; html: string; driveFileId: string | null; folderId: string | null }): Promise<string> {
    const parent = await this.ensureFolder(doc.folderId);
    const name = doc.title || "Untitled";
    if (doc.driveFileId && (await this.api.updateDoc(doc.driveFileId, name, doc.html))) {
      await this.place(doc.driveFileId, parent);
      return doc.driveFileId;
    }
    // Never uploaded, or the Drive copy was deleted: create it.
    return this.api.createDoc(name, parent, doc.html);
  }

  /** Moves an already-uploaded document's file into its folder (after a move in the app). */
  async placeDocument(driveFileId: string, folderId: string | null): Promise<void> {
    const parent = await this.ensureFolder(folderId);
    const item = await this.api.get(driveFileId);
    if (item && !item.trashed) await this.place(driveFileId, parent);
  }

  /**
   * After an app folder was deleted (its contents moved up to `parentFolderId`): move everything
   * left in its Drive folder up as well, then send the empty Drive folder to the trash.
   */
  async removeFolder(driveFolderId: string, parentFolderId: string | null): Promise<void> {
    const item = await this.api.get(driveFolderId);
    if (!item || item.trashed) return;
    const parent = await this.ensureFolder(parentFolderId);
    for (const child of await this.api.listChildren(driveFolderId)) await this.place(child, parent);
    await this.api.trash(driveFolderId);
  }

  private async ensureRoot(): Promise<string> {
    const storedId = await this.store.getRootId();
    if (storedId) {
      const item = await this.api.get(storedId);
      if (item && !item.trashed) {
        if (item.name !== this.rootName) await this.api.update(storedId, { name: this.rootName });
        return storedId;
      }
    }
    const id = (await this.api.findRootFolder(this.rootName)) ?? (await this.api.createFolder(this.rootName, null));
    await this.store.setRootId(id);
    return id;
  }

  /** `chain` = the folders whose Drive parent is being resolved through this call (cycle guard). */
  private async ensureAppFolder(folderId: string, chain: string[]): Promise<string> {
    const folder = await this.store.getFolder(folderId);
    if (!folder) throw new Error(`Folder ${folderId} not found`);
    const parent =
      folder.parentId === null
        ? await this.ensureFolder(null)
        : await this.ensureAppFolderMemo(folder.parentId, [...chain, folder.id]);

    if (folder.driveFolderId) {
      const item = await this.api.get(folder.driveFolderId);
      if (item && !item.trashed) {
        if (item.name !== folder.name) await this.api.update(item.id, { name: folder.name });
        await this.place(item.id, parent, item);
        return item.id;
      }
    }
    const id = await this.api.createFolder(folder.name, parent);
    await this.store.setDriveFolderId(folder.id, id);
    return id;
  }

  private ensureAppFolderMemo(folderId: string, chain: string[]): Promise<string> {
    // Waiting on a folder that is itself waiting on us would never settle: fail instead.
    if (chain.includes(folderId)) return Promise.reject(new Error("The folder tree contains a cycle"));
    let pending = this.resolved.get(folderId);
    if (!pending) {
      pending = this.ensureAppFolder(folderId, chain);
      this.resolved.set(folderId, pending);
    }
    return pending;
  }

  /** Makes `parentId` the item's only parent. */
  private async place(id: string, parentId: string, known?: DriveItem): Promise<void> {
    const item = known ?? (await this.api.get(id));
    if (!item) return;
    if (item.parents.length === 1 && item.parents[0] === parentId) return;
    await this.api.update(id, { addParent: parentId, removeParents: item.parents.filter((p) => p !== parentId) });
  }
}
