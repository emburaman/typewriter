# REST API reference

Base path: `/api`. All request and response bodies are JSON (`Content-Type: application/json`).
Responses carry `Cache-Control: no-store`. The UI calls these endpoints only through the typed
client in `lib/api/`.

## Conventions

| Status | Meaning |
|---|---|
| `200 OK` | Success with a body |
| `201 Created` | A resource was created (`POST`, or a `PUT` that inserted) |
| `204 No Content` | Success with no body (`DELETE`) |
| `303 See Other` | OAuth callback redirect back to the UI |
| `401 Unauthorized` | Not signed in (every endpoint except health, auth, fonts and the OAuth callback) |
| `400 Bad Request` | Validation failed, malformed JSON, invalid id, or a feature isn't configured |
| `403 Forbidden` | Admin-only endpoint, a refused sign-in, or a cross-site write (`Origin` from another site) |
| `404 Not Found` | Unknown resource or route, **or one that belongs to another user** (never revealed) |
| `409 Conflict` | Google Drive isn't connected |
| `413 Payload Too Large` | Body over 5 MB |
| `500 Internal Server Error` | Unexpected error (details are logged, never returned) |
| `502 Bad Gateway` | Google Drive upload failed (on `drive-sync`) |
| `503 Service Unavailable` | Health check: database unreachable |

Every error response has this shape:

```json
{ "error": { "code": "validation_error", "message": "Request validation failed",
             "details": [{ "path": "toolbarColors", "message": "Too big: expected array to have <=5 items" }] } }
```

Error codes: `bad_request`, `validation_error`, `invalid_json`, `not_found`, `payload_too_large`,
`google_not_configured`, `google_not_connected`, `google_drive_error`, `invalid_oauth_state`,
`internal_error`.

## Authentication

Sign-in is "Sign in with Google" for invited accounts only. A session lives in an httpOnly
`ow_session` cookie (30 days, renewed daily while in use). **Every resource below belongs to the
signed-in user**: other people's documents, folders, settings and Drive connections are invisible
(`404`), even if their ids are known.

### `GET /api/auth/config` (public)
→ `200 {"googleConfigured": bool, "needsSetup": bool, "devLogin": bool}`. `needsSetup` is true
while no account exists (the next sign-in becomes the admin).

### `GET /api/auth/login` (public, browser navigation)
→ `303` to Google's account chooser (scopes `openid email profile`). Google returns to
`/api/google/callback`, which starts a session and redirects to `/`, or to
`/login?error=not_invited|admin_only|email_unverified|denied|expired|google`.

### `GET /api/auth/me` → `200 AuthUser` · `401`
```ts
interface AuthUser { id: string; email: string; name: string | null; avatarUrl: string | null; role: "admin" | "user" }
```

### `POST /api/auth/logout` → `204`

### `POST /api/auth/dev-login` (test only)
Body `{"email": "…"}`. Exists only when the server runs with `AUTH_DEV_LOGIN=true`, which is
refused when `NODE_ENV=production`; otherwise `404`. It follows the same rules as Google
sign-in. → `200 AuthUser` · `403 not_invited | admin_only`

## Users (admin only)

### `GET /api/users` → `200 UserSummary[]`
`UserSummary = AuthUser & { status: "active" | "invited", createdAt, lastLoginAt }`

### `POST /api/users`
Invite: `{"email": "…", "role"?: "user" | "admin"}`. That person can now sign in with the Google
account for that email. → `201 UserSummary` · `409` (already invited or has an account) · `400`

### `DELETE /api/users/{id}`
Removes the account **and its documents, folders, settings and Drive connection** on this server
(Drive copies are untouched). → `204` · `400` (your own account) · `404`

---

## Health

### `GET /api/health`
`200 {"status":"ok","database":"up"}`, or `503 {"status":"degraded","database":"down"}`.

---

## Settings

The app is single-user, so there is one settings object.

```ts
interface Settings {
  theme: "light" | "dark" | "system";
  fontFamily: string;          // Google Fonts family: letters, digits, spaces (≤100)
  fontSize: number;            // 12–32 (px)
  toolbarColors: string[];     // 1–5 colors, "#rrggbb"
  highlightColors: string[];   // 1–5 highlight colors, "#rrggbb"
  storageProvider: "server" | "google_drive";
  driveFolderName: string;     // 1–255 chars
}
```

### `GET /api/settings` → `200 Settings`

### `PUT /api/settings`
Partial update: send any subset of fields. Unknown keys are rejected with `400`.
Changing `driveFolderName` makes the next Drive upload resolve or create that folder.

```bash
curl -X PUT localhost:4000/api/settings -H 'content-type: application/json' \
     -d '{"theme":"dark","toolbarColors":["#d64541","#2e86de"]}'
```
→ `200 Settings` (the full, updated object) · `400` on validation error

---

## Documents

```ts
interface DocumentSummary {
  id: string;                  // UUID
  title: string;
  folderId: string | null;     // null = top level
  wordCount: number;
  updatedAt: string;           // ISO 8601
  driveFileId: string | null;
  driveSyncedAt: string | null;
}
interface DocumentRecord extends DocumentSummary {
  revision: number;            // +1 on every save; used to detect edits from another device
  contentSource: "json" | "html"; // "html" right after an edit was pulled from Google Docs
                                  // (contentHtml is current; the editor converts it to JSON)
  contentJson: { type: "doc", content?: unknown[] };   // TipTap / ProseMirror JSON
  contentHtml: string;                                   // rendered HTML (sent to Drive)
  createdAt: string;
}
interface DocumentWrite {      // request body for POST / PUT
  title?: string;              // ≤255, default "Untitled"
  folderId?: string | null;    // only applied when the document is created
  contentJson: { type: "doc", ... };
  contentHtml: string;         // ≤4,000,000 chars
  wordCount?: number;          // default 0
  baseRevision?: number | null; // revision this edit is based on (null = new); omit to skip the check
  driveSync?: "now" | "auto" | "skip"; // when to upload to Drive (default "now"; "auto" = only if
                                       // the Drive copy is > 2 min old — used by background autosave)
}
interface DocumentSaveResult {
  document: DocumentRecord;
  drive: { status: "skipped" | "synced" | "failed"; message?: string };
}
```

### `GET /api/documents` → `200 DocumentSummary[]`
Sorted by title.

### `POST /api/documents`
Creates a document with a server-generated id.
→ `201 DocumentSaveResult` with a `Location: /api/documents/{id}` header.

### `GET /api/documents/{id}`
→ `200 DocumentRecord` · `400` if the id isn't a UUID · `404`

### `PUT /api/documents/{id}`
**Create or replace.** The editor generates document ids itself, so a draft that exists only in
the browser keeps the same id when it's first saved.
→ `201 DocumentSaveResult` (created) · `200 DocumentSaveResult` (updated) · `400` · `409` (conflict, see below)

**Conflicts:** with `baseRevision`, the save only succeeds if the document is still at that
revision; the check and the write are atomic. Otherwise nothing is written and the response is
`409 {"error": {"code": "conflict", "details": {"document": <current DocumentRecord>}}}`, so
the client can offer keep-both / use-theirs / overwrite. To overwrite on purpose, resend with
`baseRevision` set to the current revision.

`folderId` is applied only when this request creates the document (a new draft saved inside a
folder). Later saves never move it, so a save from an open editor can't undo a move made in the
Files panel. Use `PATCH` to move. `400` if the folder doesn't exist.

If `storageProvider` is `google_drive`, the document is also uploaded to Drive. A Drive failure
**doesn't** fail the request: the MySQL save is kept and `drive.status` is `"failed"` with a message.

### `PATCH /api/documents/{id}`
Moves a document. Body: `{"folderId": "<folder uuid>" | null}` (`null` = top level). With Drive
mirroring, its Google Doc moves to the matching Drive folder.
→ `200 DocumentRecord & { driveWarning? }` · `400` (validation error, or the folder doesn't exist) · `404`

### `POST /api/documents/{id}/drive-sync`
Uploads the stored document to Drive now, whatever `storageProvider` is set to.
→ `200 DocumentSaveResult` (`drive.status: "synced"`) · `502 DocumentSaveResult` (`"failed"`) · `404`

### `DELETE /api/documents/{id}`
Moves the document to the **Trash**, where it's restorable for 30 days and then purged. With
Drive sync, its Drive file goes to Drive's trash too.
→ `204` · `200 {"driveWarning": "…"}` (trashed here, but Drive couldn't be updated) · `404`

### `GET /api/documents/trash` → `200 TrashedDocument[]`
`TrashedDocument = DocumentSummary & { deletedAt: string }`, most recently deleted first.

### `POST /api/documents/trash/{id}/restore`
Back from the Trash, and out of Drive's trash too. → `200 DocumentRecord & { driveWarning? }` · `404`

### `DELETE /api/documents/trash/{id}`
Deletes forever. Only works on documents already in the Trash. → `204` · `404`

---

## Folders

Folders form a tree through `parentId` (`null` = top level). Folder and document names don't
have to be unique.

```ts
interface Folder {
  id: string;            // UUID
  name: string;          // 1–255 chars
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### `GET /api/folders` → `200 Folder[]`
A flat list sorted by name. Clients build the tree from `parentId`.

### Google Drive mirroring

When storage is `google_drive` and Drive is connected, folder and move operations are also
applied in Drive, **after** the database change. A Drive failure never fails the request: the
response includes `driveWarning: string` (Google's reason), and the next save or
`POST /api/google/sync` repairs Drive.

### `POST /api/folders`
Body: `{"name": "Novel", "parentId": null}` (`parentId` is optional).
→ `201 Folder & { driveWarning? }` with a `Location` header · `400` (validation error, or the parent doesn't exist)

### `PATCH /api/folders/{id}`
Renames and/or moves a folder. Body: `{"name"?: string, "parentId"?: string | null}`. At least one
field is required, and unknown keys are rejected.
→ `200 Folder & { driveWarning? }` · `400` (validation error, the parent doesn't exist, or the
move would put the folder inside itself or one of its sub-folders) · `404`

### `DELETE /api/folders/{id}`
Deletes the folder. In the same transaction, its sub-folders and documents **move up to the
deleted folder's parent**, so no writing is ever deleted. With Drive mirroring, the Drive folder's
contents move up too, and the empty Drive folder goes to Drive's trash.
→ `204` · `200 { "driveWarning": "…" }` (deleted, but Drive couldn't be updated) · `404`

---

## Google Drive

```ts
interface GoogleStatus {
  configured: boolean;      // server has GOOGLE_CLIENT_ID/SECRET + TOKEN_ENCRYPTION_KEY
  connected: boolean;
  driveAccess: boolean;     // false if the Drive permission was unticked on Google's consent screen
  accountEmail: string | null;
  folderId: string | null;
}
```

### `GET /api/google/status` → `200 GoogleStatus`

### `GET /api/google/auth-url`
→ `200 {"url": "https://accounts.google.com/o/oauth2/v2/auth?..."}`. The browser navigates to this
URL. It carries a one-time `state` value (CSRF protection, valid for 10 minutes).
→ `400 google_not_configured` if the server isn't configured.

### `GET /api/google/callback?code=…&state=…` (public)
The single OAuth redirect target, used for both sign-in (see Authentication) and Drive
connections. The one-time `state` records which flow it is and, for Drive, which user started it.
The Drive connection must finish in that same user's session. For Drive it exchanges the code,
stores the user's tokens encrypted with AES-256-GCM, and redirects with **`303`** to one of:
- `/settings?google=connected`
- `/settings?google=denied&message=…` (the user declined)
- `/settings?google=error&message=…` (invalid or expired state, the token exchange failed, or
  the Drive permission was unticked on Google's consent screen; in that case the partial grant is
  revoked and nothing is stored)

### `POST /api/google/pull`
Brings in changes made in Google Drive / Google Docs now (the server also does this every minute
for every user with Drive sync on). Body `{"force": true}` is optional. Skipped when a pull ran in
the last 5 s (1 s with `force`), or when Drive sync is off.
→ `200 {"pulled", "imported", "trashed", "restored", "conflicts", "foldersChanged"}` or `200 {"skipped": true}`

### `POST /api/google/sync`
Pulls Drive changes in, then mirrors every folder and uploads every document to Drive now,
whatever the storage setting.
Documents are uploaded one at a time, and a failure on one doesn't stop the others.
→ `200 {"folders": n, "documents": n, "failed": [{"title": "…", "message": "…"}]}` ·
`409` (not connected, or Drive access not granted) · `403 drive_scope_missing` ·
`502 google_drive_error` (with Google's message)

### `DELETE /api/google/connection`
Revokes the token at Google (best effort) and deletes the stored credentials. → `204`

---

## Fonts

### `GET /api/fonts`
→ `200 {"source": "google" | "curated", "families": string[]}`

If `GOOGLE_FONTS_API_KEY` is set, this returns the full Google Fonts catalog, sorted by
popularity and cached for 24 h. Otherwise, or if Google can't be reached, it returns the curated list.
