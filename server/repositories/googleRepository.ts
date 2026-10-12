import type { RowDataPacket } from "mysql2/promise";
import { getPool } from "../db/pool.js";

/** A user's Google Drive connection (tokens are AES-256-GCM encrypted by the app). */
export interface StoredGoogleCredentials {
  accessTokenEnc: string | null;
  refreshTokenEnc: string | null;
  expiryDate: number | null;
  scope: string | null;
  accountEmail: string | null;
  /** The root Drive folder ("Olive Writer") documents are mirrored into. */
  folderId: string | null;
}

interface CredentialsRow extends RowDataPacket {
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  expiry_date: number | string | null;
  scope: string | null;
  account_email: string | null;
  folder_id: string | null;
}

export async function getCredentials(userId: string): Promise<StoredGoogleCredentials | null> {
  const [rows] = await getPool().execute<CredentialsRow[]>(
    `SELECT access_token_enc, refresh_token_enc, expiry_date, scope, account_email, folder_id
       FROM drive_connections WHERE user_id = ?`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    accessTokenEnc: row.access_token_enc,
    refreshTokenEnc: row.refresh_token_enc,
    // BIGINT may come back as a string depending on driver settings.
    expiryDate: row.expiry_date === null ? null : Number(row.expiry_date),
    scope: row.scope,
    accountEmail: row.account_email,
    folderId: row.folder_id,
  };
}

/** Creates or replaces the user's connection (on a fresh OAuth connection). */
export async function saveCredentials(userId: string, c: StoredGoogleCredentials): Promise<void> {
  await getPool().execute(
    `INSERT INTO drive_connections
            (user_id, access_token_enc, refresh_token_enc, expiry_date, scope, account_email, folder_id, connected_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) AS incoming
     ON DUPLICATE KEY UPDATE
            access_token_enc = incoming.access_token_enc,
            -- Google only returns a refresh token on first consent; keep the old one otherwise.
            refresh_token_enc = COALESCE(incoming.refresh_token_enc, drive_connections.refresh_token_enc),
            expiry_date = incoming.expiry_date,
            scope = incoming.scope,
            account_email = incoming.account_email,
            -- A different Google account has a different Drive: forget the old root folder.
            folder_id = IF(drive_connections.account_email <=> incoming.account_email, drive_connections.folder_id, NULL),
            connected_at = CURRENT_TIMESTAMP`,
    [userId, c.accessTokenEnc, c.refreshTokenEnc, c.expiryDate, c.scope, c.accountEmail, c.folderId],
  );
}

/** Persists refreshed tokens emitted by the OAuth client. */
export async function updateTokens(
  userId: string,
  accessTokenEnc: string,
  expiryDate: number | null,
  refreshTokenEnc: string | null,
): Promise<void> {
  await getPool().execute(
    `UPDATE drive_connections
        SET access_token_enc = ?, expiry_date = ?, refresh_token_enc = COALESCE(?, refresh_token_enc)
      WHERE user_id = ?`,
    [accessTokenEnc, expiryDate, refreshTokenEnc, userId],
  );
}

export async function setFolderId(userId: string, folderId: string | null): Promise<void> {
  await getPool().execute("UPDATE drive_connections SET folder_id = ? WHERE user_id = ?", [folderId, userId]);
}

export async function deleteCredentials(userId: string): Promise<void> {
  await getPool().execute("DELETE FROM drive_connections WHERE user_id = ?", [userId]);
}

export async function setLastPull(userId: string): Promise<void> {
  await getPool().execute("UPDATE drive_connections SET last_pull_at = CURRENT_TIMESTAMP WHERE user_id = ?", [userId]);
}

/** Users whose documents are mirrored to Drive (storage = Google Drive, and connected). */
export async function usersWithDriveSync(): Promise<string[]> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT c.user_id FROM drive_connections c
       JOIN user_settings s ON s.user_id = c.user_id
      WHERE s.storage_provider = 'google_drive' AND (c.refresh_token_enc IS NOT NULL OR c.access_token_enc IS NOT NULL)`,
  );
  return rows.map((r) => String(r.user_id));
}
