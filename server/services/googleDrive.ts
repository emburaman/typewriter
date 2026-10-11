import { Readable } from "node:stream";
import { google, type Auth } from "googleapis";
import { config } from "../config.js";
import { HttpError } from "../errors.js";
import { decrypt, encrypt } from "./crypto.js";
import { escapeHtml, replaceEmbedsWithLinks } from "./driveHtml.js";
import { DRIVE_FILE_SCOPE, hasDriveScope, MISSING_DRIVE_ACCESS_MESSAGE } from "./googleScopes.js";
import type { DriveApi } from "./driveTree.js";
import { createOAuthClient, issueState } from "./oauth.js";
import * as googleRepo from "../repositories/googleRepository.js";
import type { DocumentRecord, GoogleStatus } from "../../lib/shared/schemas.js";

/**
 * `drive.file` only grants access to files this app creates — the least privilege
 * that still lets us create a folder and write documents into it.
 */
const SCOPES = [DRIVE_FILE_SCOPE, "https://www.googleapis.com/auth/userinfo.email", "openid"];
const FOLDER_MIME = "application/vnd.google-apps.folder";
const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";

function requireDriveConfigured(): Buffer {
  if (!config.google.configured || !config.encryptionKey) {
    throw new HttpError(
      400,
      "google_not_configured",
      "Google Drive is not configured on the server. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and TOKEN_ENCRYPTION_KEY.",
    );
  }
  return config.encryptionKey;
}

export async function getStatus(userId: string): Promise<GoogleStatus> {
  const creds = config.google.configured ? await googleRepo.getCredentials(userId) : null;
  return {
    configured: config.google.configured,
    connected: Boolean(creds?.refreshTokenEnc || creds?.accessTokenEnc),
    driveAccess: hasDriveScope(creds?.scope),
    accountEmail: creds?.accountEmail ?? null,
    folderId: creds?.folderId ?? null,
  };
}

/** Consent URL for connecting this user's Google Drive. */
export function createAuthUrl(userId: string): string {
  requireDriveConfigured();
  return createOAuthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // guarantees a refresh token on every connection
    scope: SCOPES,
    state: issueState({ kind: "drive", userId }),
    include_granted_scopes: true,
  });
}

/** Second half of the Drive connection: exchange the code and store this user's encrypted tokens. */
export async function completeDriveConnection(userId: string, code: string): Promise<void> {
  const key = requireDriveConfigured();
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!hasDriveScope(tokens.scope)) {
    // The person unticked the Drive permission: don't store a connection that can't upload.
    const token = tokens.refresh_token ?? tokens.access_token;
    if (token) {
      await client.revokeToken(token).catch((err: unknown) => {
        console.warn("[google] could not revoke partial grant:", err instanceof Error ? err.message : err);
      });
    }
    throw new HttpError(400, "drive_scope_missing", MISSING_DRIVE_ACCESS_MESSAGE);
  }
  client.setCredentials(tokens);
  const { data: user } = await google.oauth2({ version: "v2", auth: client }).userinfo.get();

  await googleRepo.saveCredentials(userId, {
    accessTokenEnc: tokens.access_token ? encrypt(tokens.access_token, key) : null,
    refreshTokenEnc: tokens.refresh_token ? encrypt(tokens.refresh_token, key) : null,
    expiryDate: tokens.expiry_date ?? null,
    scope: tokens.scope ?? null,
    accountEmail: user.email ?? null,
    folderId: null,
  });
}

/** Builds an OAuth client from the user's stored credentials; refreshed tokens are persisted. */
async function getAuthorizedClient(userId: string): Promise<Auth.OAuth2Client> {
  const key = requireDriveConfigured();
  const creds = await googleRepo.getCredentials(userId);
  if (!creds || (!creds.accessTokenEnc && !creds.refreshTokenEnc)) {
    throw new HttpError(409, "google_not_connected", "Google Drive is not connected. Connect it in Settings.");
  }
  const client = createOAuthClient();
  client.setCredentials({
    access_token: creds.accessTokenEnc ? decrypt(creds.accessTokenEnc, key) : null,
    refresh_token: creds.refreshTokenEnc ? decrypt(creds.refreshTokenEnc, key) : null,
    expiry_date: creds.expiryDate,
  });
  client.on("tokens", (t) => {
    if (!t.access_token) return;
    googleRepo
      .updateTokens(userId, encrypt(t.access_token, key), t.expiry_date ?? null, t.refresh_token ? encrypt(t.refresh_token, key) : null)
      .catch((err: unknown) => console.error("[google] failed to persist refreshed tokens:", err));
  });
  return client;
}

/** Escapes a value for use inside a single-quoted Drive query string. */
const escapeQuery = (v: string) => v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && Number((err as { code: unknown }).code) === 404;
}

/** Wraps an HTML body as a full document for Google Docs conversion. */
export function toHtmlFile(doc: Pick<DocumentRecord, "title" | "contentHtml">, fontFamily: string): string {
  const title = escapeHtml(doc.title);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>` +
    `<body style="font-family: '${fontFamily}', monospace;">${replaceEmbedsWithLinks(doc.contentHtml)}</body></html>`;
}

/** The `DriveApi` used by the folder-tree sync, backed by the real Google Drive API. */
export async function createDriveApi(userId: string): Promise<DriveApi> {
  const client = await getAuthorizedClient(userId);
  const drive = google.drive({ version: "v3", auth: client });
  const html = (body: string) => ({ mimeType: "text/html", body: Readable.from([body]) });

  return {
    async get(id) {
      try {
        const { data } = await drive.files.get({ fileId: id, fields: "id, name, parents, trashed" });
        return data.id ? { id: data.id, name: data.name ?? "", parents: data.parents ?? [], trashed: Boolean(data.trashed) } : null;
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },
    async findRootFolder(name) {
      const { data } = await drive.files.list({
        q: `mimeType = '${FOLDER_MIME}' and name = '${escapeQuery(name)}' and 'root' in parents and trashed = false`,
        fields: "files(id)",
        spaces: "drive",
        pageSize: 1,
      });
      return data.files?.[0]?.id ?? null;
    },
    async createFolder(name, parentId) {
      const { data } = await drive.files.create({
        requestBody: { name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) },
        fields: "id",
      });
      if (!data.id) throw new HttpError(502, "google_drive_error", "Google Drive did not return a folder id");
      return data.id;
    },
    async update(id, change) {
      await drive.files.update({
        fileId: id,
        requestBody: change.name ? { name: change.name } : {},
        addParents: change.addParent,
        removeParents: change.removeParents?.length ? change.removeParents.join(",") : undefined,
        fields: "id",
      });
    },
    async listChildren(folderId) {
      const ids: string[] = [];
      let pageToken: string | undefined;
      do {
        const { data } = await drive.files.list({
          q: `'${escapeQuery(folderId)}' in parents and trashed = false`,
          fields: "nextPageToken, files(id)",
          pageSize: 1000,
          pageToken,
        });
        for (const f of data.files ?? []) if (f.id) ids.push(f.id);
        pageToken = data.nextPageToken ?? undefined;
      } while (pageToken);
      return ids;
    },
    async trash(id) {
      await drive.files.update({ fileId: id, requestBody: { trashed: true }, fields: "id" });
    },
    async createDoc(name, parentId, body) {
      const { data } = await drive.files.create({
        requestBody: { name, mimeType: GOOGLE_DOC_MIME, parents: [parentId] },
        media: html(body),
        fields: "id",
      });
      if (!data.id) throw new HttpError(502, "google_drive_error", "Google Drive did not return a file id");
      return data.id;
    },
    async updateDoc(id, name, body) {
      try {
        await drive.files.update({ fileId: id, requestBody: { name }, media: html(body), fields: "id" });
        return true;
      } catch (err) {
        if (isNotFound(err)) return false;
        throw err;
      }
    },
  };
}

/** Whether Drive is configured, connected, and was granted Drive access. */
export async function isConnectedWithDriveAccess(userId: string): Promise<boolean> {
  const status = await getStatus(userId);
  return status.configured && status.connected && status.driveAccess;
}

/** Revokes the user's token at Google (best effort) and deletes their stored credentials. */
export async function disconnect(userId: string): Promise<void> {
  const key = requireDriveConfigured();
  const creds = await googleRepo.getCredentials(userId);
  const tokenEnc = creds?.refreshTokenEnc ?? creds?.accessTokenEnc;
  if (tokenEnc) {
    try {
      await createOAuthClient().revokeToken(decrypt(tokenEnc, key));
    } catch (err) {
      // Revocation can fail if the user already removed access in their Google account;
      // the local credentials are deleted regardless.
      console.warn("[google] token revocation failed:", err instanceof Error ? err.message : err);
    }
  }
  await googleRepo.deleteCredentials(userId);
}
