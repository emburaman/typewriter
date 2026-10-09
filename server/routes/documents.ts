import { Router, type Request } from "express";
import { randomUUID } from "node:crypto";
import {
  documentIdSchema,
  documentWriteSchema,
  type DocumentRecord,
  type DocumentSaveResult,
} from "../../lib/shared/schemas.js";
import { notFound } from "../errors.js";
import * as documentsRepo from "../repositories/documentsRepository.js";
import * as settingsRepo from "../repositories/settingsRepository.js";
import * as drive from "../services/googleDrive.js";

export const documentsRouter = Router();

const parseId = (req: Request<{ id: string }>) => documentIdSchema.parse(req.params.id);

async function requireDocument(id: string): Promise<DocumentRecord> {
  const doc = await documentsRepo.findDocument(id);
  if (!doc) throw notFound(`Document ${id} not found`);
  return doc;
}

/** Uploads to Drive when the storage provider says so. Drive failures never lose the server save. */
async function syncToDriveIfEnabled(doc: DocumentRecord, force = false): Promise<DocumentSaveResult> {
  const settings = await settingsRepo.getSettings();
  if (!force && settings.storageProvider !== "google_drive") {
    return { document: doc, drive: { status: "skipped" } };
  }
  try {
    const fileId = await drive.uploadDocument(doc, {
      folderName: settings.driveFolderName,
      fontFamily: settings.fontFamily,
    });
    await documentsRepo.markDriveSynced(doc.id, fileId);
    return { document: await requireDocument(doc.id), drive: { status: "synced" } };
  } catch (err) {
    console.error(`[documents] Drive sync failed for ${doc.id}:`, err);
    const message = err instanceof Error ? err.message : "Google Drive sync failed";
    return { document: doc, drive: { status: "failed", message } };
  }
}

/** GET /api/documents — summaries, most recently updated first. */
documentsRouter.get("/", async (_req, res) => {
  res.status(200).json(await documentsRepo.listDocuments());
});

/** POST /api/documents — create with a server-generated id. */
documentsRouter.post("/", async (req, res) => {
  const body = documentWriteSchema.parse(req.body ?? {});
  const id = randomUUID();
  await documentsRepo.upsertDocument(id, body);
  const result = await syncToDriveIfEnabled(await requireDocument(id));
  res.status(201).location(`/api/documents/${id}`).json(result);
});

/** GET /api/documents/:id */
documentsRouter.get("/:id", async (req, res) => {
  res.status(200).json(await requireDocument(parseId(req)));
});

/**
 * PUT /api/documents/:id — create-or-replace (201 when created, 200 when updated).
 * Ids are client-generated so a browser-only draft keeps its identity once saved.
 */
documentsRouter.put("/:id", async (req, res) => {
  const id = parseId(req);
  const body = documentWriteSchema.parse(req.body);
  const { created } = await documentsRepo.upsertDocument(id, body);
  const result = await syncToDriveIfEnabled(await requireDocument(id));
  res.status(created ? 201 : 200).json(result);
});

/** POST /api/documents/:id/drive-sync — upload to Drive now, regardless of storage provider. */
documentsRouter.post("/:id/drive-sync", async (req, res) => {
  const doc = await requireDocument(parseId(req));
  const result = await syncToDriveIfEnabled(doc, true);
  res.status(result.drive.status === "synced" ? 200 : 502).json(result);
});

/** DELETE /api/documents/:id — removes the server copy (the Drive copy is left untouched). */
documentsRouter.delete("/:id", async (req, res) => {
  const deleted = await documentsRepo.deleteDocument(parseId(req));
  if (!deleted) throw notFound();
  res.status(204).end();
});
