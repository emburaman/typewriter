# Features

## 1. Clean, distraction-free UI

- **Branding**: the *Olive Writer* wordmark (from `assets/brand/`) sits in the top-left corner. Its
  colors follow the theme:

  | Theme | Background | "Olive" | "Writer" |
  |---|---|---|---|
  | Light | `#FFFBDB` | `#625834` | `#A59132` |
  | Dark | `#30362F` | `#FFFBDB` | `#625834` |

  The other UI colors (cards, borders, text, accent) are derived from these olive tones. All of them
  are CSS variables at the top of `app/globals.css`.

- One centered writing column (about 72 characters wide) in a typewriter font. The page leaves
  space below the text so the line you're typing doesn't sit at the bottom edge of the screen.
- **Focus mode**: as soon as you type, the header and toolbar fade out and the status bar dims.
  Moving the mouse, or tabbing into a control, brings them back.
- **Themes**: Light, Dark or System (follows the OS and updates live when the OS setting changes).
  To switch, use the sun/moon/monitor button in the header (it cycles through the three) or
  *Settings → Appearance*. A small script runs before the page renders and applies the theme from
  the browser's copy of your settings, so dark mode never flashes white.
- The status bar shows whether the document is saved, the time of the last browser draft or server
  save, and the word count. An amber dot means the server copy is behind.

## 1.1 Typewriter sound

- Every keystroke in the title or the page plays a typewriter sound, synthesized live with the Web
  Audio API (there are no audio files):
  - **letters, digits, punctuation, Tab**: a sharp type-bar strike with a low body thud,
    slightly varied each time so fast typing sounds natural;
  - **Space**: a softer, deeper thump;
  - **Backspace / Delete**: a light click;
  - **Enter**: a ratcheting carriage return, a clunk, then the margin bell.
- Shortcuts (`Ctrl/⌘/Alt` combinations), modifier keys and navigation keys (arrows, Home, End, Esc)
  make no sound. A real typewriter doesn't have those keys.
- **On/off**: the speaker icon in the header, or *Settings → Appearance → Typewriter sound*. The
  choice is stored in the `ow_sound` cookie (`on`/`off`, one year, `SameSite=Lax`) and applies to
  this browser only. The default is on.
- Browsers only allow audio after the first user interaction, so the sound engine starts on your
  first keystroke.

## 2. Settings → Storage (Google Drive)

- **Server only** (default): `Ctrl+S` saves to MySQL.
- **Server + Google Drive**: each save also uploads the document to Google Drive as a
  **Google Doc**, converted from the editor's HTML, in the `Olive Writer` folder by default. Later saves update the same Drive file. If you
  delete it in Drive, the next save creates a new one.
- Connect and disconnect from Settings. You can rename the Drive folder there too; it's created
  on the next save if it doesn't exist.
- Security: OAuth tokens are encrypted with AES-256-GCM in MySQL and never sent to the browser.
  The scope is `drive.file`, so the app can only see files it created. The OAuth flow is protected
  by a one-time `state` value.
- If a Drive upload fails, the server save still succeeds and a notice explains what went wrong.

See the README for the Google Cloud setup.

## 3. Simple formatting

| Format | Toolbar | Keyboard |
|---|---|---|
| Bold | **B** | `Ctrl+B` |
| Italic | *I* | `Ctrl+I` |
| Underline | U | `Ctrl+U` |
| Font color *n* (1–5) | colored dots, numbered | `Ctrl+n` (fallback `Alt+n`). Press it again to go back to the default color. |
| Default color | eraser | `Ctrl+0` |
| Bulleted list | • list | type `- ` at the start of a line (`* ` and `+ ` also work) |
| Numbered list | 1. list | type `1. ` at the start of a line. Any number works: `3. ` starts the list at 3. |
| Nest list item | — | `Tab` right after the bullet or number (or with text selected in a list) |
| Un-nest list item | — | `Shift+Tab` |
| Leave a list | — | `Enter` on an empty item, or `Backspace` at the start of an item |

On macOS, use ⌘ in place of Ctrl.

Other details:

- **Tab** anywhere else inserts a real tab character, like a typewriter, and doesn't move focus.
  Press `Esc` to move keyboard focus out of the editor.
- Headings, quotes, code blocks and links are switched off on purpose, so Markdown-like typing
  (`# `, `> `) never reformats your text unexpectedly.
- Nested numbered lists use 1 → a → i. Nested bulleted lists use • → ◦ → ▪.

### 3.1 Toolbar colors (Settings → Toolbar colors)

- Between 1 and 5 colors. The *n*th color is the one `Ctrl+n` applies.
- Each color can be changed with a color picker, moved up or down (which changes its shortcut
  number), or removed. You can also reset to the defaults.
- The default palette uses mid-tone colors (red, blue, green, orange, purple) that stay readable
  in both light and dark themes.

### 3.2 Font face (Settings → Appearance)

- Any **Google Fonts** family. A curated list is offered (Courier Prime, Special Elite, IBM Plex
  Mono, Literata, and others). With `GOOGLE_FONTS_API_KEY`, you can search the full catalog.
- A live preview shows the font before you apply it.
- The app requests regular, bold and italic faces. If a family has no bold or italic face, it
  falls back to the regular face and the browser imitates the missing styles.
- Font size can be set from 12 to 32 px.

## 4. Auto-save and leave protection

- **Every 5 seconds**, if anything changed, the document (title and content) is written to the
  browser's `localStorage`. Drafts are also written immediately when the tab is hidden or closed.
- `Ctrl+S` (or the save icon) saves to the **server**, and to Drive if that's enabled.
- **Closing or reloading** the tab when the server copy is behind triggers the browser's "Leave
  site? Changes you made may not be saved" dialog. Browsers show their own fixed wording here.
- **Recovery**: when a document opens, the app compares the browser draft with the server copy.
  If the draft is newer, the app restores it and offers **Save to server**.
- If the server can't be reached, writing continues and the browser draft keeps being saved.
- **Switching documents** with unsaved changes asks whether to save first. Either answer is safe:
  if you don't save, the changes stay in the browser draft, and the drawer lists it under
  "Browser drafts".
