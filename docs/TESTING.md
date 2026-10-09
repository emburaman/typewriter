# Test checklist

## Automated

| Suite | Command | Covers |
|---|---|---|
| Types | `npm run typecheck` | Strict TS for UI and server |
| Unit (Vitest) | `npm test` | Settings/document validation (5-color cap, hex colors, safe font names, UUID ids), AES-GCM token encryption (round trip, tamper, wrong key), API error → status mapping (no leaked internals), word count, UUID fallback for HTTP contexts |
| E2E (Playwright) | `npm run test:e2e` (app running) | Ctrl+B/I/U · `1. ` / `- ` lists · Tab nests right after the marker, Shift+Tab un-nests · Tab elsewhere inserts `\t` · Ctrl+1…5 / Ctrl+0 colors with clean HTML · 5 s browser autosave and restore after reload · Ctrl+S saves (verified via API) · unload prompt when unsaved · theme toggle persists · settings palette cap and persistence |

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
- [ ] Choose "Server + Google Drive" → `Ctrl+S` → a Google Doc appears in the `Typewriter` folder
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
