import { expect, test, type Page } from "@playwright/test";

const DEFAULT_COLORS = ["#d64541", "#2e86de", "#27ae60", "#e67e22", "#9b59b6"];

async function openEditor(page: Page) {
  await page.goto("/");
  await expect(page.locator(".editor-content")).toHaveAttribute("contenteditable", "true");
}

const editorHtml = (page: Page) => page.locator(".editor-content").innerHTML();

test.beforeEach(async ({ request }) => {
  await request.put("/api/settings", { data: { theme: "system", toolbarColors: DEFAULT_COLORS } });
});

test("bold, italic and underline shortcuts", async ({ page }) => {
  await openEditor(page);
  const k = page.keyboard;
  await k.type("a ");
  await k.press("ControlOrMeta+b");
  await k.type("bold");
  await k.press("ControlOrMeta+b");
  await k.type(" ");
  await k.press("ControlOrMeta+i");
  await k.type("it");
  await k.press("ControlOrMeta+i");
  await k.type(" ");
  await k.press("ControlOrMeta+u");
  await k.type("un");
  const html = await editorHtml(page);
  expect(html).toContain("<strong>bold</strong>");
  expect(html).toContain("<em>it</em>");
  expect(html).toContain("<u>un</u>");
});

test('"1. " and "- " start lists; Tab right after the marker nests, Shift+Tab un-nests', async ({ page }) => {
  await openEditor(page);
  const k = page.keyboard;
  await k.type("1. first");
  await k.press("Enter");
  await k.press("Tab");
  await k.type("nested");
  await k.press("Enter");
  await k.press("Shift+Tab");
  await k.type("second");
  await k.press("Enter");
  await k.press("Enter");
  await k.type("- bullet");
  await k.press("Enter");
  await k.press("Tab");
  await k.type("sub");

  const html = await editorHtml(page);
  expect(html).toMatch(/<ol[^>]*><li><p>first<\/p><ol[^>]*><li><p>nested<\/p><\/li><\/ol><\/li><li><p>second<\/p>/);
  expect(html).toMatch(/<ul><li><p>bullet<\/p><ul><li><p>sub<\/p><\/li><\/ul>/);
});

test("Tab elsewhere inserts a tab character", async ({ page }) => {
  await openEditor(page);
  await page.keyboard.type("a");
  await page.keyboard.press("Tab");
  await page.keyboard.type("b");
  expect(await editorHtml(page)).toContain("a\tb");
});

test("Ctrl+1…5 apply palette colors, pressing again or Ctrl+0 resets", async ({ page }) => {
  await openEditor(page);
  const k = page.keyboard;
  await k.press("ControlOrMeta+2");
  await k.type("blue");
  await k.press("ControlOrMeta+2");
  await k.type(" plain ");
  await k.press("ControlOrMeta+1");
  await k.type("red");
  await k.press("ControlOrMeta+0");
  await k.type(" end");
  const html = await editorHtml(page);
  expect(html).toMatch(/<span style="color: rgb\(46, 134, 222\);">blue<\/span> plain /);
  expect(html).toMatch(/<span style="color: rgb\(214, 69, 65\);">red<\/span> end/);
  expect(html).not.toContain("<span>");
});

test("autosaves to the browser every 5 seconds and restores after reload", async ({ page }) => {
  await openEditor(page);
  await page.keyboard.type("draft text");
  await expect(page.locator(".statusbar")).toContainText("browser draft", { timeout: 7_000 });
  const draft = await page.evaluate(() => {
    // Browser storage is per user: typewriter:<userId>:…
    const user = localStorage.getItem("typewriter:last-user");
    const id = localStorage.getItem(`typewriter:${user}:current`);
    return JSON.parse(localStorage.getItem(`typewriter:${user}:draft:${id}`) ?? "null") as { unsynced: boolean } | null;
  });
  expect(draft?.unsynced).toBe(true);

  page.on("dialog", (d) => void d.accept());
  await page.reload();
  await expect(page.locator(".editor-content")).toContainText("draft text");
});

test("Ctrl+S saves to the server; closing with unsaved changes prompts", async ({ page, request }) => {
  await openEditor(page);
  await page.locator(".doc-title-input").fill("E2E document");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Saved words here");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.locator(".statusbar")).toContainText(/Saved \d/);

  const id = await page.evaluate(() => localStorage.getItem(`typewriter:${localStorage.getItem("typewriter:last-user")}:current`));
  const res = await request.get(`/api/documents/${id}`);
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ title: "E2E document", wordCount: 3 });

  await page.keyboard.type(" and more");
  let prompted = false;
  page.on("dialog", async (d) => {
    prompted = d.type() === "beforeunload";
    await d.dismiss();
  });
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => prompted).toBe(true);

  await request.delete(`/api/documents/${id}`);
});

test("theme toggle cycles and persists across reloads", async ({ page }) => {
  await openEditor(page);
  const toggle = page.locator('button[aria-label^="Theme"]');
  await toggle.click(); // system → light
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await toggle.click(); // light → dark
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("settings: palette is capped at 5 colors and changes persist", async ({ page, request }) => {
  await page.goto("/settings");
  await expect(page.getByRole("button", { name: "Add color" })).toBeDisabled();
  await page.getByRole("button", { name: "Remove color 5" }).click();
  await expect(page.getByRole("button", { name: "Add color" })).toBeEnabled();
  await expect.poll(async () => (await (await request.get("/api/settings")).json()).toolbarColors.length).toBe(4);
});

/** Counts Web Audio sources started, so tests can tell whether a keystroke made a sound. */
async function instrumentAudio(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __soundStarts: number };
    w.__soundStarts = 0;
    const original = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof original>) {
      w.__soundStarts += 1;
      return original.apply(this, args);
    };
  });
}
const soundStarts = (page: Page) => page.evaluate(() => (window as unknown as { __soundStarts: number }).__soundStarts);

test("typewriter sound plays on keystrokes and the toggle persists in a cookie", async ({ page, context }) => {
  await instrumentAudio(page);
  await openEditor(page);
  const toggle = page.getByRole("button", { name: "Typewriter sound" });
  await expect(toggle).toHaveAttribute("aria-pressed", "true"); // on by default

  await page.keyboard.type("abc");
  await expect.poll(() => soundStarts(page)).toBeGreaterThan(0);

  // Shortcuts and navigation keys are silent.
  const beforeShortcuts = await soundStarts(page);
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.press("ArrowLeft");
  expect(await soundStarts(page)).toBe(beforeShortcuts);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name === "ow_sound")?.value).toBe("off");

  await page.locator(".editor-content").click();
  const beforeMuted = await soundStarts(page);
  await page.keyboard.type("silent");
  expect(await soundStarts(page)).toBe(beforeMuted);

  page.on("dialog", (d) => void d.accept());
  await page.reload();
  await expect(page.getByRole("button", { name: "Typewriter sound" })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Typewriter sound" }).click(); // restore default for other tests
});

test("Olive Writer branding is shown", async ({ page }) => {
  await openEditor(page);
  await expect(page).toHaveTitle("Olive Writer");
  await expect(page.getByRole("img", { name: "Olive Writer" })).toBeVisible();
});

/* ------------------------------------------------------------------ */
/* Markdown formatting                                                 */
/* ------------------------------------------------------------------ */

test("markdown shortcuts: headings, quote, rule, code, code block, links", async ({ page }) => {
  await openEditor(page);
  const k = page.keyboard;
  await k.type("# Title");
  await k.press("Enter");
  await k.type("###### Small");
  await k.press("Enter");
  await k.type("> quoted");
  await k.press("Enter");
  await k.press("Enter");
  await k.type("---");
  await k.type("use `npm` and [docs](https://example.com) ok");
  await k.press("Enter");
  await k.type("```js "); // like Markdown fences: ``` + optional language + space
  await k.type("const a = 1;");

  const html = await editorHtml(page);
  expect(html).toContain("<h1>Title</h1>");
  expect(html).toContain("<h6>Small</h6>");
  expect(html).toMatch(/<blockquote><p>quoted<\/p><\/blockquote>/);
  expect(html).toMatch(/<hr[ >]/);
  expect(html).toContain("<code>npm</code>");
  expect(html).toMatch(/<a [^>]*href="https:\/\/example.com"[^>]*>docs<\/a> ok/);
  expect(html).toMatch(/<pre><code class="language-js">const a = 1;<\/code><\/pre>/);
});

test("heading picker and Ctrl+Alt+n change the block type", async ({ page }) => {
  await openEditor(page);
  await page.keyboard.type("Heading via picker");
  await page.getByRole("combobox", { name: "Text style" }).selectOption("h2");
  expect(await editorHtml(page)).toContain("<h2>Heading via picker</h2>");
  await page.locator(".editor-content").click();
  await page.keyboard.press("ControlOrMeta+Alt+4");
  expect(await editorHtml(page)).toContain("<h4>Heading via picker</h4>");
});

test("link dialog inserts, edits and rejects unsafe links (Ctrl+K)", async ({ page }) => {
  await openEditor(page);
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Insert link" });
  await dialog.getByLabel("Address").fill("javascript:alert(1)");
  await dialog.getByRole("button", { name: "Insert" }).click();
  await expect(dialog.locator(".error-text")).toBeVisible();
  await dialog.getByLabel("Address").fill("www.example.org");
  await dialog.getByLabel("Text to show").fill("Example");
  await dialog.getByRole("button", { name: "Insert" }).click();
  await expect(dialog).toBeHidden();
  expect(await editorHtml(page)).toMatch(/<a [^>]*href="https:\/\/www.example.org"[^>]*>Example<\/a>/);
});

test("footnotes: numbered, linked both ways, renumbered, removed with their reference", async ({ page }) => {
  await openEditor(page);
  await page.keyboard.type("Second claim");
  await page.getByRole("button", { name: "Footnote" }).click();
  await page.keyboard.type("note two");
  await page.locator(".editor-content p").first().click();
  await page.keyboard.press("Home");
  await page.keyboard.type("First claim");
  await page.keyboard.press("ControlOrMeta+Alt+f");
  await page.keyboard.type("note one");

  const refs = page.locator("sup.footnote-ref a");
  await expect(refs).toHaveText(["1", "2"]);
  await expect(page.locator("section.footnotes .footnote-body")).toHaveText(["note one", "note two"]);

  const html = await editorHtml(page);
  const id = /data-footnote-ref="([^"]+)"/.exec(html)?.[1];
  expect(html).toContain(`href="#fn-${id}"`);
  expect(html).toContain(`href="#fnref-${id}"`);

  // Clicking a reference jumps to its note…
  await refs.first().click();
  await expect(page.locator("section.footnotes li").first()).toBeInViewport();

  // Delete the first reference (cursor right before it, then Delete): the second becomes 1.
  await page.locator(".editor-content > p").first().click();
  await page.keyboard.press("Home");
  for (let i = 0; i < "First claim".length; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Delete");
  await expect(refs).toHaveText(["1"]);
  await expect(page.locator("section.footnotes .footnote-body")).toHaveText(["note two"]);
});

test("media dialog embeds YouTube, images and audio from a URL", async ({ page }) => {
  await openEditor(page);
  const open = () => page.getByRole("button", { name: /Insert media/ }).click();
  const dialog = page.getByRole("dialog", { name: "Insert media" });

  await open();
  await dialog.getByLabel("Media URL").fill("https://youtu.be/dQw4w9WgXcQ");
  await expect(dialog).toContainText("YouTube video");
  await dialog.getByRole("button", { name: "Insert" }).click();
  await expect(page.locator('.editor-content iframe[src^="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"]')).toHaveCount(1);

  await open();
  await dialog.getByLabel("Media URL").fill("https://example.com/photo.png");
  await dialog.getByLabel("Description (alt text)").fill("A photo");
  await dialog.getByRole("button", { name: "Insert" }).click();
  await expect(page.locator('.editor-content img[src="https://example.com/photo.png"][alt="A photo"]')).toHaveCount(1);

  await open();
  await dialog.getByLabel("Media URL").fill("https://example.com/talk");
  await dialog.getByRole("button", { name: "Insert" }).click();
  await expect(dialog.locator(".error-text")).toContainText("Couldn't tell");
  await dialog.getByLabel("Type").selectOption("audio");
  await dialog.getByRole("button", { name: "Insert" }).click();
  await expect(page.locator('.editor-content audio[src="https://example.com/talk"]')).toHaveCount(1);
});

/* ------------------------------------------------------------------ */
/* Folders                                                             */
/* ------------------------------------------------------------------ */

async function cleanFolders(request: import("@playwright/test").APIRequestContext) {
  for (const d of (await (await request.get("/api/documents")).json()) as { id: string }[]) {
    await request.delete(`/api/documents/${d.id}`);
  }
  for (let i = 0; i < 5; i++) {
    const folders = (await (await request.get("/api/folders")).json()) as { id: string }[];
    if (!folders.length) break;
    for (const f of folders) await request.delete(`/api/folders/${f.id}`);
  }
}

test("files panel: folders, new document in a folder, drag and drop, move dialog, delete", async ({ page, request }) => {
  await cleanFolders(request);
  await openEditor(page);
  await page.getByRole("button", { name: "Files" }).click();
  const panel = page.getByRole("dialog", { name: "Files" });

  // Create and rename two folders.
  for (const name of ["Novel", "Archive"]) {
    await panel.getByRole("button", { name: "New folder" }).click();
    const input = panel.getByLabel("Folder name");
    await input.fill(name);
    await input.press("Enter");
    await expect(panel.locator(".tree-label", { hasText: name })).toBeVisible();
  }

  // New document inside "Novel" via the row menu, saved straight into that folder.
  const novelRow = panel.locator(".folder-row", { hasText: "Novel" });
  await novelRow.hover();
  await novelRow.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "New document here" }).click();
  await page.locator(".doc-title-input").fill("Chapter One");
  await page.keyboard.press("Enter");
  await page.keyboard.type("It was a dark night.");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.locator(".statusbar")).toContainText(/Saved \d/);

  const folders = (await (await request.get("/api/folders")).json()) as { id: string; name: string }[];
  const novel = folders.find((f) => f.name === "Novel")!;
  const archive = folders.find((f) => f.name === "Archive")!;
  const docs = (await (await request.get("/api/documents")).json()) as { title: string; folderId: string | null }[];
  expect(docs.find((d) => d.title === "Chapter One")?.folderId).toBe(novel.id);

  // Drag the document into "Archive".
  await page.getByRole("button", { name: "Files" }).click();
  const docRow = panel.locator(".doc-row", { hasText: "Chapter One" });
  await expect(docRow).toBeVisible();
  await docRow.dragTo(panel.locator(".folder-row", { hasText: "Archive" }));
  await expect
    .poll(async () => ((await (await request.get("/api/documents")).json()) as { folderId: string | null }[])[0]?.folderId)
    .toBe(archive.id);

  // Drag "Archive" into "Novel".
  await panel.locator(".folder-row", { hasText: "Archive" }).dragTo(panel.locator(".folder-row", { hasText: "Novel" }));
  await expect
    .poll(async () => ((await (await request.get("/api/folders")).json()) as { id: string; parentId: string | null }[]).find((f) => f.id === archive.id)?.parentId)
    .toBe(novel.id);

  // A folder can't be dropped into its own child: the move is refused client-side.
  await panel.locator(".folder-row", { hasText: "Novel" }).dragTo(panel.locator(".folder-row", { hasText: "Archive" }));
  const afterBadDrop = (await (await request.get("/api/folders")).json()) as { id: string; parentId: string | null }[];
  expect(afterBadDrop.find((f) => f.id === novel.id)?.parentId).toBeNull();

  // "Move to…" (keyboard / touch path): document back to the top level.
  const row = panel.locator(".doc-row", { hasText: "Chapter One" });
  await row.hover();
  await row.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Move to…" }).click();
  const moveDialog = page.getByRole("dialog", { name: /Move “Chapter One”/ });
  await moveDialog.getByLabel("Destination").selectOption({ label: "Top level" });
  await moveDialog.getByRole("button", { name: "Move" }).click();
  await expect
    .poll(async () => ((await (await request.get("/api/documents")).json()) as { folderId: string | null }[])[0]?.folderId)
    .toBeNull();

  // Deleting "Novel" moves "Archive" up to the top level; nothing is lost.
  page.once("dialog", (d) => void d.accept());
  const novelRow2 = panel.locator(".folder-row", { hasText: "Novel" });
  await novelRow2.hover();
  await novelRow2.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Delete folder" }).click();
  await expect(panel.locator(".folder-row", { hasText: "Novel" })).toHaveCount(0);
  const remaining = (await (await request.get("/api/folders")).json()) as { name: string; parentId: string | null }[];
  expect(remaining).toEqual([expect.objectContaining({ name: "Archive", parentId: null })]);

  await cleanFolders(request);
});

/* ------------------------------------------------------------------ */
/* Status bar counts and default color swatch                          */
/* ------------------------------------------------------------------ */

test("status bar shows paragraph, line and word counts; lines follow wrapping", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await openEditor(page);
  await page.keyboard.type("## Heading");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Short one.");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter"); // a blank paragraph doesn't count
  await page.keyboard.type("word ".repeat(40).trim()); // long enough to wrap
  const bar = page.locator(".statusbar");
  await expect(bar).toContainText("3 paragraphs");
  await expect(bar).toContainText("43 words");

  const lines = async () => Number(/(\d+) lines?/.exec(await bar.innerText())?.[1]);
  await expect.poll(lines).toBeGreaterThan(3); // heading + short line + several wrapped lines
  const wide = await lines();
  await page.setViewportSize({ width: 500, height: 800 });
  await expect.poll(lines).toBeGreaterThan(wide);
});

test("swatch 0 sits before color 1, shows the theme's text color and resets the color", async ({ page }) => {
  await openEditor(page);
  const swatches = page.locator('[aria-label="Font colors"] .swatch');
  await expect(swatches.first()).toHaveAttribute("aria-label", "Default text color");
  await expect(swatches.nth(1)).toHaveAttribute("aria-label", /^Color 1/);
  await expect(page.locator(".toolbar svg + svg")).toHaveCount(0); // eraser icon is gone

  const swatchColor = () => swatches.first().evaluate((el) => getComputedStyle(el).backgroundColor);
  const textColor = () => page.locator(".editor-content").evaluate((el) => getComputedStyle(el).color);
  expect(await swatchColor()).toBe(await textColor());

  await page.keyboard.press("ControlOrMeta+2");
  await page.keyboard.type("blue");
  await expect(swatches.first()).toHaveAttribute("aria-pressed", "false");
  await swatches.first().click();
  await page.keyboard.type(" plain");
  await expect(swatches.first()).toHaveAttribute("aria-pressed", "true");
  expect(await editorHtml(page)).toMatch(/blue<\/span> plain/);

  await page.locator('button[aria-label^="Theme"]').click(); // system → light
  await page.locator('button[aria-label^="Theme"]').click(); // light → dark
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await swatchColor()).toBe(await textColor());
});
