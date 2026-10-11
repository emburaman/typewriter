# Architecture & Plan — Olive Writer

> Written before implementation, per the project's "plan first" rule. Kept up to date as the
> source of truth for how the pieces fit together.

## Goals

A distraction-free "typewriter" writing app, running in Docker, with:

1. Clean UI with light / dark / system theme.
2. Settings section to configure storage (Google Drive API).
3. Simple formatting — bold, italic, underline, a configurable palette of up to 5 font colors,
   bulleted and numbered lists — plus a configurable Google Font face.
4. Keyboard-first: `Ctrl+B/I/U`, `Ctrl+1…5` for colors, Markdown-like list triggers
   (`1. ` and `- `), `Tab` / `Shift+Tab` to nest / un-nest list items.
5. Auto-save to the browser every 5 seconds; warn before closing with unsaved server changes.

## Stack

Next.js 16 (App Router) · React 19 · TipTap 3 · Express 5 · MySQL 8.4 (`mysql2/promise`) ·
zod 4 · googleapis · TypeScript (strict) · Vitest + Playwright.

## High-level shape

```
                ┌──────────────────────── app container (port 4000) ────────────────────────┐
 Browser ──────▶│ Express 5 (server/index.ts)                                                │
                │   ├── /api/*  → REST routers (settings, documents, google, fonts, health) │
                │   └── *       → Next.js request handler (App Router UI)                   │
                └──────────────────────────────┬─────────────────────────────────────────────┘
                                               │ mysql2/promise (singleton pool)
                                       ┌───────▼───────┐            ┌──────────────────┐
                                       │  MySQL 8.4    │            │ Google Drive API │◀── server only
                                       └───────────────┘            └──────────────────┘
```

* **One Node process** hosts both Express and Next (Next "custom server"). This keeps one port
  (4000), one container image, and lets the REST API live in plain Express as required.
* **MySQL** stores documents, settings, and (encrypted) Google OAuth tokens.
* **Google Drive** is called only from the server; the browser never sees OAuth tokens.

## Directory layout

```
app/                    Next.js App Router pages (/, /settings) + global CSS
components/             React client components (editor, toolbar, settings, theme)
lib/api/                Centralized typed API client — the ONLY place the UI calls fetch()
lib/shared/             Types + zod schemas shared by UI and server
lib/editor/             TipTap extensions (colors, Tab, footnotes, media/video embeds, links)
lib/hooks/              Browser-side hooks (local autosave, unload guard, fonts, theme)
lib/sound/              Typewriter sound engine (Web Audio), key mapping, cookie preference
lib/files/              File-tree helpers for the Files panel (children, descendants, drop rules)
server/                 Express app, routes, services, DB pool + migration runner
db/migrations/          Ordered .sql migrations (applied automatically at boot)
docs/                   Architecture, API reference, feature docs
```

## Database schema (introduced first — see `db/migrations/001_init.sql`)

| table               | purpose                                                     |
|---------------------|-------------------------------------------------------------|
| `schema_migrations` | bookkeeping for the migration runner                       |
| `settings`          | single row (`id = 1`): theme, font, size, palette, storage  |
| `documents`         | id (UUID), title, content JSON + HTML, Drive file id, times |
| `google_credentials`| single row: AES-256-GCM encrypted tokens, email, folder id  |
| `folders`           | tree of folders (`parent_id` → `folders.id`, NULL = top level) |

`documents.folder_id` → `folders.id` (NULL = top level). Both foreign keys are `RESTRICT`: deleting
a folder moves its contents up a level in a transaction first, so nothing is ever cascaded away.
Folder moves are checked for cycles with a recursive CTE (`WITH RECURSIVE ancestors …`).

**Multi-user** since migration 005: `users` (Google identity, role, invited state), `sessions`
(SHA-256 of the cookie token), `user_settings` and `drive_connections` (per user), and `user_id`
on `documents` and `folders`. The old single-row `settings` / `google_credentials` tables are only
read once, when the first admin claims pre-account data.

## Key flows

**Editing & autosave**
1. The editor (TipTap/ProseMirror) holds the document as JSON.
2. Every 5 s, if content changed since the last local save, it is written to `localStorage`
   (`typewriter:draft:<docId>`), with a timestamp.
3. `Ctrl+S` / the Save button `PUT`s the document to the server (MySQL); if Drive storage is
   enabled, the server also uploads it to Drive (as a Google Doc converted from HTML).
4. A `beforeunload` guard fires when the editor content differs from the last server save.
5. On load, if a local draft is newer than the server copy, the user is offered to restore it.

**Google Drive connection**
1. Settings → "Connect Google Drive" → `GET /api/google/auth-url` → redirect to Google consent.
2. Google redirects to `GET /api/google/callback?code=…`; server exchanges the code, encrypts
   the tokens, stores them, ensures the configured folder exists, then redirects to `/settings`.
3. Scope is `drive.file` — the app can only see files it created.

**Fonts**: the font face is any Google Fonts family. A curated list is always available; if
`GOOGLE_FONTS_API_KEY` is set, `GET /api/fonts` returns the full catalog (cached in memory).
The chosen family is loaded with a `fonts.googleapis.com/css2` `<link>`.

## Decisions & trade-offs

* **TipTap 3** gives robust rich-text with input rules (`1. `, `- `) and list keymaps; we add
  small custom extensions for `Ctrl+1…5` colors and "Tab nests only at the start of a list item".
* **Ctrl+1…5** are also the browser's "switch to tab N" keys. The editor handles them and calls
  `preventDefault`, which wins in current Chromium and Firefox while the editor has focus;
  `Alt+1…5` is offered as a fallback for browsers or OS setups that reserve them anyway.
* **Default palette** uses mid-tone colors (no black) so every swatch stays legible in both light
  and dark themes; "default text color" is a separate action (`Ctrl+0`, swatch "0" showing the theme's text color).
* **Revision counters** (not content diffing) track "unsaved locally" vs "unsaved on server", so
  autosave and the unload guard cost nothing per keystroke.
* **Editor schema**: TipTap StarterKit (headings 1–6, quote, rule, code, code block, link) plus
  our own nodes: `footnoteReference` / `footnotes` / `footnote` (a plugin keeps the numbering, note
  order and anchors consistent after every change), `videoEmbed` (stores only provider + id, with
  the iframe src rebuilt on render) and `mediaFile` (http(s) audio/video only).
* **Authentication**: Google sign-in (`openid email profile`), invite-only, sessions in an
  httpOnly SameSite=Lax cookie. Only a token hash is stored. `sessionMiddleware` sets `req.user`;
  `requireAuth` / `requireAdmin` guard routers; `sameOriginForWrites` refuses cross-site writes.
  Sign-in and Drive share one OAuth client and redirect URI, and the one-time `state` records the
  flow (`login` | `drive` + user). Every repository function takes a `userId` and every query
  filters on it. Client-generated document ids can't be used to overwrite another user's row
  (the upsert checks the owner inside a transaction). The first admin is created under a MySQL
  named lock (`GET_LOCK`), so concurrent first sign-ins can't create two admins.
* **Drive folder mirroring** (`server/services/driveTree.ts`): each app folder caches its Drive
  folder id (`folders.drive_folder_id`, migration 004). Every operation re-checks the Drive side
  (exists, not trashed, right name, right parent) and repairs it, so failed or partial syncs and
  edits made by hand in Drive heal themselves. The engine talks to Drive through a small
  `DriveApi` interface and is unit-tested against an in-memory fake. Drive work runs one
  operation at a time (`driveSync.ts`), so concurrent saves can't create duplicate folders, and
  it always runs after the database change, which it never rolls back.
* **A document's folder is set on create only** (`PUT` with `folderId`); moves are a separate
  `PATCH`. That way a save from an open editor can never undo a move made in the Files panel.
* **Typewriter sound is synthesized, not sampled**: Web Audio noise bursts, oscillators and a bell
  give near-zero latency, natural per-key variation, no audio assets or licensing, and nothing to
  download. The on/off choice lives in a cookie because it's a per-browser preference (it doesn't
  sync across browsers through the server settings).
* **Drive failures never lose a save**: the MySQL write happens first and the response reports the
  Drive outcome separately (`drive.status`).
* **Settings live on the server** (so they follow the app across browsers) and are mirrored to
  `localStorage` so the theme applies instantly with no flash.
