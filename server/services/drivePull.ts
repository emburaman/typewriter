import { createHash } from "node:crypto";

/**
 * Drive → app: applies changes made in Google Drive / Google Docs to the app.
 *
 * Runs on one snapshot of every Drive item the app can see (with the drive.file scope that is
 * exactly the files and folders the app created). Rules, in short:
 *  - edits in Google Docs are pulled in (only when the content really changed);
 *  - renames and moves inside the Olive Writer folder tree are applied to the app;
 *  - folders and documents created *by the app* that appear again (e.g. restored from Drive's
 *    trash) are imported or restored;
 *  - trashed in Drive → moved to the app's Trash (never deleted outright);
 *  - edits beat deletions, and if both sides edited, the Drive version is imported as a copy;
 *  - a file that's simply missing (other Google account, or deleted forever) is never treated
 *    as a deletion unless it belonged to this same account and wasn't edited in the app.
 */

export const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
export const FOLDER_MIME = "application/vnd.google-apps.folder";

export interface DriveEntry {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  trashed: boolean;
  /** Drive's file version: increases with every change (content or metadata). */
  version: number;
}

export interface PullDriveApi {
  /** Every item visible to the app, trashed ones included. */
  listAll(): Promise<DriveEntry[]>;
  /** A Google Doc exported as HTML. */
  exportHtml(id: string): Promise<string>;
}

export interface SyncFolder {
  id: string;
  name: string;
  parentId: string | null;
  driveFolderId: string | null;
  /** Drive name at the last sync (null = never synced). */
  driveName: string | null;
}

export interface SyncDoc {
  id: string;
  title: string;
  folderId: string | null;
  revision: number;
  deletedAt: string | null;
  driveFileId: string | null;
  driveVersion: number | null;
  driveContentHash: string | null;
  driveSyncedRevision: number | null;
  driveAccount: string | null;
}

export interface ImportedContent {
  title: string;
  html: string;
  contentHash: string;
  driveVersion: number;
}

/** App-side operations the pull needs (all scoped to one user by the implementation). */
export interface PullStore {
  listFolders(): Promise<SyncFolder[]>;
  listDocs(): Promise<SyncDoc[]>;
  renameFolder(id: string, name: string): Promise<void>;
  moveFolder(id: string, parentId: string | null): Promise<void>;
  /** App semantics: contents move up to the parent. */
  deleteFolder(id: string): Promise<void>;
  createFolder(name: string, parentId: string | null, driveFolderId: string): Promise<string>;
  /** Replace a document's content with the Google Docs version (bumps its revision). */
  importContent(id: string, content: ImportedContent): Promise<void>;
  createDocFromDrive(doc: ImportedContent & { folderId: string | null; driveFileId: string | null; account: string }): Promise<string>;
  setTitle(id: string, title: string): Promise<void>;
  moveDoc(id: string, folderId: string | null): Promise<void>;
  /** Record that app and Drive agree (version/hash/synced revision). */
  markInSync(id: string, state: { driveVersion: number; contentHash?: string }): Promise<void>;
  trashDoc(id: string): Promise<void>;
  restoreDoc(id: string): Promise<void>;
  /** Forget the Drive file (the next push creates a new one). */
  unlinkDoc(id: string): Promise<void>;
}

export interface PullResult {
  pulled: number;
  imported: number;
  trashed: number;
  restored: number;
  conflicts: number;
  foldersChanged: number;
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Word-ish title for a copy that keeps the Google Docs side of a two-sided edit. */
const copyTitle = (title: string) => `${title || "Untitled"} (Google Docs version)`;

export async function pullFromDrive(opts: {
  api: PullDriveApi;
  store: PullStore;
  rootId: string;
  /** The Google account currently connected. */
  account: string;
}): Promise<PullResult> {
  const { api, store, rootId, account } = opts;
  const result: PullResult = { pulled: 0, imported: 0, trashed: 0, restored: 0, conflicts: 0, foldersChanged: 0 };
  const entries = await api.listAll();
  const byId = new Map(entries.map((e) => [e.id, e]));

  /** Inside the Olive Writer tree (following first parents up to the root). */
  const inTree = (e: DriveEntry): boolean => {
    const seen = new Set<string>();
    let parent = e.parents[0];
    while (parent && !seen.has(parent)) {
      if (parent === rootId) return true;
      seen.add(parent);
      parent = byId.get(parent)?.parents[0];
    }
    return false;
  };
  const alive = (e: DriveEntry | undefined): e is DriveEntry => Boolean(e && !e.trashed && inTree(e));

  /* ----------------------------- folders ----------------------------- */

  const folders = await store.listFolders();
  const folderByDrive = new Map(folders.filter((f) => f.driveFolderId).map((f) => [f.driveFolderId as string, f]));
  /** App folder id for a Drive parent: null = top level, undefined = not one of ours. */
  const appFolderFor = (driveParent: string | undefined): string | null | undefined =>
    driveParent === rootId ? null : driveParent ? folderByDrive.get(driveParent)?.id : undefined;
  const isDescendant = (candidate: string | null, folderId: string): boolean => {
    const parentOf = new Map(folders.map((f) => [f.id, f.parentId]));
    for (let cur = candidate, i = 0; cur && i < 1000; cur = parentOf.get(cur) ?? null, i++) {
      if (cur === folderId) return true;
    }
    return false;
  };

  const trashedFolders: SyncFolder[] = [];
  for (const f of folders) {
    if (!f.driveFolderId) continue;
    const e = byId.get(f.driveFolderId);
    if (!e) continue; // not visible (other account / deleted forever): the next push recreates it
    if (e.trashed) {
      trashedFolders.push(f);
      continue;
    }
    if (f.driveName !== null && e.name !== f.driveName && e.name !== f.name) {
      await store.renameFolder(f.id, e.name); // renamed in Drive
      f.name = e.name;
      result.foldersChanged += 1;
    }
    const target = appFolderFor(e.parents[0]);
    if (target !== undefined && target !== f.parentId && !isDescendant(target, f.id)) {
      await store.moveFolder(f.id, target); // moved in Drive
      f.parentId = target;
      result.foldersChanged += 1;
    }
  }

  // Folders that exist in Drive but not in the app (e.g. restored from Drive's trash): parents first.
  const depth = (e: DriveEntry) => {
    let d = 0;
    for (let p = e.parents[0]; p && p !== rootId && d < 1000; p = byId.get(p)?.parents[0]) d++;
    return d;
  };
  const newFolders = entries
    .filter((e) => e.mimeType === FOLDER_MIME && e.id !== rootId && !folderByDrive.has(e.id) && alive(e))
    .sort((a, b) => depth(a) - depth(b));
  for (const e of newFolders) {
    const parentId = appFolderFor(e.parents[0]);
    if (parentId === undefined) continue;
    const id = await store.createFolder(e.name, parentId, e.id);
    const created = { id, name: e.name, parentId, driveFolderId: e.id, driveName: e.name };
    folders.push(created);
    folderByDrive.set(e.id, created);
    result.foldersChanged += 1;
  }

  /* ---------------------------- documents ---------------------------- */

  const docs = await store.listDocs();
  const docByFile = new Map(docs.filter((d) => d.driveFileId).map((d) => [d.driveFileId as string, d]));

  for (const d of docs) {
    if (!d.driveFileId) continue;
    const e = byId.get(d.driveFileId);
    const appChanged = d.driveSyncedRevision !== null && d.revision > d.driveSyncedRevision;

    if (d.deletedAt) {
      // In the app's Trash: restored in Drive → restore here too.
      if (alive(e)) {
        await store.restoreDoc(d.id);
        result.restored += 1;
        d.deletedAt = null;
      } else continue;
    }

    if (!e) {
      // Not visible any more. Only this account's own files count as deleted; never lose app edits.
      if ((d.driveAccount && d.driveAccount !== account) || appChanged || d.driveVersion === null) {
        await store.unlinkDoc(d.id);
      } else {
        await store.trashDoc(d.id);
        result.trashed += 1;
      }
      continue;
    }

    if (e.trashed) {
      if (appChanged) {
        await store.unlinkDoc(d.id); // edited in the app since: keep it, upload a fresh copy
      } else {
        await store.trashDoc(d.id);
        result.trashed += 1;
      }
      continue;
    }

    // Never synced with version tracking (e.g. uploaded before this feature): record a baseline.
    if (d.driveVersion === null || d.driveContentHash === null) {
      await store.markInSync(d.id, { driveVersion: e.version, contentHash: sha256(await api.exportHtml(e.id)) });
      continue;
    }
    if (e.version <= d.driveVersion) continue; // unchanged in Drive

    // Location and name (inside our tree only; elsewhere the next push moves it back).
    const target = appFolderFor(e.parents[0]);
    if (target !== undefined && target !== d.folderId) await store.moveDoc(d.id, target);
    const renamed = e.name !== d.title && !appChanged;

    const html = await api.exportHtml(e.id);
    const contentHash = sha256(html);
    if (contentHash === d.driveContentHash) {
      if (renamed) await store.setTitle(d.id, e.name);
      await store.markInSync(d.id, { driveVersion: e.version });
      continue;
    }
    if (appChanged) {
      // Both sides changed: keep the app version; save the Google Docs one as a separate document.
      await store.createDocFromDrive({
        title: copyTitle(e.name),
        html,
        contentHash,
        driveVersion: e.version,
        folderId: target ?? d.folderId,
        driveFileId: null,
        account,
      });
      await store.markInSync(d.id, { driveVersion: e.version, contentHash });
      result.conflicts += 1;
      continue;
    }
    await store.importContent(d.id, { title: e.name, html, contentHash, driveVersion: e.version });
    result.pulled += 1;
  }

  // Google Docs in our tree that no app document knows (created by the app, then unlinked/restored).
  for (const e of entries) {
    if (e.mimeType !== GOOGLE_DOC_MIME || docByFile.has(e.id) || !alive(e)) continue;
    const folderId = appFolderFor(e.parents[0]);
    if (folderId === undefined) continue;
    const html = await api.exportHtml(e.id);
    await store.createDocFromDrive({
      title: e.name,
      html,
      contentHash: sha256(html),
      driveVersion: e.version,
      folderId,
      driveFileId: e.id,
      account,
    });
    result.imported += 1;
  }

  // Folders trashed in Drive: deepest first (their documents were trashed above).
  const level = (f: SyncFolder) => {
    let n = 0;
    const parentOf = new Map(folders.map((x) => [x.id, x.parentId]));
    for (let p = f.parentId; p && n < 1000; p = parentOf.get(p) ?? null) n++;
    return n;
  };
  for (const f of trashedFolders.sort((a, b) => level(b) - level(a))) {
    await store.deleteFolder(f.id);
    result.foldersChanged += 1;
  }

  return result;
}
