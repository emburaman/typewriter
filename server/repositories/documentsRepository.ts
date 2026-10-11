import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool } from "../db/pool.js";
import type { DocumentRecord, DocumentSummary, EditorJson } from "../../lib/shared/schemas.js";

interface DocumentRow extends RowDataPacket {
  id: string;
  title: string;
  folder_id: string | null;
  content_json: unknown;
  content_html: string;
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
    createdAt: row.created_at.toISOString(),
  };
}

export async function listDocuments(userId: string): Promise<DocumentSummary[]> {
  const [rows] = await getPool().execute<DocumentRow[]>(
    `SELECT id, title, folder_id, word_count, drive_file_id, drive_synced_at, updated_at
       FROM documents WHERE user_id = ? ORDER BY title, updated_at DESC`,
    [userId],
  );
  return rows.map(rowToSummary);
}

export async function findDocument(userId: string, id: string): Promise<DocumentRecord | null> {
  const [rows] = await getPool().execute<DocumentRow[]>("SELECT * FROM documents WHERE id = ? AND user_id = ?", [id, userId]);
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
      await conn.execute(
        `UPDATE documents SET title = ?, content_json = ?, content_html = ?, word_count = ?,
                revision = revision + 1, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND user_id = ?`,
        [fields.title, json, fields.contentHtml, fields.wordCount, id, userId],
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

export async function markDriveSynced(userId: string, id: string, driveFileId: string): Promise<void> {
  await getPool().execute(
    `UPDATE documents SET drive_file_id = ?, drive_synced_at = CURRENT_TIMESTAMP, updated_at = updated_at
      WHERE id = ? AND user_id = ?`,
    [driveFileId, id, userId],
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

export async function deleteDocument(userId: string, id: string): Promise<boolean> {
  const [result] = await getPool().execute<ResultSetHeader>("DELETE FROM documents WHERE id = ? AND user_id = ?", [id, userId]);
  return result.affectedRows > 0;
}
