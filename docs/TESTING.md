# Test checklist

## Automated

| Suite | Command | Covers |
|---|---|---|
| Types | `npm run typecheck` | Strict TS for UI and server |
| Unit (Vitest) | `npm test` | Drive pull rules one by one (edits, metadata-only bumps, conflicts, baseline, renames and moves, trash and restore, other-account safety, folder changes, imports) · Google Docs HTML → editor (redirect links, default black, footnotes, players) · Drive folder mirroring against an in-memory Drive (nesting, renames, moves, deletes to trash, repair after manual changes, root rename, cycle safety) · Footnote sync in a real TipTap editor (jsdom) · embed safety (pasted iframes and `javascript:` dropped, iframe src always rebuilt) · YouTube/Vimeo URL parsing · link normalization · media type detection · Drive export of embeds · file-tree helpers (sorting, descendants, drop rules, cycle-safe ancestors) · Key → sound mapping, sound cookie parsing and serialization · Settings/document validation (5-color cap, hex colors, safe font names, UUID ids), AES-GCM token encryption (round trip, tamper, wrong key), API error → status mapping (no leaked internals), word count, UUID fallback for HTTP contexts |
| E2E (Playwright) | `npm run test:e2e` (app running with `NODE_ENV=test AUTH_DEV_LOGIN=true`, plus the fake-Drive variables, see README) | **Two-way Drive sync against a fake Drive**: app → Drive into folders; Google Docs edit → app (converted, no echo back); an open document updates on focus; Drive renames and moves → app; trashed and restored in Drive → app Trash and back; deleted and restored in the app → Drive trash and back; both sides edited → copy; Drive folder trashed → documents to Trash · app Trash (Undo, Restore, delete forever) ·  Cross-device (two browser contexts, one account): server autosave without Ctrl+S, a new device opens the latest document, opening a document doesn't save it, an open document refreshes when you come back, conflicting edits show the dialog (Keep both saves a copy; Overwrite with mine wins), stale `baseRevision` → 409 with the current version ·  Accounts: signed-out redirect and 401s, invite-only sign-in, members can't manage users, **isolation** (another user's documents and folders can't be read, overwritten, moved, deleted or used as a parent, even with known ids; settings are separate), removing a user ends their session, sign-out, cross-site writes refused ·  Markdown shortcuts (headings, quote, rule, code, code block, `[text](url)`) · heading picker and Ctrl+Alt+n · link dialog (Ctrl+K, unsafe URLs rejected) · footnotes (numbering, two-way links, renumbering, removal) · media dialog (YouTube, image with alt text, audio with a manual type) · Files panel (create and rename folders, new document saved into a folder, drag and drop of documents and folders, refused cyclic drop, Move to…, deleting a folder moves its contents up) · Typewriter sound plays on keystrokes, stays silent for shortcuts and navigation keys, toggle persists in the `ow_sound` cookie · Olive Writer branding · Ctrl+B/I/U · `1. ` / `- ` lists · Tab nests right after the marker, Shift+Tab un-nests · Tab elsewhere inserts `\t` · Ctrl+1…5 / Ctrl+0 colors with clean HTML · 5 s browser autosave and restore after reload · Ctrl+S saves (verified via API) · unload prompt when unsaved · formatting toolbar hide/reveal (load timer, typing, wheel, swipe) · phone hamburger menu and taller desktop header · theme toggle persists · settings palette cap and persistence |

## Manual checklist

**Accounts**
- [ ] Fresh install: the sign-in page says the first sign-in becomes admin. Signing in with `ADMIN_EMAIL` works, and any other account is refused
- [ ] Upgrade from the single-user version: the first admin sign-in shows all existing documents, folders, settings and the Drive connection
- [ ] Settings → Users: invite an email; that person can sign in with Google; a non-invited Google account gets "hasn't been invited"
- [ ] The invited person sees an empty Files panel, and their own default settings
- [ ] Each person connects a different Google Drive; their saves go to their own Drive
- [ ] Two people on the same browser (sign out, sign in as the other) don't see each other's drafts
- [ ] Remove a user → they're signed out on their next request, and their documents are gone from the server
- [ ] Sign out → back to the sign-in page; reloading `/` asks to sign in again

**Editor**
- [ ] Title → `Enter` moves into the body without losing characters typed quickly
- [ ] `Ctrl+B`, `Ctrl+I`, `Ctrl+U` toggle on the selection and at the cursor
- [ ] `Ctrl+1`…`Ctrl+5` apply palette colors in order. Pressing the same shortcut again returns to the default color
- [ ] `Ctrl+0` and swatch 0 (left of color 1) return to the default color. Swatch 0 shows the theme's text color in light and dark, and is highlighted while no color is applied
- [ ] With 3 palette colors, `Ctrl+4` does nothing in the editor
- [ ] `1. ` → numbered list; `7. ` → list starting at 7; `- ` → bulleted list
- [ ] `Tab` directly after the bullet/number nests; `Shift+Tab` un-nests; `Tab` mid-text inserts a tab
- [ ] `Enter` on an empty list item leaves the list
- [ ] Toolbar buttons show their active state and keep the text selection
- [ ] Header fades while typing and returns when the mouse moves
- [ ] Formatting toolbar: visible on load, hidden after 5 s; hidden when typing starts; mouse wheel / trackpad scroll and a phone swipe bring it back, and it hides again 5 s later; it stays while hovered
- [ ] Header is taller on desktop; at phone width the actions are in the ☰ menu (Files, New document, Save, sound, theme, Settings, Sign out), which closes on Esc or a tap outside

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

**Status bar counts**
- [ ] Two paragraphs and a heading → "3 paragraphs"; empty lines and footnotes don't change the count
- [ ] A paragraph long enough to wrap counts as several lines; narrowing the window or raising the font size increases the line count

**Two-way Google Drive sync** (real Google account)
- [ ] Edit a document in Google Docs → within a minute (or on switching back to the app) the app shows the edit; colors, bold, lists, links and footnotes survive
- [ ] Rename / move a document between Olive Writer folders in Drive → same in the app
- [ ] Trash a document in Drive → it's in the app's Trash; restore it in Drive → it's back
- [ ] Delete a document in the app → it's in Drive's trash; Restore in the app → it's back in Drive
- [ ] Edit the same document in the app and in Google Docs within a minute → the app keeps its version and adds "(Google Docs version)"
- [ ] Trash the whole Olive Writer folder in Drive → everything is in the app's Trash and can be restored

**Cross-device**
- [ ] Write on device A without pressing Ctrl+S → within a few seconds the status bar says "Saved"
- [ ] Sign in on device B for the first time → it opens that document
- [ ] Keep B open, write more on A, switch back to B → B updates and says so
- [ ] Edit the same document on A and B before either syncs → the second one to save sees "Changed on another device"; try each of the three choices
- [ ] Turn the network off on A, keep typing → "Offline · saved in this browser"; turn it back on → it saves by itself within ~10 s
- [ ] With Drive on: typing for several minutes updates the Drive copy about every 2 minutes; Ctrl+S uploads immediately

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
- [ ] Settings → "Sync everything to Drive now" → Drive shows `Olive Writer / <your folders> / <documents>`
- [ ] Create, rename and move a folder in the Files panel → the same happens in Drive
- [ ] Move a document between folders → its Google Doc moves in Drive
- [ ] Delete a folder → its Drive contents move up and the empty Drive folder is in Drive's trash
- [ ] Rename the Drive folder in Settings → the existing Drive folder is renamed (no second root folder)
- [ ] Delete or rename a sub-folder by hand in Drive, then save a document in it → the folder is recreated or renamed back
- [ ] With Drive failing (e.g. revoke access in your Google account), moving and creating folders still works in the app and shows a "Google Drive wasn't updated" notice
- [ ] A tampered `state` in the callback URL → redirected with an error and not connected

**API** (see docs/API.md): status codes 200/201/204/400/404/409/502 as documented; malformed JSON → 400.

**Docker**
- [ ] `docker compose up --build` → app on :4000, hot reload works
- [ ] `docker compose -f docker-compose.prod.yml up -d --build` → container reports `healthy`
- [ ] Restarting the app doesn't re-run applied migrations
