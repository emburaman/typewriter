import { Router, type Request } from "express";
import { randomUUID } from "node:crypto";
import {
  documentIdSchema,
  documentMoveSchema,
  documentWriteSchema,
  type DocumentRecord,
  type DocumentSaveResult,
} from "../../lib/shared/schemas.js";
import { badRequest, notFound } from "../errors.js";
import * as documentsRepo from "../repositories/documentsRepository.js";
import * as foldersRepo from "../repositories/foldersRepository.js";
import * as settingsRepo from "../repositories/settingsRepository.js";
import { currentUser } from "../services/auth.js";
import * as driveSync from "../services/driveSync.js";

/** All routes act on the signed-in user's documents only (mounted behind requireAuth). */
export const documentsRouter = Router();

const parseId = (req: Request<{ id: string }>) => documentIdSchema.parse(req.params.id);

async function requireDocument(userId: string, id: string): Promise<DocumentRecord> {
  const doc = await documentsRepo.findDocument(userId, id);
  if (!doc) throw notFound(`Document ${id} not found`);
  return doc;
}

async function requireFolder(userId: string, folderId: string | null | undefined): Promise<void> {
  if (folderId && !(await foldersRepo.findFolder(userId, folderId))) throw badRequest(`Folder ${folderId} does not exist`);
}

/** Uploads to Drive when the storage provider says so. Drive failures never lose the server save. */
async function syncToDriveIfEnabled(userId: string, doc: DocumentRecord, force = false): Promise<DocumentSaveResult> {
  const settings = await settingsRepo.getSettings(userId);
  if (!force && settings.storageProvider !== "google_drive") {
    return { document: doc, drive: { status: "skipped" } };
  }
  try {
    await driveSync.uploadDocument(userId, doc);
    return { document: await requireDocument(userId, doc.id), drive: { status: "synced" } };
  } catch (err) {
    console.error(`[documents] Drive sync failed for ${doc.id}:`, err);
    const message = err instanceof Error ? err.message : "Google Drive sync failed";
    return { document: doc, drive: { status: "failed", message } };
  }
}

/** GET /api/documents — the user's documents (summaries), sorted by title. */
documentsRouter.get("/", async (req, res) => {
  res.status(200).json(await documentsRepo.listDocuments(currentUser(req).id));
});

/** POST /api/documents — create with a server-generated id. */
documentsRouter.post("/", async (req, res) => {
  const user = currentUser(req);
  const body = documentWriteSchema.parse(req.body ?? {});
  await requireFolder(user.id, body.folderId);
  const id = randomUUID();
  await documentsRepo.upsertDocument(user.id, id, body);
  const result = await syncToDriveIfEnabled(user.id, await requireDocument(user.id, id));
  res.status(201).location(`/api/documents/${id}`).json(result);
});

/** GET /api/documents/:id */
documentsRouter.get("/:id", async (req, res) => {
  res.status(200).json(await requireDocument(currentUser(req).id, parseId(req)));
});

/**
 * PUT /api/documents/:id — create-or-replace (201 when created, 200 when updated).
 * Ids are client-generated so a browser-only draft keeps its identity once saved.
 * `folderId` is only applied when the document is created; use PATCH to move it later.
 * An id that belongs to another user is reported as not found (and never overwritten).
 */
documentsRouter.put("/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req);
  const body = documentWriteSchema.parse(req.body);
  await requireFolder(user.id, body.folderId);
  const { created, taken } = await documentsRepo.upsertDocument(user.id, id, body);
  if (taken) throw notFound(`Document ${id} not found`);
  const result = await syncToDriveIfEnabled(user.id, await requireDocument(user.id, id));
  res.status(created ? 201 : 200).json(result);
});

/** PATCH /api/documents/:id — move to another folder (`folderId: null` = top level). */
documentsRouter.patch("/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req);
  const { folderId } = documentMoveSchema.parse(req.body);
  await requireFolder(user.id, folderId);
  if (!(await documentsRepo.moveDocument(user.id, id, folderId))) throw notFound(`Document ${id} not found`);
  const doc = await requireDocument(user.id, id);
  const driveWarning = await driveSync.followUp(user.id, () => driveSync.syncDocumentLocation(user.id, doc));
  res.status(200).json({ ...doc, driveWarning });
});

/** POST /api/documents/:id/drive-sync — upload to Drive now, regardless of storage provider. */
documentsRouter.post("/:id/drive-sync", async (req, res) => {
  const user = currentUser(req);
  const doc = await requireDocument(user.id, parseId(req));
  const result = await syncToDriveIfEnabled(user.id, doc, true);
  res.status(result.drive.status === "synced" ? 200 : 502).json(result);
});

/** DELETE /api/documents/:id — removes the server copy (the Drive copy is left untouched). */
documentsRouter.delete("/:id", async (req, res) => {
  const deleted = await documentsRepo.deleteDocument(currentUser(req).id, parseId(req));
  if (!deleted) throw notFound();
  res.status(204).end();
});
