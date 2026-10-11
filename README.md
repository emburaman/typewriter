# Olive Writer

A distraction-free typewriter-style writing app that runs in Docker. Open it, type, and stay in flow: the
interface fades away while you write. Formatting is limited on purpose and fully reachable from
the keyboard. Your words are auto-saved in the browser every 5 seconds and can be saved to the
server (MySQL) and, if you want, to Google Drive.

![stack](https://img.shields.io/badge/stack-Next.js%2016%20·%20Express%205%20·%20MySQL%208.4-555)

- [Features](#features)
- [Quick start (Docker, development)](#quick-start-docker-development)
- [Production deployment](#production-deployment)
- [Running without Docker](#running-without-docker)
- [Configuration](#configuration)
- [Google Drive setup](#google-drive-setup)
- [Testing](#testing)
- [Project structure](#project-structure)
- More docs: [Features](docs/FEATURES.md) · [API reference](docs/API.md) ·
  [Architecture](docs/ARCHITECTURE.md) · [Test checklist](docs/TESTING.md)

---

## Features

| | |
|---|---|
| **Clean UI** | Centered writing column, typewriter-style font, and a focus mode where the header, toolbar and status bar fade out while you type. **Light / Dark / System** themes in the Olive Writer palette, applied before first paint so the screen never flashes. |
| **Typewriter sound** | Every keystroke makes a typewriter strike. Space, Backspace and Enter (carriage return plus bell) each have their own sound. Turn it on or off with the speaker icon; the choice is kept in a cookie. |
| **Simple formatting** | Bold, italic, underline, up to **5 font colors** from a palette you choose, bulleted and numbered lists. |
| **Keyboard-first** | `Ctrl+B/I/U`, `Ctrl+1…5` for colors, `Ctrl+0` for the default color, `1. ` and `- ` start lists, `Tab` right after the bullet/number nests the item, `Ctrl+S` saves. |
| **Fonts** | Any Google Fonts family, with a live preview. You get a curated list by default, or the full catalog if you set a Google Fonts API key. |
| **Autosave** | Saves to browser storage every 5 s. If the browser has a newer unsaved draft than the server, it's restored on load. Closing the tab with changes not yet saved to the server triggers the browser's "Leave site?" prompt. |
| **Storage** | MySQL on the server, plus optional **Google Drive** sync: each save also uploads the document as a Google Doc, and your folders are mirrored as Drive folders (created, renamed, moved and deleted along with the app). |
| **Markdown formatting** | Headings H1–H6, quotes, horizontal lines, inline code and code blocks, external links, footnotes with two-way in-document links, images / audio / video from a URL, and embedded YouTube and Vimeo videos. Markdown typing shortcuts work (`# `, `> `, `---`, `` `code` ``, ```` ``` ````, `[text](url)`, `![alt](url)`). |
| **Files and folders** | The Files panel shows saved documents in a tree of folders. Create, rename and delete folders, and move documents and folders by drag and drop or with "Move to…". Deleting a folder never deletes writing: its contents move up a level. |

See **[docs/FEATURES.md](docs/FEATURES.md)** for details of each feature.

## Quick start (Docker, development)

Requirements: Docker with Compose v2.

```bash
git clone <this repo> typewriter && cd typewriter
docker compose up --build
```

Open **http://localhost:4000**.

- `.env.local` already contains throwaway development credentials, so no setup is needed.
- Source files are bind-mounted, so pages hot-reload and the server restarts when you edit `server/`.
- Database migrations in `db/migrations/` run automatically each time the app starts.
- When `package-lock.json` changes (after a `git pull` that adds a dependency, for example), the
  app container installs the new packages on its next start (`scripts/dev-start.sh`).
- MySQL is also published on `localhost:3306`, so host tools (and `npm run dev`, see below) can use it.

Useful commands:

```bash
docker compose logs -f app          # app logs
docker compose exec db mysql -utypewriter -ptypewriter-dev typewriter   # SQL shell
docker compose down                 # stop (data is kept in the mysql-dev-data volume)
docker compose down -v              # stop and wipe the dev database
```

## Production deployment

1. On the server, edit **`.env.production`**:
   - replace every `CHANGE_ME…` value with a strong password (`openssl rand -base64 24`);
   - set `APP_URL` to the public URL users will visit (for example `https://write.example.com`);
   - optionally fill in the Google variables ([Google Drive setup](#google-drive-setup)).
   Keep real secrets out of git. You can also put them in `.env.production.local`, which is ignored.
2. Build and start:

   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   ```

3. Check it:

   ```bash
   curl http://localhost:4000/api/health      # {"status":"ok","database":"up"}
   docker compose -f docker-compose.prod.yml ps   # app should report "healthy"
   ```

What the production stack does:

- The `prod` target of the multi-stage `Dockerfile` builds Next.js and compiles the server with
  `tsc`. It removes dev dependencies and runs as the unprivileged `node` user.
- MySQL is not published to the host. Its data lives in the `mysql-data` volume.
- Both containers use `restart: unless-stopped`, and the app has a Docker `HEALTHCHECK` on `/api/health`.
- The app listens on **port 4000**. Put a TLS-terminating reverse proxy (Caddy, nginx, Traefik) in
  front of it for HTTPS. Google OAuth requires HTTPS for any host other than `localhost`.

Updating: `git pull && docker compose -f docker-compose.prod.yml up -d --build`. New migrations
are applied when the app starts.

Backups: `docker compose -f docker-compose.prod.yml exec db sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" typewriter' > backup.sql`

## Running without Docker

Requires Node.js ≥ 20 and a MySQL 8 server. The simplest option is to run only the database container:

```bash
docker compose up -d db
npm install
npm run dev              # http://localhost:4000 (reads .env.local; DB_HOST=localhost)
```

| Script | What it does |
|---|---|
| `npm run dev` | Express + Next.js dev server with hot reload (`tsx watch`) |
| `npm run build` | `next build` + compile the server to `dist/` |
| `npm start` | Run the production build |
| `npm run migrate` | Apply pending migrations and exit |
| `npm run typecheck` | Strict TypeScript check of UI and server |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | Browser tests (Playwright) against a running app |

## Configuration

Every variable is documented in **[.env.example](.env.example)**. The main ones:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | HTTP port |
| `APP_URL` | `http://localhost:4000` | Public URL. Used to build the OAuth redirect URI. |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | — | App → MySQL connection. Compose sets `DB_HOST=db`. |
| `MYSQL_*` | — | Bootstrap values for the MySQL container. Must match the `DB_*` values. |
| `TOKEN_ENCRYPTION_KEY` | — | 32 bytes, base64 (`openssl rand -base64 32`). Encrypts Google tokens at rest. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | — | Enable Google Drive |
| `GOOGLE_REDIRECT_URI` | `${APP_URL}/api/google/callback` | Override the OAuth callback |
| `GOOGLE_FONTS_API_KEY` | — | Offer the full Google Fonts catalog in Settings |

The app checks its configuration at boot and exits with a clear message if a value is invalid.
Values already set in the environment, for example by Compose, take precedence over `.env*` files.

## Google Drive setup

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project (or choose an existing one).
2. **APIs & Services → Library**: enable the **Google Drive API**.
3. **APIs & Services → OAuth consent screen**: set it up as *External*. Add your account under
   *Test users* while the app is in testing.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized redirect URI: `<APP_URL>/api/google/callback`
     (for example `http://localhost:4000/api/google/callback`)
5. Put the client ID and secret into your env file, together with a `TOKEN_ENCRYPTION_KEY`:

   ```bash
   GOOGLE_CLIENT_ID=1234-abc.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-...
   TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 32)   # paste the generated value
   ```

6. Restart the app. In **Settings → Storage**, click **Connect Google Drive**. On Google's
   permission screen, **tick the Google Drive box** (or "Select all"), then choose
   **Server + Google Drive**.
7. Click **Sync everything to Drive now** to copy the folders and documents you already have.

From then on, every save (`Ctrl+S`) also uploads the document as a Google Doc into the Drive
folder (`Olive Writer` by default), and your app folders are mirrored as Drive folders inside it. The app requests the
`drive.file` scope, so it **can only see files it created**, not the rest of your Drive. If the
Drive upload fails, the server save still succeeds and the app shows a notice.

Optional: to get the full Google Fonts catalog, create an API key, restrict it to the
*Web Fonts Developer API*, and set `GOOGLE_FONTS_API_KEY`.

## Testing

```bash
npm run typecheck
npm test                         # unit: schemas, encryption, error mapping, utils
docker compose up -d --build     # then, in another terminal:
npx playwright install chromium  # first time only
npm run test:e2e                 # browser: shortcuts, lists, autosave, save, unload prompt, theme, settings
```

The full manual and automated checklist is in **[docs/TESTING.md](docs/TESTING.md)**.

## Project structure

```
app/                 Next.js App Router: / (editor), /settings, global styles
assets/brand/        Original "Olive" / "Writer" logo SVGs (rendered via components/Logo.tsx)
components/          React client components (editor screen, toolbar, settings, drawer, providers)
lib/api/             Centralized typed API client: the only code in the UI that calls fetch()
lib/editor/          TipTap extensions (color shortcuts, Tab, footnotes, media/video embeds, links), URL validation, browser drafts
lib/files/           File-tree helpers (children, descendants, drop rules)
lib/hooks/           Google Fonts loader
lib/sound/           Typewriter sound synthesis (Web Audio), key → sound mapping, cookie preference
lib/shared/          Types + zod schemas shared by UI and server
server/              Express 5: app, routes, repositories (SQL), services (Drive, fonts, crypto)
db/migrations/       Ordered SQL migrations, applied automatically at startup
tests/unit, tests/e2e
docs/                Architecture, features, API reference, test checklist
```

## Troubleshooting

**`Module not found: Can't resolve '<package>'` in the dev container.** Dependencies are
reinstalled automatically when `package-lock.json` changes, so restarting is usually enough:
`docker compose up --build`. If the container's `node_modules` volume ever gets out of sync
anyway, reset that volume only. Your dev database is untouched:

```bash
docker compose rm -sfv app     # removes the app container and its node_modules / .next volumes
docker compose up --build
```

Avoid `docker compose down -v` for this. It also deletes the `mysql-dev-data` volume, which holds your documents.

**Running on the host (`npm run dev`)** after pulling new code: run `npm install` first.

## Limitations and roadmap notes

- **Single-user by design.** There is no login. Anyone who can reach the app can use it and its
  Drive connection. Expose it only on a trusted network or behind an authenticating proxy until
  accounts are added.
- Browsers show their own fixed wording in the "Leave site?" dialog. A page cannot add a
  "Save" button to it. Your work is still kept in the browser draft and offered back on the next visit.
- Deleting a document removes the server copy only. Any Drive copy stays in Drive.
