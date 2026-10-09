import type { RowDataPacket } from "mysql2/promise";
import { getPool } from "../db/pool.js";

export interface StoredGoogleCredentials {
  accessTokenEnc: string | null;
  refreshTokenEnc: string | null;
  expiryDate: number | null;
  scope: string | null;
  accountEmail: string | null;
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

export async function getCredentials(): Promise<StoredGoogleCredentials | null> {
  const [rows] = await getPool().execute<CredentialsRow[]>(
    `SELECT access_token_enc, refresh_token_enc, expiry_date, scope, account_email, folder_id
       FROM google_credentials WHERE id = 1`,
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

/** Creates or replaces the singleton credentials row (on a fresh OAuth connection). */
export async function saveCredentials(c: StoredGoogleCredentials): Promise<void> {
  await getPool().execute(
    `INSERT INTO google_credentials
            (id, access_token_enc, refresh_token_enc, expiry_date, scope, account_email, folder_id, connected_at)
          VALUES (1, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) AS incoming
     ON DUPLICATE KEY UPDATE
            access_token_enc = incoming.access_token_enc,
            -- Google only returns a refresh token on first consent; keep the old one otherwise.
            refresh_token_enc = COALESCE(incoming.refresh_token_enc, google_credentials.refresh_token_enc),
            expiry_date = incoming.expiry_date,
            scope = incoming.scope,
            account_email = incoming.account_email,
            folder_id = incoming.folder_id,
            connected_at = CURRENT_TIMESTAMP`,
    [c.accessTokenEnc, c.refreshTokenEnc, c.expiryDate, c.scope, c.accountEmail, c.folderId],
  );
}

/** Persists refreshed tokens emitted by the OAuth client. */
export async function updateTokens(accessTokenEnc: string, expiryDate: number | null, refreshTokenEnc: string | null) {
  await getPool().execute(
    `UPDATE google_credentials
        SET access_token_enc = ?, expiry_date = ?, refresh_token_enc = COALESCE(?, refresh_token_enc)
      WHERE id = 1`,
    [accessTokenEnc, expiryDate, refreshTokenEnc],
  );
}

export async function setFolderId(folderId: string | null): Promise<void> {
  await getPool().execute("UPDATE google_credentials SET folder_id = ? WHERE id = 1", [folderId]);
}

export async function deleteCredentials(): Promise<void> {
  await getPool().execute("DELETE FROM google_credentials WHERE id = 1");
}
