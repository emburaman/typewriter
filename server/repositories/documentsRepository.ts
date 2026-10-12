import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { getPool } from "../db/pool.js";
import type { ImportedContent, SyncDoc } from "../services/drivePull.js";
import type { DocumentRecord, DocumentSummary, EditorJson, TrashedDocument } from "../../lib/shared/schemas.js";

interface DocumentRow extends RowDataPacket {
  id: string;
  title: string;
  folder_id: string | null;
  content_json: unknown;
  content_html: string;
  content_source: "json" | "html";
  deleted_at: Date | null;
  drive_version: number | string | null;
  drive_content_hash: string | null;
  drive_synced_revision: number | null;
  drive_account: string | null;
  word_count: number;
  revision: number;
  drive_file_id: string | null;
  drive_synced_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function rowToSummary(row: DocumentRow): DocumentSummary {
  return {
    id: row.id,
    title: row.title,
    folderId: row.folder_id,
    wordCount: row.word_count,
    updatedAt: row.updated_at.toISOString(),
    driveFileId: row.drive_file_id,
    driveSyncedAt: iso(row.drive_synced_at),
  };
}

function rowToRecord(row: DocumentRow): DocumentRecord {
  return {
    ...rowToSummary(row),
    contentJson: row.content_json as EditorJson,
    revision: row.revision,
    contentHtml: row.content_html,
    contentSource: row.content_source,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listDocuments(userId: string): Promise<DocumentSummary[]> {
  const [rows] = await getPool().execute<DocumentRow[]>(
    `SELECT id, title, folder_id, word_count, drive_file_id, drive_synced_at, updated_at
       FROM documents WHERE user_id = ? AND deleted_at IS NULL ORDER BY title, updated_at DESC`,
    [userId],
  );
  return rows.map(rowToSummary);
}

export async function findDocument(userId: string, id: string): Promise<DocumentRecord | null> {
  const [rows] = await getPool().execute<DocumentRow[]>(
    "SELECT * FROM documents WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
    [id, userId],
  );
  const row = rows[0];
  return row ? rowToRecord(row) : null;
}

export interface DocumentFields {
  title: string;
  /** Applied only when the row is inserted; moving is a separate operation. */
  folderId?: string | null;
  contentJson: EditorJson;
  contentHtml: string;
  wordCount: number;
  /** See documentWriteSchema.baseRevision: undefined = no check, null = expected to be new. */
  baseRevision?: number | null;
  /**
   * The edit only re-encodes content pulled from Google Docs (HTML → editor JSON): if app and
   * Drive were in sync before, they still are, so this must not count as an app-side change.
   */
  sameAsDrive?: boolean;
}

export type UpsertResult =
  | { status: "created" | "updated" }
  /** The id belongs to another user (reported as not found, never overwritten). */
  | { status: "taken" }
  /** Another device saved since `baseRevision`; nothing was written. */
  | { status: "conflict" };

/**
 * Inserts or updates one of the user's documents. Ids are client-generated UUIDs so a draft
 * can exist in the browser before it reaches the server. If the id already belongs to another
 * user the call is refused (`taken`) — a known id never gives access to someone else's writing.
 */
export async function upsertDocument(
  userId: string,
  id: string,
  fields: DocumentFields,
): Promise<UpsertResult> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.execute<RowDataPacket[]>("SELECT user_id, revision FROM documents WHERE id = ? FOR UPDATE", [
      id,
    ]);
    const row = existing[0];
    const json = JSON.stringify(fields.contentJson);
    if (row && row.user_id !== userId) {
      await conn.rollback();
      return { status: "taken" };
    }
    // Optimistic concurrency: the row is locked, so this check and the write are atomic.
    const base = fields.baseRevision;
    if (base !== undefined && (row ? base !== Number(row.revision) : base !== null)) {
      await conn.rollback();
      return { status: "conflict" };
    }
    if (row) {
      // Saving a document that sits in the Trash brings it back (edits beat deletions).
      // drive_synced_revision is assigned before revision, so it sees the old revision.
      await conn.execute(
        `UPDATE documents SET title = ?, content_json = ?, content_html = ?, content_source = 'json', word_count = ?,
                drive_synced_revision = IF(? AND drive_synced_revision = revision, revision + 1, drive_synced_revision),
                revision = revision + 1, deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND user_id = ?`,
        [fields.title, json, fields.contentHtml, fields.wordCount, fields.sameAsDrive ? 1 : 0, id, userId],
      );
    } else {
      await conn.execute(
        `INSERT INTO documents (id, user_id, title, folder_id, content_json, content_html, word_count)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, userId, fields.title, fields.folderId ?? null, json, fields.contentHtml, fields.wordCount],
      );
    }
    await conn.commit();
    return { status: row ? "updated" : "created" };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** After uploading `revision` of a document to Drive: remember what Drive now holds. */
export async function markPushed(
  userId: string,
  id: string,
  state: { fileId: string; version: number; contentHash: string; revision: number; account: string | null },
): Promise<void> {
  await getPool().execute(
    `UPDATE documents
        SET drive_file_id = ?, drive_version = ?, drive_content_hash = ?, drive_synced_revision = ?, drive_account = ?,
            drive_synced_at = CURRENT_TIMESTAMP, updated_at = updated_at
      WHERE id = ? AND user_id = ?`,
    [state.fileId, state.version, state.contentHash, state.revision, state.account, id, userId],
  );
}

/** Moves a document to a folder (null = top level). Doesn't bump `updated_at`. */
export async function moveDocument(userId: string, id: string, folderId: string | null): Promise<boolean> {
  const [result] = await getPool().execute<ResultSetHeader>(
    "UPDATE documents SET folder_id = ?, updated_at = updated_at WHERE id = ? AND user_id = ?",
    [folderId, id, userId],
  );
  return result.affectedRows > 0;
}

/* ------------------------------- Trash ------------------------------- */

/** Moves a document to the app's Trash (restorable; purged after TRASH_DAYS). */
export async function trashDocument(userId: string, id: string): Promise<boolean> {
  const [result] = await getPool().execute<ResultSetHeader>(
    "UPDATE documents SET deleted_at = CURRENT_TIMESTAMP, updated_at = updated_at WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
    [id, userId],
  );
  return result.affectedRows > 0;
}

export async function restoreDocument(userId: string, id: string): Promise<boolean> {
  const [result] = await getPool().execute<ResultSetHeader>(
    "UPDATE documents SET deleted_at = NULL, updated_at = updated_at WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL",
    [id, userId],
  );
  return result.affectedRows > 0;
}

/** Permanently deletes a document that is already in the Trash. */
export async function deleteForever(userId: string, id: string): Promise<boolean> {
  const [result] = await getPool().execute<ResultSetHeader>(
    "DELETE FROM documents WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL",
    [id, userId],
  );
  return result.affectedRows > 0;
}

export const TRASH_DAYS = 30;

export async function purgeOldTrash(): Promise<number> {
  const [result] = await getPool().execute<ResultSetHeader>(
    `DELETE FROM documents WHERE deleted_at IS NOT NULL AND deleted_at < CURRENT_TIMESTAMP - INTERVAL ${TRASH_DAYS} DAY`,
  );
  return result.affectedRows;
}

export async function listTrash(userId: string): Promise<TrashedDocument[]> {
  const [rows] = await getPool().execute<DocumentRow[]>(
    `SELECT id, title, folder_id, word_count, drive_file_id, drive_synced_at, updated_at, deleted_at
       FROM documents WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
    [userId],
  );
  return rows.map((r) => ({ ...rowToSummary(r), deletedAt: (r.deleted_at as Date).toISOString() }));
}

/* ------------------------- Drive → app (pull) ------------------------- */

/** Every document with its sync bookkeeping (including those in the Trash). */
export async function listForSync(userId: string): Promise<SyncDoc[]> {
  const [rows] = await getPool().execute<DocumentRow[]>(
    `SELECT id, title, folder_id, revision, deleted_at, drive_file_id, drive_version, drive_content_hash,
            drive_synced_revision, drive_account
       FROM documents WHERE user_id = ?`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    folderId: r.folder_id,
    revision: r.revision,
    deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
    driveFileId: r.drive_file_id,
    driveVersion: r.drive_version === null ? null : Number(r.drive_version),
    driveContentHash: r.drive_content_hash,
    driveSyncedRevision: r.drive_synced_revision,
    driveAccount: r.drive_account,
  }));
}

/** Rough word count of HTML (for documents pulled from Google Docs). */
export function wordsInHtml(html: string): number {
  const text = html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ");
  return (text.match(/\S+/g) ?? []).length;
}

/** Replaces content with the Google Docs version (opened in the editor, it is converted to JSON). */
export async function importContent(userId: string, id: string, c: ImportedContent): Promise<void> {
  await getPool().execute(
    `UPDATE documents
        SET title = ?, content_html = ?, content_source = 'html', word_count = ?,
            drive_version = ?, drive_content_hash = ?, drive_synced_revision = revision + 1,
            revision = revision + 1, drive_synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?`,
    [c.title, c.html, wordsInHtml(c.html), c.driveVersion, c.contentHash, id, userId],
  );
}

export async function createFromDrive(
  userId: string,
  c: ImportedContent & { folderId: string | null; driveFileId: string | null; account: string },
): Promise<string> {
  const id = randomUUID();
  await getPool().execute(
    `INSERT INTO documents
            (id, user_id, title, folder_id, content_json, content_html, content_source, word_count, revision,
             drive_file_id, drive_version, drive_content_hash, drive_synced_revision, drive_account, drive_synced_at)
     VALUES (?, ?, ?, ?, ?, ?, 'html', ?, 1, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      c.title,
      c.folderId,
      JSON.stringify({ type: "doc", content: [] }),
      c.html,
      wordsInHtml(c.html),
      c.driveFileId,
      c.driveFileId ? c.driveVersion : null,
      c.driveFileId ? c.contentHash : null,
      c.driveFileId ? 1 : null,
      c.driveFileId ? c.account : null,
      c.driveFileId ? new Date() : null,
    ],
  );
  return id;
}

/** Title renamed in Drive. Counts as an update (other devices refresh) but not as an app-side edit. */
export async function setTitleFromDrive(userId: string, id: string, title: string): Promise<void> {
  await getPool().execute(
    `UPDATE documents
        SET title = ?, drive_synced_revision = IF(drive_synced_revision = revision, revision + 1, drive_synced_revision),
            revision = revision + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?`,
    [title, id, userId],
  );
}

export async function markInSync(userId: string, id: string, s: { driveVersion: number; contentHash?: string }): Promise<void> {
  await getPool().execute(
    `UPDATE documents
        SET drive_version = ?, drive_content_hash = COALESCE(?, drive_content_hash),
            drive_synced_revision = COALESCE(drive_synced_revision, revision), updated_at = updated_at
      WHERE id = ? AND user_id = ?`,
    [s.driveVersion, s.contentHash ?? null, id, userId],
  );
}

/** Forgets the Drive file (the next upload creates a fresh one). */
export async function unlinkDrive(userId: string, id: string): Promise<void> {
  await getPool().execute(
    `UPDATE documents
        SET drive_file_id = NULL, drive_version = NULL, drive_content_hash = NULL, drive_synced_revision = NULL,
            drive_account = NULL, updated_at = updated_at
      WHERE id = ? AND user_id = ?`,
    [id, userId],
  );
}
