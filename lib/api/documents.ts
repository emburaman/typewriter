import type {
  DocumentRecord,
  DocumentSaveResult,
  DocumentSummary,
  DocumentWrite,
  TrashedDocument,
  WithDriveWarning,
} from "@/lib/shared/schemas";

import { request } from "./client";

export const listDocuments = () => request<DocumentSummary[]>("GET", "/documents");
export const getDocument = (id: string) => request<DocumentRecord>("GET", `/documents/${encodeURIComponent(id)}`);
export const createDocument = (doc: DocumentWrite) => request<DocumentSaveResult>("POST", "/documents", doc);
/** Create-or-replace by client-generated id. */
export const saveDocument = (id: string, doc: DocumentWrite) =>
  request<DocumentSaveResult>("PUT", `/documents/${encodeURIComponent(id)}`, doc);
/** Moves a document to the Trash (and its Drive file to Drive's trash). */
export const deleteDocument = (id: string) =>
  request<{ driveWarning?: string } | undefined>("DELETE", `/documents/${encodeURIComponent(id)}`);
export const listTrash = () => request<TrashedDocument[]>("GET", "/documents/trash");
export const restoreDocument = (id: string) =>
  request<WithDriveWarning<DocumentRecord>>("POST", `/documents/trash/${encodeURIComponent(id)}/restore`);
export const deleteForever = (id: string) => request<void>("DELETE", `/documents/trash/${encodeURIComponent(id)}`);
export const syncDocumentToDrive = (id: string) =>
  request<DocumentSaveResult>("POST", `/documents/${encodeURIComponent(id)}/drive-sync`);
/** Moves a document to a folder (`null` = top level). */
export const moveDocument = (id: string, folderId: string | null) =>
  request<WithDriveWarning<DocumentRecord>>("PATCH", `/documents/${encodeURIComponent(id)}`, { folderId });
