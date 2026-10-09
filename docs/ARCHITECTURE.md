# Architecture & Plan

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
lib/editor/             TipTap extensions (color shortcuts, list-aware Tab)
lib/hooks/              Browser-side hooks (local autosave, unload guard, fonts, theme)
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

The app is **single-user / self-hosted** by design (one settings row, one Drive connection).
Multi-user auth is a future feature; the schema keeps per-row ids so it can be added.

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
  and dark themes; "default text color" is a separate action (`Ctrl+0`, eraser button).
* **Revision counters** (not content diffing) track "unsaved locally" vs "unsaved on server", so
  autosave and the unload guard cost nothing per keystroke.
* **Drive failures never lose a save**: the MySQL write happens first and the response reports the
  Drive outcome separately (`drive.status`).
* **Settings live on the server** (so they follow the app across browsers) and are mirrored to
  `localStorage` so the theme applies instantly with no flash.
