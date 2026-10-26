import { HttpError, loggableError } from "../errors.js";
import * as documentsRepo from "../repositories/documentsRepository.js";
import * as foldersRepo from "../repositories/foldersRepository.js";
import * as googleRepo from "../repositories/googleRepository.js";
import * as settingsRepo from "../repositories/settingsRepository.js";
import { pullFromDrive, type PullResult, type PullStore } from "./drivePull.js";
import { DriveTreeSync, type FolderStore } from "./driveTree.js";
import { createDriveApi, createPullApi, getStatus, isConnectedWithDriveAccess, markGrantRefused, toHtmlFile } from "./googleDrive.js";
import {
  DRIVE_RECONNECT_MESSAGE,
  isInsufficientScopeError,
  isRevokedGrantError,
  MISSING_DRIVE_ACCESS_MESSAGE,
} from "./googleScopes.js";
import type { DocumentRecord } from "../../lib/shared/schemas.js";

/**
 * Two-way Google Drive sync of folders and documents.
 *  - push (app → Drive) right after each change in the app;
 *  - pull (Drive → app) every minute in the background, when the app asks (Files panel, tab
 *    focus), and before "Sync everything".
 * The database stays authoritative for the app; Drive failures never undo app changes.
 */

/** The folder store for one user's tree (every query is scoped to that user). */
const storeFor = (userId: string): FolderStore => ({
  getFolder: (id) => foldersRepo.findFolderForDrive(userId, id),
  setDriveFolderId: (id, driveFolderId, driveName) => foldersRepo.setDriveFolderId(userId, id, driveFolderId, driveName),
  getRootId: async () => (await googleRepo.getCredentials(userId))?.folderId ?? null,
  setRootId: (id) => googleRepo.setFolderId(userId, id),
});

/**
 * One Drive operation at a time per user, so concurrent saves can't create the same folder
 * twice and a pull never interleaves with a push. Different users never wait on each other.
 */
const queues = new Map<string, Promise<unknown>>();
function serialized<T>(userId: string, task: () => Promise<T>): Promise<T> {
  const run = (queues.get(userId) ?? Promise.resolve()).then(task, task);
  const tail = run.catch(() => undefined);
  queues.set(userId, tail);
  void tail.then(() => {
    if (queues.get(userId) === tail) queues.delete(userId);
  });
  return run;
}

interface TreeContext {
  tree: DriveTreeSync;
  fontFamily: string;
  account: string | null;
}

async function withTree<T>(userId: string, work: (ctx: TreeContext) => Promise<T>): Promise<T> {
  return serialized(userId, async () => {
    const settings = await settingsRepo.getSettings(userId);
    try {
      const tree = new DriveTreeSync(await createDriveApi(userId), storeFor(userId), settings.driveFolderName);
      const account = (await googleRepo.getCredentials(userId))?.accountEmail ?? null;
      return await work({ tree, fontFamily: settings.fontFamily, account });
    } catch (err) {
      if (isInsufficientScopeError(err)) throw new HttpError(403, "drive_scope_missing", MISSING_DRIVE_ACCESS_MESSAGE);
      if (isRevokedGrantError(err)) {
        await markGrantRefused(userId);
        throw new HttpError(409, "drive_reconnect_required", DRIVE_RECONNECT_MESSAGE);
      }
      if (err instanceof HttpError) throw err;
      // Google API errors: keep Google's explanation instead of a generic 500.
      console.error("[drive] Google Drive request failed:", loggableError(err));
      throw new HttpError(502, "google_drive_error", err instanceof Error ? err.message : String(err));
    }
  });
}

/** True when documents should be mirrored to Drive right now. */
export async function isDriveSyncEnabled(userId: string): Promise<boolean> {
  const settings = await settingsRepo.getSettings(userId);
  return settings.storageProvider === "google_drive" && (await isConnectedWithDriveAccess(userId));
}

/* ------------------------------- push ------------------------------- */

async function push(ctx: TreeContext, userId: string, doc: DocumentRecord): Promise<string> {
  const pushed = await ctx.tree.uploadDocument({
    title: doc.title,
    html: toHtmlFile(doc, ctx.fontFamily),
    driveFileId: doc.driveFileId,
    folderId: doc.folderId,
  });
  await documentsRepo.markPushed(userId, doc.id, { ...pushed, revision: doc.revision, account: ctx.account });
  return pushed.fileId;
}

/** Uploads one document into its folder in Drive; records what Drive now holds. */
export function uploadDocument(userId: string, doc: DocumentRecord): Promise<string> {
  return withTree(userId, (ctx) => push(ctx, userId, doc));
}

/** After a document was moved to the app's Trash: send its Drive file to Drive's trash. */
export function trashInDrive(userId: string, driveFileId: string): Promise<void> {
  return withTree(userId, ({ tree }) => tree.trashFile(driveFileId));
}

/** After a folder was created, renamed or moved in the app. */
export function syncFolder(userId: string, folderId: string): Promise<void> {
  return withTree(userId, async ({ tree }) => {
    await tree.ensureFolder(folderId);
  });
}

/** After a document moved to another folder (only matters once it has been uploaded). */
export function syncDocumentLocation(userId: string, doc: DocumentRecord): Promise<void> {
  return withTree(userId, async ({ tree }) => {
    if (doc.driveFileId) await tree.placeDocument(doc.driveFileId, doc.folderId);
  });
}

/** After an app folder was deleted (its contents already moved up to `parentFolderId`). */
export function removeFolder(userId: string, driveFolderId: string, parentFolderId: string | null): Promise<void> {
  return withTree(userId, ({ tree }) => tree.removeFolder(driveFolderId, parentFolderId));
}

/** After the root folder name changed in Settings: rename it in Drive. */
export function syncRoot(userId: string): Promise<void> {
  return withTree(userId, async ({ tree }) => {
    await tree.ensureFolder(null);
  });
}

/* ------------------------------- pull ------------------------------- */

function pullStoreFor(userId: string, unlinked: string[]): PullStore {
  return {
    listFolders: () => foldersRepo.listForSync(userId),
    listDocs: () => documentsRepo.listForSync(userId),
    renameFolder: (id, name) => foldersRepo.renameFromDrive(userId, id, name),
    moveFolder: (id, parentId) => foldersRepo.updateFolder(userId, id, { parentId }),
    deleteFolder: async (id) => {
      await foldersRepo.deleteFolder(userId, id);
    },
    createFolder: (name, parentId, driveFolderId) => foldersRepo.createFromDrive(userId, name, parentId, driveFolderId),
    importContent: (id, c) => documentsRepo.importContent(userId, id, c),
    createDocFromDrive: (c) => documentsRepo.createFromDrive(userId, c),
    setTitle: (id, title) => documentsRepo.setTitleFromDrive(userId, id, title),
    moveDoc: async (id, folderId) => {
      await documentsRepo.moveDocument(userId, id, folderId);
    },
    markInSync: (id, s) => documentsRepo.markInSync(userId, id, s),
    trashDoc: async (id) => {
      await documentsRepo.trashDocument(userId, id);
    },
    restoreDoc: async (id) => {
      await documentsRepo.restoreDocument(userId, id);
    },
    unlinkDoc: async (id) => {
      await documentsRepo.unlinkDrive(userId, id);
      unlinked.push(id);
    },
  };
}

const lastPull = new Map<string, number>();

/**
 * Drive → app, then re-uploads documents the pull detached from Drive (e.g. edited here but
 * trashed there). Returns what changed.
 */
export function pull(userId: string): Promise<PullResult> {
  return withTree(userId, async (ctx) => {
    lastPull.set(userId, Date.now());
    const rootId = await ctx.tree.ensureFolder(null);
    const unlinked: string[] = [];
    const result = await pullFromDrive({
      api: await createPullApi(userId),
      store: pullStoreFor(userId, unlinked),
      rootId,
      account: ctx.account ?? "",
    });
    for (const id of unlinked) {
      const doc = await documentsRepo.findDocument(userId, id);
      if (doc) await push(ctx, userId, { ...doc, driveFileId: null });
    }
    await googleRepo.setLastPull(userId);
    return result;
  });
}

/** Pull unless one ran in the last `minIntervalMs` (for client-triggered refreshes). */
export async function pullIfDue(userId: string, minIntervalMs: number): Promise<PullResult | null> {
  if (Date.now() - (lastPull.get(userId) ?? 0) < minIntervalMs) return null;
  if (!(await isDriveSyncEnabled(userId))) return null;
  if ((await getStatus(userId)).needsReconnect) return null; // nothing works until the user reconnects
  return pull(userId);
}

export interface SyncAllResult {
  folders: number;
  documents: number;
  pulled: PullResult;
  failed: { title: string; message: string }[];
}

/** Pull from Drive, then mirror every folder and upload every document. */
export async function syncEverything(userId: string): Promise<SyncAllResult> {
  const pulled = await pull(userId);
  return withTree(userId, async (ctx) => {
    const folders = await foldersRepo.listFolders(userId);
    for (const f of folders) await ctx.tree.ensureFolder(f.id);

    const result: SyncAllResult = { folders: folders.length, documents: 0, pulled, failed: [] };
    for (const summary of await documentsRepo.listDocuments(userId)) {
      const doc = await documentsRepo.findDocument(userId, summary.id);
      if (!doc) continue;
      try {
        await push(ctx, userId, doc);
        result.documents += 1;
      } catch (err) {
        if (isInsufficientScopeError(err)) throw err; // nothing else will work either
        console.error(`[drive] sync of document ${doc.id} failed:`, loggableError(err));
        result.failed.push({ title: doc.title, message: err instanceof Error ? err.message : String(err) });
      }
    }
    return result;
  });
}

/* --------------------------- background loop --------------------------- */

const PULL_EVERY_MS = 60_000;
let loopRunning = false;
let lastPurge = 0;

/** Pulls Drive changes for every user with Drive sync on, every minute; purges old Trash daily. */
export function startDriveSyncLoop(): NodeJS.Timeout {
  const tick = async () => {
    if (loopRunning) return; // a slow round must not overlap the next
    loopRunning = true;
    try {
      if (Date.now() - lastPurge > 24 * 60 * 60 * 1000) {
        lastPurge = Date.now();
        const purged = await documentsRepo.purgeOldTrash();
        if (purged) console.log(`[trash] permanently deleted ${purged} document(s) older than ${documentsRepo.TRASH_DAYS} days`);
      }
      for (const userId of await googleRepo.usersWithDriveSync()) {
        try {
          await pullIfDue(userId, PULL_EVERY_MS / 2);
        } catch (err) {
          console.warn(`[drive] background pull for ${userId} failed:`, err instanceof Error ? err.message : err);
        }
      }
    } catch (err) {
      console.error("[drive] background sync round failed:", loggableError(err));
    } finally {
      loopRunning = false;
    }
  };
  return setInterval(() => void tick(), PULL_EVERY_MS);
}

/**
 * Runs a Drive follow-up for an app change when sync is on. Returns a warning message on
 * failure instead of throwing: the app change itself already succeeded.
 */
export async function followUp(userId: string, task: () => Promise<unknown>): Promise<string | undefined> {
  if (!(await isDriveSyncEnabled(userId))) return undefined;
  try {
    await task();
    return undefined;
  } catch (err) {
    console.error("[drive] follow-up sync failed:", loggableError(err));
    const message = err instanceof Error ? err.message : String(err);
    return `Saved, but Google Drive wasn't updated: ${message}`;
  }
}
