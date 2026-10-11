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

const store: FolderStore = {
  getFolder: (id) => foldersRepo.findFolderForDrive(id),
  setDriveFolderId: (id, driveFolderId) => foldersRepo.setDriveFolderId(id, driveFolderId),
  getRootId: async () => (await googleRepo.getCredentials())?.folderId ?? null,
  setRootId: (id) => googleRepo.setFolderId(id),
};

/** One Drive sync at a time, so concurrent saves can't create the same folder twice. */
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

async function withTree<T>(work: (tree: DriveTreeSync, fontFamily: string) => Promise<T>): Promise<T> {
  return serialized(async () => {
    const settings = await settingsRepo.getSettings();
    try {
      const tree = new DriveTreeSync(await createDriveApi(), store, settings.driveFolderName);
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
export async function isDriveSyncEnabled(): Promise<boolean> {
  const settings = await settingsRepo.getSettings();
  return settings.storageProvider === "google_drive" && (await isConnectedWithDriveAccess());
}

/** Uploads one document into its folder in Drive; records and returns the Drive file id. */
export async function uploadDocument(doc: DocumentRecord): Promise<string> {
  return withTree(async (tree, fontFamily) => {
    const fileId = await tree.uploadDocument({
      title: doc.title,
      html: toHtmlFile(doc, fontFamily),
      driveFileId: doc.driveFileId,
      folderId: doc.folderId,
    });
    await documentsRepo.markDriveSynced(doc.id, fileId);
    return fileId;
  });
}

/** After a folder was created, renamed or moved in the app. */
export function syncFolder(folderId: string): Promise<void> {
  return withTree(async (tree) => {
    await tree.ensureFolder(folderId);
  });
}

/** After a document moved to another folder (only matters once it has been uploaded). */
export function syncDocumentLocation(doc: DocumentRecord): Promise<void> {
  return withTree(async (tree) => {
    if (doc.driveFileId) await tree.placeDocument(doc.driveFileId, doc.folderId);
  });
}

/** After an app folder was deleted (its contents already moved up to `parentFolderId`). */
export function removeFolder(driveFolderId: string, parentFolderId: string | null): Promise<void> {
  return withTree((tree) => tree.removeFolder(driveFolderId, parentFolderId));
}

/** After the root folder name changed in Settings: rename it in Drive. */
export function syncRoot(): Promise<void> {
  return withTree(async (tree) => {
    await tree.ensureFolder(null);
  });
}

export interface SyncAllResult {
  folders: number;
  documents: number;
  failed: { title: string; message: string }[];
}

/** Mirrors every folder and uploads every document (for content created before Drive was on). */
export function syncEverything(): Promise<SyncAllResult> {
  return withTree(async (tree, fontFamily) => {
    const folders = await foldersRepo.listFolders();
    for (const f of folders) await tree.ensureFolder(f.id);

    const result: SyncAllResult = { folders: folders.length, documents: 0, failed: [] };
    for (const summary of await documentsRepo.listDocuments()) {
      const doc = await documentsRepo.findDocument(summary.id);
      if (!doc) continue;
      try {
        const fileId = await tree.uploadDocument({
          title: doc.title,
          html: toHtmlFile(doc, fontFamily),
          driveFileId: doc.driveFileId,
          folderId: doc.folderId,
        });
        await documentsRepo.markDriveSynced(doc.id, fileId);
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
export async function followUp(task: () => Promise<unknown>): Promise<string | undefined> {
  if (!(await isDriveSyncEnabled())) return undefined;
  try {
    await task();
    return undefined;
  } catch (err) {
    console.error("[drive] follow-up sync failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    return `Saved, but Google Drive wasn't updated: ${message}`;
  }
}
