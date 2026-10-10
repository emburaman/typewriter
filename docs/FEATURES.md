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
| Heading 1–6 | "Text style" picker | type `# ` … `###### ` at the start of a line, or `Ctrl+Alt+1…6` (`Ctrl+Alt+0` = paragraph) |
| Quote | ❝ | type `> `, or `Ctrl+Shift+B` |
| Horizontal line | — | type `---` on an empty line |
| Inline code | `</>` | wrap in backticks: `` `code` ``, or `Ctrl+E` |
| Code block | ▣ | type ```` ``` ```` + space (```` ```js ```` + space sets a language label), or `Ctrl+Alt+C`. `Tab` inserts a tab inside it. |
| Link | 🔗 | `Ctrl+K`, or type `[text](https://…)`. URLs you paste or type are linked automatically. |
| Footnote | x¹ | `Ctrl+Alt+F` |
| Image / audio / video / YouTube / Vimeo | 🖼 | Insert media dialog. You can also type `![alt](https://…image)`. |

On macOS, use ⌘ in place of Ctrl.

Other details:

- **Links**: a normal click places the cursor, which is what you want while writing.
  `Ctrl/⌘+click` opens the link in a new tab. Only `http(s)`, `mailto:` and in-document `#anchor`
  links are accepted; `javascript:` and similar are refused.
- **Footnotes** are the in-document links. `Ctrl+Alt+F` (or x¹) inserts a superscript number at
  the cursor and moves you to a new note in the **Notes** section at the end of the document.
  Clicking a number jumps to its note, and the ↩ in a note jumps back. Numbers always follow
  reading order: if you add a footnote earlier in the text, or delete one, all the numbers update
  and the notes reorder to match. Deleting a number deletes its note. The saved HTML uses standard
  `#fn-…` / `#fnref-…` anchors, so the links also work in exported copies.
- **Media from a URL**: the Insert media dialog takes a link and works out what it is:
  - a **YouTube** link (`watch?v=`, `youtu.be`, Shorts, with `t=` start times) or a **Vimeo**
    link (including unlisted links with a hash) becomes an embedded player;
  - a link to an image, audio or video file becomes an image or a native player. If the address
    has no file extension, choose the type yourself.
  - Images take a description (alt text) for accessibility.
- **Privacy and safety for embeds**: YouTube plays through `youtube-nocookie.com` and Vimeo with
  Do-Not-Track. The document stores only the provider and video id, and the player address is
  rebuilt from those every time, so pasted or edited HTML can never frame another site. The app's
  Content-Security-Policy only allows those two players in frames.
- **Google Drive copies**: Google Docs can't hold embedded players, so in the Drive copy each
  video and audio player becomes a "▶ Video: <link>" line. Images, headings, quotes, code, links
  and footnotes are converted normally.
- **Tab** anywhere else inserts a real tab character, like a typewriter, and doesn't move focus.
  Press `Esc` to move keyboard focus out of the editor.
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

## 3.3 Files and folders (the Files panel)

Open it with the files icon in the header.

- **Folders**: *New folder* at the top creates a top-level folder and opens it for renaming. Each
  folder's **⋯** menu has *New document here*, *New folder inside*, *Rename*, *Move to…* and
  *Delete folder*.
- **Documents** are listed inside their folder (folders first, then documents, both A→Z with
  natural number order, so "Chapter 2" comes before "Chapter 10"). Click one to open it. Its **⋯**
  menu has *Open*, *Move to…* and *Delete*.
- **Moving things**:
  - **Drag and drop** a document or folder onto a folder to move it inside, or onto the empty
    area of the panel to move it to the top level. The target is highlighted, and drops that
    aren't allowed (a folder into itself or its own sub-folder) are refused.
  - **Move to…** does the same with a list of destinations, so it also works with a keyboard and
    on touch screens.
- **New document in a folder**: the new document starts as a browser draft and is saved into
  that folder on its first `Ctrl+S`.
- **Deleting a folder** never deletes writing: its documents and sub-folders move up to the
  folder's parent.
- Folders you expand are remembered in this browser, and the folders above the open document
  are expanded automatically.
- Browser-only drafts (never saved to the server) are listed separately at the top. They can't
  be moved until they are saved.
- Google Drive copies stay in the single Drive folder from Settings. Folders are not mirrored to
  Drive yet.

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
