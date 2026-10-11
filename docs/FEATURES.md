# Features

## 0. Accounts

- **Sign in with Google**, invite-only. The first person to sign in becomes the admin (restricted
  to `ADMIN_EMAIL` when set) and keeps any writing that was on the server before accounts existed.
- **Settings → Users** (admins): invite an email as Member or Admin, cancel invites, remove
  people. Removing someone deletes their writing on the server; their Drive copies remain.
- **Everything is per person**: documents, folders, settings (theme, font, colors, storage) and
  the Google Drive connection. Each person connects their own Drive in Settings → Storage.
- The avatar menu at the top right shows who is signed in and has *Sign out*. **Settings →
  Account** shows the same.
- Browser drafts and remembered UI state are stored per person, so two people can share a
  browser without seeing each other's drafts. The typewriter-sound choice is a per-browser
  cookie.

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
  save, and counts for the open document:
  - **paragraphs**: non-empty text blocks (paragraphs, headings, list items, quotes, code blocks);
  - **lines**: lines of text as currently wrapped on screen, like Word's line count. It changes
    with the window width, font and font size;
  - **words**.

  Blank lines and footnotes don't count as paragraphs or lines. An amber dot means the server copy is behind.

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
  **Google Doc**, converted from the editor's HTML. Later saves update the same Drive file. If you
  delete it in Drive, the next save creates a new one.
- **Folders are mirrored.** Everything lives under one Drive folder (`Olive Writer` by default),
  and your app folders become real Drive folders inside it:

  ```
  My Drive / Olive Writer / Novel / Chapters / Chapter One   (Google Doc)
  ```

  With Drive storage on, Drive follows what you do in the Files panel right away:
  - creating, renaming or moving a folder does the same in Drive;
  - moving a document moves its Google Doc;
  - deleting a folder moves its Drive contents up a level, the same as in the app, and puts the
    emptied Drive folder in Drive's **trash**, so it can be recovered;
  - renaming the Drive folder in Settings renames the existing folder in Drive.
- **Self-repairing**: every save re-checks the document's folder path in Drive. Folders deleted
  or renamed by hand in Drive are recreated or renamed back, and files are moved back where they
  belong. The app is the source of truth.
- **Sync everything to Drive now** (Settings → Storage) creates any missing folders, puts files in
  the right place and uploads every document. Use it after turning Drive storage on, so writing
  saved before then gets copied, or after changing things in Drive by hand.
- Deleting a *document* in the app leaves its Drive copy alone.
- Connect and disconnect from Settings.
- Security: OAuth tokens are encrypted with AES-256-GCM in MySQL and never sent to the browser.
  The scope is `drive.file`, so the app can only see files it created. The OAuth flow is protected
  by a one-time `state` value.
- If a Drive step fails (an upload, or mirroring a folder change), the change in the app still
  succeeds and a notice gives Google's reason. The next save or "Sync everything" catches Drive up.

See the README for the Google Cloud setup.

## 3. Simple formatting

| Format | Toolbar | Keyboard |
|---|---|---|
| Bold | **B** | `Ctrl+B` |
| Italic | *I* | `Ctrl+I` |
| Underline | U | `Ctrl+U` |
| Font color *n* (1–5) | colored dots, numbered | `Ctrl+n` (fallback `Alt+n`). Press it again to go back to the default color. |
| Default color | swatch **0**, left of color 1, filled with the theme's text color | `Ctrl+0` |
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
- With Google Drive storage on, folder changes are mirrored in Drive (see section 2).

## 4. Saving, and working across devices

- **Auto-save to the server.** A few seconds after you pause typing, and at least every 20 seconds
  while you keep typing, the document is saved to the server, with no `Ctrl+S` needed. The status
  bar shows *Editing…*, then *Saving…*, then *Saved hh:mm*.
- **Browser copy.** Every 5 seconds, and whenever the tab is hidden or closed, the document is
  also kept in this browser's storage, so nothing is lost while offline.
- **Google Drive**: background auto-saves refresh the Drive copy at most every 2 minutes, so typing
  doesn't trigger a stream of uploads. `Ctrl+S` (or the save icon) saves to the server **and**
  uploads to Drive right away.
- **Offline**: if the server can't be reached, writing continues and the status bar shows
  *Offline · saved in this browser*. The app retries every 10 seconds and saves as soon as the
  server is back.
- **Other devices**: sign in with the same Google account anywhere.
  - A device you haven't used before opens your **most recently edited** document. Everything
    else is in **Files**.
  - A document open on another device **updates itself** when you switch back to that device,
    and every 30 seconds while it's open and untouched there. A notice says "Updated with changes
    from another device".
- **Edited on two devices at once?** Every save carries the document's revision number. If
  another device saved in between, nothing is overwritten. A dialog asks what to do:
  - **Keep both**: your version is saved as "<title> (conflict copy)", and this document shows
    the other device's version;
  - **Use the other version**: discard your changes here;
  - **Overwrite with mine**: replace the other device's changes with yours.

  Closing the dialog keeps your text on screen. Auto-save pauses until you choose, and the status
  bar has a *Resolve* link.
- **Closing or reloading** the tab with changes the server doesn't have yet triggers the browser's
  "Leave site?" dialog. Browsers show their own fixed wording here.
- **Recovery**: when a document opens, unsaved changes kept in this browser are restored if
  they continue from the server's version. If the document was changed elsewhere since, the
  conflict dialog lets you choose.
- **Switching documents** saves the current one first, in the background. If you're offline it
  stays in this browser's drafts, listed in Files under "Browser drafts".
