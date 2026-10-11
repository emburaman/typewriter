import { HttpError } from "../errors.js";
import * as documentsRepo from "../repositories/documentsRepository.js";
import * as foldersRepo from "../repositories/foldersRepository.js";
import * as googleRepo from "../repositories/googleRepository.js";
import * as settingsRepo from "../repositories/settingsRepository.js";
import { DriveTreeSync, type FolderStore } from "./driveTree.js";
import { createDriveApi, isConnectedWithDriveAccess, toHtmlFile } from "./googleDrive.js";
import { isInsufficientScopeError, MISSING_DRIVE_ACCESS_MESSAGE } from "./googleScopes.js";
import type { DocumentRecord } from "../../lib/shared/schemas.js";

/**
 * Google Drive mirroring of folders and documents. The database stays the source of truth:
 * Drive operations run after the database change, and a failure never undoes it — the next
 * sync (any save, or "Sync everything") repairs the Drive side.
 */

/** The folder store for one user's tree (every query is scoped to that user). */
const storeFor = (userId: string): FolderStore => ({
  getFolder: (id) => foldersRepo.findFolderForDrive(userId, id),
  setDriveFolderId: (id, driveFolderId) => foldersRepo.setDriveFolderId(userId, id, driveFolderId),
  getRootId: async () => (await googleRepo.getCredentials(userId))?.folderId ?? null,
  setRootId: (id) => googleRepo.setFolderId(userId, id),
});

/**
 * One Drive sync at a time per user, so concurrent saves can't create the same folder twice.
 * Different users have different Drives and never wait on each other.
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

async function withTree<T>(userId: string, work: (tree: DriveTreeSync, fontFamily: string) => Promise<T>): Promise<T> {
  return serialized(userId, async () => {
    const settings = await settingsRepo.getSettings(userId);
    try {
      const tree = new DriveTreeSync(await createDriveApi(userId), storeFor(userId), settings.driveFolderName);
      return await work(tree, settings.fontFamily);
    } catch (err) {
      if (isInsufficientScopeError(err)) throw new HttpError(403, "drive_scope_missing", MISSING_DRIVE_ACCESS_MESSAGE);
      if (err instanceof HttpError) throw err;
      // Google API errors: keep Google's explanation instead of a generic 500.
      console.error("[drive] Google Drive request failed:", err);
      throw new HttpError(502, "google_drive_error", err instanceof Error ? err.message : String(err));
    }
  });
}

/** True when documents should be mirrored to Drive right now. */
export async function isDriveSyncEnabled(userId: string): Promise<boolean> {
  const settings = await settingsRepo.getSettings(userId);
  return settings.storageProvider === "google_drive" && (await isConnectedWithDriveAccess(userId));
}

/** Uploads one document into its folder in Drive; records and returns the Drive file id. */
export async function uploadDocument(userId: string, doc: DocumentRecord): Promise<string> {
  return withTree(userId, async (tree, fontFamily) => {
    const fileId = await tree.uploadDocument({
      title: doc.title,
      html: toHtmlFile(doc, fontFamily),
      driveFileId: doc.driveFileId,
      folderId: doc.folderId,
    });
    await documentsRepo.markDriveSynced(userId, doc.id, fileId);
    return fileId;
  });
}

/** After a folder was created, renamed or moved in the app. */
export function syncFolder(userId: string, folderId: string): Promise<void> {
  return withTree(userId, async (tree) => {
    await tree.ensureFolder(folderId);
  });
}

/** After a document moved to another folder (only matters once it has been uploaded). */
export function syncDocumentLocation(userId: string, doc: DocumentRecord): Promise<void> {
  return withTree(userId, async (tree) => {
    if (doc.driveFileId) await tree.placeDocument(doc.driveFileId, doc.folderId);
  });
}

/** After an app folder was deleted (its contents already moved up to `parentFolderId`). */
export function removeFolder(userId: string, driveFolderId: string, parentFolderId: string | null): Promise<void> {
  return withTree(userId, (tree) => tree.removeFolder(driveFolderId, parentFolderId));
}

/** After the root folder name changed in Settings: rename it in Drive. */
export function syncRoot(userId: string): Promise<void> {
  return withTree(userId, async (tree) => {
    await tree.ensureFolder(null);
  });
}

export interface SyncAllResult {
  folders: number;
  documents: number;
  failed: { title: string; message: string }[];
}

/** Mirrors every folder and uploads every document (for content created before Drive was on). */
export function syncEverything(userId: string): Promise<SyncAllResult> {
  return withTree(userId, async (tree, fontFamily) => {
    const folders = await foldersRepo.listFolders(userId);
    for (const f of folders) await tree.ensureFolder(f.id);

    const result: SyncAllResult = { folders: folders.length, documents: 0, failed: [] };
    for (const summary of await documentsRepo.listDocuments(userId)) {
      const doc = await documentsRepo.findDocument(userId, summary.id);
      if (!doc) continue;
      try {
        const fileId = await tree.uploadDocument({
          title: doc.title,
          html: toHtmlFile(doc, fontFamily),
          driveFileId: doc.driveFileId,
          folderId: doc.folderId,
        });
        await documentsRepo.markDriveSynced(userId, doc.id, fileId);
        result.documents += 1;
      } catch (err) {
        if (isInsufficientScopeError(err)) throw err; // nothing else will work either
        console.error(`[drive] sync of document ${doc.id} failed:`, err);
        result.failed.push({ title: doc.title, message: err instanceof Error ? err.message : String(err) });
      }
    }
    return result;
  });
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
    console.error("[drive] follow-up sync failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    return `Saved, but Google Drive wasn't updated: ${message}`;
  }
}
