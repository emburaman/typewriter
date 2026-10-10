# Test checklist

## Automated

| Suite | Command | Covers |
|---|---|---|
| Types | `npm run typecheck` | Strict TS for UI and server |
| Unit (Vitest) | `npm test` | Footnote sync in a real TipTap editor (jsdom) · embed safety (pasted iframes and `javascript:` dropped, iframe src always rebuilt) · YouTube/Vimeo URL parsing · link normalization · media type detection · Drive export of embeds · file-tree helpers (sorting, descendants, drop rules, cycle-safe ancestors) · Key → sound mapping, sound cookie parsing and serialization · Settings/document validation (5-color cap, hex colors, safe font names, UUID ids), AES-GCM token encryption (round trip, tamper, wrong key), API error → status mapping (no leaked internals), word count, UUID fallback for HTTP contexts |
| E2E (Playwright) | `npm run test:e2e` (app running) | Markdown shortcuts (headings, quote, rule, code, code block, `[text](url)`) · heading picker and Ctrl+Alt+n · link dialog (Ctrl+K, unsafe URLs rejected) · footnotes (numbering, two-way links, renumbering, removal) · media dialog (YouTube, image with alt text, audio with a manual type) · Files panel (create and rename folders, new document saved into a folder, drag and drop of documents and folders, refused cyclic drop, Move to…, deleting a folder moves its contents up) · Typewriter sound plays on keystrokes, stays silent for shortcuts and navigation keys, toggle persists in the `ow_sound` cookie · Olive Writer branding · Ctrl+B/I/U · `1. ` / `- ` lists · Tab nests right after the marker, Shift+Tab un-nests · Tab elsewhere inserts `\t` · Ctrl+1…5 / Ctrl+0 colors with clean HTML · 5 s browser autosave and restore after reload · Ctrl+S saves (verified via API) · unload prompt when unsaved · theme toggle persists · settings palette cap and persistence |

## Manual checklist

**Editor**
- [ ] Title → `Enter` moves into the body without losing characters typed quickly
- [ ] `Ctrl+B`, `Ctrl+I`, `Ctrl+U` toggle on the selection and at the cursor
- [ ] `Ctrl+1`…`Ctrl+5` apply palette colors in order. Pressing the same shortcut again returns to the default color
- [ ] `Ctrl+0` and the eraser button return to the default color
- [ ] With 3 palette colors, `Ctrl+4` does nothing in the editor
- [ ] `1. ` → numbered list; `7. ` → list starting at 7; `- ` → bulleted list
- [ ] `Tab` directly after the bullet/number nests; `Shift+Tab` un-nests; `Tab` mid-text inserts a tab
- [ ] `Enter` on an empty list item leaves the list
- [ ] Toolbar buttons show their active state and keep the text selection
- [ ] Toolbar and header fade while typing and return when the mouse moves

**Branding and sound**
- [ ] Light theme: background `#FFFBDB`, logo "Olive" `#625834` and "Writer" `#A59132`
- [ ] Dark theme: background `#30362F`, logo "Olive" `#FFFBDB` and "Writer" `#625834`
- [ ] The browser tab shows "Olive Writer" and the olive "O" favicon
- [ ] Typing letters makes typewriter strikes; Space, Backspace and Enter each sound different
- [ ] Ctrl+B, arrow keys and Esc make no sound
- [ ] The speaker icon turns sound off; after a reload it's still off; the Settings checkbox matches

**Markdown formatting**
- [ ] `# ` … `###### ` give H1–H6. The Text style picker and Ctrl+Alt+1…6 change the current block
- [ ] `> ` quotes, and Enter on an empty quote line exits the quote
- [ ] `---` gives a horizontal line. It can be selected (click it) and deleted
- [ ] `` `code` `` and Ctrl+E give inline code; ```` ``` ```` + space gives a code block where Tab inserts a tab
- [ ] Ctrl+K on selected text links it; on a link it offers Update / Remove; `javascript:` is refused
- [ ] Typing `[site](https://example.com)` creates a link; Ctrl+click opens it in a new tab
- [ ] Ctrl+Alt+F inserts footnote 1 and moves the cursor into its note; a second footnote earlier in the text becomes 1 and the first becomes 2
- [ ] Clicking a footnote number jumps to its note; ↩ jumps back; deleting the number removes the note
- [ ] Insert media: a YouTube link with `t=1m30s` starts at 1:30; Vimeo links play; an image URL shows the image with alt text; .mp3 / .mp4 show players
- [ ] Pasting HTML that contains an `<iframe>` from another site doesn't add it
- [ ] With Drive enabled, the Drive copy shows "▶ Video: link" in place of each player

**Files and folders**
- [ ] New folder → rename inline (Enter saves, Esc cancels)
- [ ] ⋯ → New document here → write → Ctrl+S → the document appears inside that folder
- [ ] Drag a document onto a folder, and onto the empty area (top level)
- [ ] Drag a folder into another folder; dropping a folder into its own sub-folder isn't highlighted and does nothing
- [ ] ⋯ → Move to… lists every folder except the item itself and its sub-folders
- [ ] Delete a folder that has contents → they appear in the parent folder
- [ ] Reopen the panel → expanded folders are remembered, and the open document's folder is expanded

**Saving**
- [ ] The status bar changes to "Unsaved · browser draft hh:mm" within 5 s of typing
- [ ] `Ctrl+S` → "Saved hh:mm"; the document appears in the Documents drawer
- [ ] Reload after an unsaved edit → the draft is restored and a "Save to server" toast appears
- [ ] Close the tab with unsaved changes → the browser shows its leave prompt; with no unsaved changes → no prompt
- [ ] Stop the app container, keep typing → autosave continues; `Ctrl+S` shows an error toast, nothing is lost
- [ ] New document with unsaved changes → confirm dialog; Cancel keeps a browser draft listed in the drawer
- [ ] Delete a document from the drawer → it's removed from the list

**Settings**
- [ ] Theme Light / Dark / System applies immediately. System follows the OS setting live
- [ ] Reloading in dark theme doesn't flash light
- [ ] Font: choosing "Special Elite" previews and then applies to the editor
- [ ] Font: an invalid name (with punctuation) disables Apply
- [ ] Font size slider changes the editor text size
- [ ] Colors: add (up to 5), remove (down to 1), reorder, reset. The toolbar and shortcuts follow
- [ ] Without Google environment variables: the Drive card explains the configuration and the Drive radio button is disabled

**Google Drive** (needs real OAuth credentials)
- [ ] Connect → Google consent → back on Settings with "Google Drive connected" and the account email
- [ ] Choose "Server + Google Drive" → `Ctrl+S` → a Google Doc appears in the `Olive Writer` folder
- [ ] Saving again updates the same Drive file
- [ ] Delete the file in Drive, then save → it's created again
- [ ] Rename the folder in Settings, then save → the new folder is used
- [ ] Revoke access in your Google account, then save → the server save succeeds and a Drive error toast appears
- [ ] Disconnect → storage switches back to "Server only"
- [ ] A tampered `state` in the callback URL → redirected with an error and not connected

**API** (see docs/API.md): status codes 200/201/204/400/404/409/502 as documented; malformed JSON → 400.

**Docker**
- [ ] `docker compose up --build` → app on :4000, hot reload works
- [ ] `docker compose -f docker-compose.prod.yml up -d --build` → container reports `healthy`
- [ ] Restarting the app doesn't re-run applied migrations
