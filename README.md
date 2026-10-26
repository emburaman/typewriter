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
- [Accounts](#accounts)
- [Google sign-in and Drive setup](#google-sign-in-and-drive-setup)
- [Testing](#testing)
- [Project structure](#project-structure)
- More docs: [Features](docs/FEATURES.md) · [API reference](docs/API.md) ·
  [Architecture](docs/ARCHITECTURE.md) · [Test checklist](docs/TESTING.md)

---

## Features

| | |
|---|---|
| **Accounts** | "Sign in with Google", invite-only. The first person to sign in becomes the admin and invites others in Settings → Users. Each person's documents, folders, settings and Google Drive connection are private to them. |
| **Clean UI** | Centered writing column, typewriter-style font, and a focus mode where the header, toolbar and status bar fade out while you type (scroll to bring the toolbar back). On phones the header actions collapse into a ☰ menu. **Light / Dark / System** themes in the Olive Writer palette, applied before first paint so the screen never flashes. |
| **Typewriter sound** | Every keystroke makes a typewriter strike. Space, Backspace and Enter (carriage return plus bell) each have their own sound. Turn it on or off with the speaker icon; the choice is kept in a cookie. |
| **Simple formatting** | Bold, italic, underline, up to **5 font colors** and **5 highlight colors** from palettes you choose, bulleted and numbered lists. |
| **Keyboard-first** | `Ctrl+B/I/U`, `Ctrl+1…5` for colors, `Ctrl+0` for the default color, `Ctrl+Shift+1…5` / `Ctrl+Shift+0` to highlight / un-highlight, `1. ` and `- ` start lists, `Tab` right after the bullet/number nests the item, `Ctrl+S` saves. |
| **Fonts** | Any Google Fonts family, with a live preview. You get a curated list by default, or the full catalog if you set a Google Fonts API key. |
| **Saving & devices** | Auto-saves to the server a few seconds after you pause (no `Ctrl+S` needed), with a browser copy for offline use. Sign in on another device and your documents are there; open documents refresh when they change elsewhere, and edits made on two devices at once are never silently overwritten (keep both / use theirs / overwrite). |
| **Storage** | MySQL on the server, plus optional **two-way Google Drive sync**: documents are Google Docs inside mirrored Drive folders. Edits, renames, moves and deletions go both ways, and edits made in Google Docs come back into the app. Deletions on either side go to a trash, never straight to permanent deletion. |
| **Markdown formatting** | Headings H1–H6, quotes, horizontal lines, inline code and code blocks, external links, footnotes with two-way in-document links, images / audio / video from a URL, and embedded YouTube and Vimeo videos. Markdown typing shortcuts work (`# `, `> `, `---`, `` `code` ``, ```` ``` ````, `[text](url)`, `![alt](url)`). |
| **Files and folders** | The Files panel shows saved documents in a tree of folders. Create, rename and delete folders, and move documents and folders by drag and drop or with "Move to…". Deleting a folder never deletes writing: its contents move up a level. |

See **[docs/FEATURES.md](docs/FEATURES.md)** for details of each feature.

## Quick start (Docker, development)

Requirements: Docker with Compose v2.

```bash
git clone <this repo> typewriter && cd typewriter
docker compose up --build
```

Open **http://localhost:4000** and sign in with Google.

- `.env.local` contains throwaway database credentials. Signing in needs a Google OAuth client:
  see [Google sign-in and Drive setup](#google-sign-in-and-drive-setup) and set
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `ADMIN_EMAIL`.
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
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | — | **Required.** "Sign in with Google", and Google Drive. |
| `ADMIN_EMAIL` | — | Only this Google account can become the first admin. **Set it** on any server others can reach. |
| `TOKEN_ENCRYPTION_KEY` | — | 32 bytes, base64 (`openssl rand -base64 32`). Encrypts Drive tokens at rest; needed for Drive. |
| `AUTH_DEV_LOGIN` | `false` | Test-only password-less sign-in for the browser tests. The app refuses to start with it in production. |
| `GOOGLE_REDIRECT_URI` | `${APP_URL}/api/google/callback` | Override the OAuth callback |
| `GOOGLE_FONTS_API_KEY` | — | Offer the full Google Fonts catalog in Settings |

The app checks its configuration at boot and exits with a clear message if a value is invalid.
Values already set in the environment, for example by Compose, take precedence over `.env*` files.

## Accounts

- **Sign in with Google.** Sign-in only asks Google for your name and email. Connecting Google
  Drive is a separate step in Settings, and each person can connect any Google account's Drive.
- **Invite-only.** The first person to sign in becomes the **admin**, and only the Google account
  in `ADMIN_EMAIL` can do this if it's set. After that, only emails the admin adds in
  **Settings → Users** can sign in, using the Google account with that email. The admin can make
  other admins, cancel invites and remove people. Removing someone deletes their writing on this
  server; copies in their own Google Drive stay.
- **Private by default.** Documents, folders, settings and the Drive connection belong to one
  person, and every database query is scoped to the signed-in user. Browser drafts are kept per
  user too, so people can share a computer.
- **Upgrading from the single-user version:** after the upgrade, sign in first with your own
  Google account (set `ADMIN_EMAIL` to it). You become the admin and keep every existing
  document, folder, setting and your Drive connection.
- **Sessions** last 30 days, renew while you use the app, and end at *Sign out*. They're kept in
  an httpOnly, SameSite=Lax cookie (Secure on https), and the server stores only a hash of each
  session token. Requests that change data from another site are refused.

## Google sign-in and Drive setup

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project (or choose an existing one).
2. **APIs & Services → Library**: enable the **Google Drive API**.
3. **APIs & Services → OAuth consent screen**: set it up as *External*. Add your account under
   *Test users* while the app is in testing.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized redirect URI: `<APP_URL>/api/google/callback`
     (for example `http://localhost:4000/api/google/callback`)
5. Put the client ID and secret into your env file, together with `ADMIN_EMAIL` (your Google
   account) and a `TOKEN_ENCRYPTION_KEY`:

   ```bash
   GOOGLE_CLIENT_ID=1234-abc.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-...
   ADMIN_EMAIL=you@gmail.com
   TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 32)   # paste the generated value
   ```

   Sign-in and Drive share this one redirect URI, so nothing else needs registering. While the
   Google app is in *Testing* mode, add every person who will sign in as a test user, or
   publish the app (Audience → Publish app).
6. Restart the app and sign in. In **Settings → Storage**, click **Connect Google Drive**. On Google's
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
npx playwright install chromium  # first time only
# Browser tests sign in through the test-only endpoint, so run the app in test mode on a
# throwaway database (never NODE_ENV=production; the app refuses AUTH_DEV_LOGIN there):
npm run build
# The Drive sync tests use a fake Google Drive that the test runner starts on port 4555:
NODE_ENV=test AUTH_DEV_LOGIN=true \
  GOOGLE_API_ROOT_URL=http://localhost:4555/ GOOGLE_CLIENT_ID=test GOOGLE_CLIENT_SECRET=test \
  TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 32) \
  npm run start:test   # point DB_* at a throwaway database
npm run test:e2e                 # in another terminal
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

- Browsers show their own fixed wording in the "Leave site?" dialog. A page cannot add a
  "Save" button to it. Your work is still kept in the browser draft and offered back on the next visit.
- Google's `drive.file` permission only lets the app see Drive files it created. New Google Docs
  you create by hand in Drive aren't imported.
