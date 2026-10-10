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
    const id = localStorage.getItem("typewriter:current");
    return JSON.parse(localStorage.getItem(`typewriter:draft:${id}`) ?? "null") as { unsynced: boolean } | null;
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

  const id = await page.evaluate(() => localStorage.getItem("typewriter:current"));
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
