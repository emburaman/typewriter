import type {
  DocumentRecord,
  DocumentSaveResult,
  DocumentSummary,
  DocumentWrite,
  WithDriveWarning,
} from "@/lib/shared/schemas";

import { request } from "./client";

export const listDocuments = () => request<DocumentSummary[]>("GET", "/documents");
export const getDocument = (id: string) => request<DocumentRecord>("GET", `/documents/${encodeURIComponent(id)}`);
export const createDocument = (doc: DocumentWrite) => request<DocumentSaveResult>("POST", "/documents", doc);
/** Create-or-replace by client-generated id. */
export const saveDocument = (id: string, doc: DocumentWrite) =>
  request<DocumentSaveResult>("PUT", `/documents/${encodeURIComponent(id)}`, doc);
export const deleteDocument = (id: string) => request<void>("DELETE", `/documents/${encodeURIComponent(id)}`);
export const syncDocumentToDrive = (id: string) =>
  request<DocumentSaveResult>("POST", `/documents/${encodeURIComponent(id)}/drive-sync`);
/** Moves a document to a folder (`null` = top level). */
export const moveDocument = (id: string, folderId: string | null) =>
  request<WithDriveWarning<DocumentRecord>>("PATCH", `/documents/${encodeURIComponent(id)}`, { folderId });
