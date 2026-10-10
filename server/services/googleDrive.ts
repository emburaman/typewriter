import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { google, type Auth, type drive_v3 } from "googleapis";
import { config } from "../config.js";
import { HttpError } from "../errors.js";
import { decrypt, encrypt } from "./crypto.js";
import { escapeHtml, replaceEmbedsWithLinks } from "./driveHtml.js";
import * as googleRepo from "../repositories/googleRepository.js";
import type { DocumentRecord, GoogleStatus } from "../../lib/shared/schemas.js";

/**
 * `drive.file` only grants access to files this app creates — the least privilege
 * that still lets us create a folder and write documents into it.
 */
const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];
const FOLDER_MIME = "application/vnd.google-apps.folder";
const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
const STATE_TTL_MS = 10 * 60 * 1000;

/** Pending OAuth `state` values (CSRF protection). Single process, so memory is enough. */
const pendingStates = new Map<string, number>();

function requireConfigured(): Buffer {
  if (!config.google.configured || !config.encryptionKey) {
    throw new HttpError(
      400,
      "google_not_configured",
      "Google Drive is not configured on the server. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and TOKEN_ENCRYPTION_KEY.",
    );
  }
  return config.encryptionKey;
}

function createOAuthClient(): Auth.OAuth2Client {
  return new google.auth.OAuth2(config.google.clientId, config.google.clientSecret, config.google.redirectUri);
}

export async function getStatus(): Promise<GoogleStatus> {
  const creds = config.google.configured ? await googleRepo.getCredentials() : null;
  return {
    configured: config.google.configured,
    connected: Boolean(creds?.refreshTokenEnc || creds?.accessTokenEnc),
    accountEmail: creds?.accountEmail ?? null,
    folderId: creds?.folderId ?? null,
  };
}

export function createAuthUrl(): string {
  requireConfigured();
  const now = Date.now();
  for (const [s, expires] of pendingStates) if (expires < now) pendingStates.delete(s);

  const state = randomBytes(24).toString("base64url");
  pendingStates.set(state, now + STATE_TTL_MS);
  return createOAuthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // guarantees a refresh token on every connection
    scope: SCOPES,
    state,
    include_granted_scopes: true,
  });
}

/** Exchanges the authorization code, stores encrypted tokens and the account email. */
export async function handleCallback(code: string, state: string): Promise<void> {
  const key = requireConfigured();
  const expires = pendingStates.get(state);
  pendingStates.delete(state);
  if (!expires || expires < Date.now()) {
    throw new HttpError(400, "invalid_oauth_state", "The Google sign-in link expired or is invalid. Please try again.");
  }

  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  const { data: user } = await google.oauth2({ version: "v2", auth: client }).userinfo.get();

  await googleRepo.saveCredentials({
    accessTokenEnc: tokens.access_token ? encrypt(tokens.access_token, key) : null,
    refreshTokenEnc: tokens.refresh_token ? encrypt(tokens.refresh_token, key) : null,
    expiryDate: tokens.expiry_date ?? null,
    scope: tokens.scope ?? null,
    accountEmail: user.email ?? null,
    folderId: null,
  });
}

/** Builds an OAuth client from stored credentials; refreshed tokens are persisted automatically. */
async function getAuthorizedClient(): Promise<{ client: Auth.OAuth2Client; folderId: string | null }> {
  const key = requireConfigured();
  const creds = await googleRepo.getCredentials();
  if (!creds || (!creds.accessTokenEnc && !creds.refreshTokenEnc)) {
    throw new HttpError(409, "google_not_connected", "Google Drive is not connected. Connect it in Settings.");
  }
  const client = createOAuthClient();
  const credentials: Auth.Credentials = {
    access_token: creds.accessTokenEnc ? decrypt(creds.accessTokenEnc, key) : null,
    refresh_token: creds.refreshTokenEnc ? decrypt(creds.refreshTokenEnc, key) : null,
    expiry_date: creds.expiryDate,
  };
  client.setCredentials(credentials);
  client.on("tokens", (t) => {
    if (!t.access_token) return;
    googleRepo
      .updateTokens(
        encrypt(t.access_token, key),
        t.expiry_date ?? null,
        t.refresh_token ? encrypt(t.refresh_token, key) : null,
      )
      .catch((err: unknown) => console.error("[google] failed to persist refreshed tokens:", err));
  });
  return { client, folderId: creds.folderId };
}

/** Escapes a value for use inside a single-quoted Drive query string. */
const escapeQuery = (v: string) => v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function ensureFolder(drive: drive_v3.Drive, folderId: string | null, folderName: string): Promise<string> {
  if (folderId) {
    try {
      const { data } = await drive.files.get({ fileId: folderId, fields: "id, trashed" });
      if (data.id && !data.trashed) return data.id;
    } catch (err) {
      if (!isNotFound(err)) throw err;
      // Folder was deleted outside the app — fall through and recreate it.
    }
  }

  const { data: found } = await drive.files.list({
    q: `mimeType = '${FOLDER_MIME}' and name = '${escapeQuery(folderName)}' and trashed = false`,
    fields: "files(id)",
    spaces: "drive",
    pageSize: 1,
  });
  let id = found.files?.[0]?.id ?? null;
  if (!id) {
    const { data: created } = await drive.files.create({
      requestBody: { name: folderName, mimeType: FOLDER_MIME },
      fields: "id",
    });
    id = created.id ?? null;
  }
  if (!id) throw new HttpError(502, "google_drive_error", "Google Drive did not return a folder id");
  await googleRepo.setFolderId(id);
  return id;
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && Number((err as { code: unknown }).code) === 404;
}

function toHtmlFile(doc: Pick<DocumentRecord, "title" | "contentHtml">, fontFamily: string): string {
  const title = escapeHtml(doc.title);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>` +
    `<body style="font-family: '${fontFamily}', monospace;">${replaceEmbedsWithLinks(doc.contentHtml)}</body></html>`;
}

/**
 * Uploads a document to Drive as a Google Doc (converted from HTML). Updates the
 * existing Drive file when the document was synced before; recreates it if it was deleted.
 */
export async function uploadDocument(
  doc: Pick<DocumentRecord, "title" | "contentHtml" | "driveFileId">,
  opts: { folderName: string; fontFamily: string },
): Promise<string> {
  const { client, folderId: storedFolderId } = await getAuthorizedClient();
  const drive = google.drive({ version: "v3", auth: client });
  const folderId = await ensureFolder(drive, storedFolderId, opts.folderName);
  const media = () => ({ mimeType: "text/html", body: Readable.from([toHtmlFile(doc, opts.fontFamily)]) });
  const name = doc.title || "Untitled";

  if (doc.driveFileId) {
    try {
      const { data } = await drive.files.update({
        fileId: doc.driveFileId,
        requestBody: { name },
        media: media(),
        fields: "id",
      });
      if (data.id) return data.id;
    } catch (err) {
      if (!isNotFound(err)) throw err;
      // The Drive copy was deleted by the user — create a fresh one below.
    }
  }

  const { data } = await drive.files.create({
    requestBody: { name, mimeType: GOOGLE_DOC_MIME, parents: [folderId] },
    media: media(),
    fields: "id",
  });
  if (!data.id) throw new HttpError(502, "google_drive_error", "Google Drive did not return a file id");
  return data.id;
}

/** Forget the stored folder so the next upload resolves the (renamed) folder again. */
export async function resetFolder(): Promise<void> {
  if (config.google.configured) await googleRepo.setFolderId(null);
}

/** Revokes the token at Google (best effort) and deletes stored credentials. */
export async function disconnect(): Promise<void> {
  const key = requireConfigured();
  const creds = await googleRepo.getCredentials();
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
  await googleRepo.deleteCredentials();
}
