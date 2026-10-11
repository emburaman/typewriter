import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool } from "../db/pool.js";
import type { Folder } from "../../lib/shared/schemas.js";

interface FolderRow extends RowDataPacket {
  id: string;
  name: string;
  parent_id: string | null;
  drive_folder_id: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToFolder(row: FolderRow): Folder {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listFolders(userId: string): Promise<Folder[]> {
  const [rows] = await getPool().execute<FolderRow[]>("SELECT * FROM folders WHERE user_id = ? ORDER BY name", [userId]);
  return rows.map(rowToFolder);
}

export async function findFolder(userId: string, id: string): Promise<Folder | null> {
  const [rows] = await getPool().execute<FolderRow[]>("SELECT * FROM folders WHERE id = ? AND user_id = ?", [id, userId]);
  const row = rows[0];
  return row ? rowToFolder(row) : null;
}

export async function createFolder(userId: string, id: string, name: string, parentId: string | null): Promise<void> {
  await getPool().execute("INSERT INTO folders (id, user_id, name, parent_id) VALUES (?, ?, ?, ?)", [id, userId, name, parentId]);
}

/**
 * True when `candidateParentId` is `folderId` itself or one of its descendants — i.e. moving
 * `folderId` there would create a cycle. Walks up from the candidate with a recursive CTE.
 */
export async function wouldCreateCycle(folderId: string, candidateParentId: string): Promise<boolean> {
  const [rows] = await getPool().execute<RowDataPacket[]>(
    `WITH RECURSIVE ancestors (id, parent_id) AS (
       SELECT id, parent_id FROM folders WHERE id = ?
       UNION ALL
       SELECT f.id, f.parent_id FROM folders f JOIN ancestors a ON f.id = a.parent_id
     )
     SELECT 1 FROM ancestors WHERE id = ? LIMIT 1`,
    [candidateParentId, folderId],
  );
  return rows.length > 0;
}

export async function updateFolder(userId: string, id: string, fields: { name?: string; parentId?: string | null }): Promise<void> {
  const sets: string[] = [];
  const values: (string | null)[] = [];
  if (fields.name !== undefined) {
    sets.push("name = ?");
    values.push(fields.name);
  }
  if (fields.parentId !== undefined) {
    sets.push("parent_id = ?");
    values.push(fields.parentId);
  }
  if (sets.length === 0) return;
  await getPool().execute(`UPDATE folders SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`, [...values, id, userId]);
}

/**
 * Deletes a folder. Its sub-folders and documents move up to the folder's parent first,
 * all in one transaction, so deleting a folder never deletes any writing.
 */
export async function deleteFolder(userId: string, id: string): Promise<boolean> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute<FolderRow[]>("SELECT * FROM folders WHERE id = ? AND user_id = ? FOR UPDATE", [id, userId]);
    const folder = rows[0];
    if (!folder) {
      await conn.rollback();
      return false;
    }
    await conn.execute("UPDATE folders SET parent_id = ? WHERE parent_id = ? AND user_id = ?", [folder.parent_id, id, userId]);
    await conn.execute("UPDATE documents SET folder_id = ?, updated_at = updated_at WHERE folder_id = ? AND user_id = ?", [
      folder.parent_id,
      id,
      userId,
    ]);
    const [result] = await conn.execute<ResultSetHeader>("DELETE FROM folders WHERE id = ?", [id]);
    await conn.commit();
    return result.affectedRows > 0;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** Folder fields needed to mirror it in Google Drive. */
export interface FolderDriveRow {
  id: string;
  name: string;
  parentId: string | null;
  driveFolderId: string | null;
}

export async function findFolderForDrive(userId: string, id: string): Promise<FolderDriveRow | null> {
  const [rows] = await getPool().execute<FolderRow[]>("SELECT * FROM folders WHERE id = ? AND user_id = ?", [id, userId]);
  const row = rows[0];
  return row ? { id: row.id, name: row.name, parentId: row.parent_id, driveFolderId: row.drive_folder_id } : null;
}

export async function setDriveFolderId(userId: string, id: string, driveFolderId: string | null): Promise<void> {
  await getPool().execute("UPDATE folders SET drive_folder_id = ?, updated_at = updated_at WHERE id = ? AND user_id = ?", [
    driveFolderId,
    id,
    userId,
  ]);
}
