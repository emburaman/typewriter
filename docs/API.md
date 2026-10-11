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
| `400 Bad Request` | Validation failed, malformed JSON, invalid id, or a feature isn't configured |
| `404 Not Found` | Unknown resource or route |
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
→ `201 DocumentSaveResult` (created) · `200 DocumentSaveResult` (updated) · `400`

`folderId` is applied only when this request creates the document (a new draft saved inside a
folder). Later saves never move it, so a save from an open editor can't undo a move made in the
Files panel. Use `PATCH` to move. `400` if the folder doesn't exist.

If `storageProvider` is `google_drive`, the document is also uploaded to Drive. A Drive failure
**doesn't** fail the request: the MySQL save is kept and `drive.status` is `"failed"` with a message.

### `PATCH /api/documents/{id}`
Moves a document. Body: `{"folderId": "<folder uuid>" | null}` (`null` = top level).
→ `200 DocumentRecord` · `400` (validation error, or the folder doesn't exist) · `404`

### `POST /api/documents/{id}/drive-sync`
Uploads the stored document to Drive now, whatever `storageProvider` is set to.
→ `200 DocumentSaveResult` (`drive.status: "synced"`) · `502 DocumentSaveResult` (`"failed"`) · `404`

### `DELETE /api/documents/{id}`
Deletes the server copy. A Drive copy, if any, is left in place.
→ `204` · `404`

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

### `POST /api/folders`
Body: `{"name": "Novel", "parentId": null}` (`parentId` is optional).
→ `201 Folder` with a `Location` header · `400` (validation error, or the parent doesn't exist)

### `PATCH /api/folders/{id}`
Renames and/or moves a folder. Body: `{"name"?: string, "parentId"?: string | null}`. At least one
field is required, and unknown keys are rejected.
→ `200 Folder` · `400` (validation error, the parent doesn't exist, or the move would put the
folder inside itself or one of its sub-folders) · `404`

### `DELETE /api/folders/{id}`
Deletes the folder. In the same transaction, its sub-folders and documents **move up to the
deleted folder's parent**, so no writing is ever deleted.
→ `204` · `404`

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

### `GET /api/google/callback?code=…&state=…`
OAuth redirect target, called by Google rather than by API clients. It exchanges the code, stores
the tokens encrypted with AES-256-GCM, and redirects with **`303`** to one of:
- `/settings?google=connected`
- `/settings?google=denied&message=…` (the user declined)
- `/settings?google=error&message=…` (invalid or expired state, the token exchange failed, or
  the Drive permission was unticked on Google's consent screen; in that case the partial grant is
  revoked and nothing is stored)

### `DELETE /api/google/connection`
Revokes the token at Google (best effort) and deletes the stored credentials. → `204`

---

## Fonts

### `GET /api/fonts`
→ `200 {"source": "google" | "curated", "families": string[]}`

If `GOOGLE_FONTS_API_KEY` is set, this returns the full Google Fonts catalog, sorted by
popularity and cached for 24 h. Otherwise, or if Google can't be reached, it returns the curated list.
