import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { ADMIN_STATE } from "./global-setup";

/**
 * "Devices" are separate browser contexts signed in as the same person: each has its own
 * browser storage (drafts, current document), like a laptop and a phone.
 */
const open: BrowserContext[] = [];
async function device(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ storageState: ADMIN_STATE });
  open.push(ctx);
  return ctx.newPage();
}
// Close each test's "devices" so their autosave and refresh timers can't touch later tests.
test.afterEach(async () => {
  await Promise.all(open.splice(0).map((c) => c.close()));
});

/** Starts a fresh document on a device. */
async function newDocument(page: Page) {
  await page.getByRole("button", { name: "New document" }).click();
  await expect(page.locator(".statusbar")).toContainText("New document");
}

async function ready(page: Page) {
  await expect(page.locator(".editor-content")).toHaveAttribute("contenteditable", "true");
}

/** What a real device does when you switch back to it. */
async function comeBack(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}

const saved = (page: Page) => expect(page.locator(".statusbar")).toContainText(/Saved \d/, { timeout: 10_000 });

const doc = (title: string, text: string) => ({
  title,
  contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
  contentHtml: `<p>${text}</p>`,
});

test.describe("cross-device editing", () => {
  test("API: a save based on an outdated revision is refused with the current version", async ({ request }) => {
    const id = crypto.randomUUID();
    const created = await (await request.put(`/api/documents/${id}`, { data: { ...doc("Rev", "one"), baseRevision: null } })).json();
    expect(created.document.revision).toBe(1);
    const second = await (await request.put(`/api/documents/${id}`, { data: { ...doc("Rev", "two"), baseRevision: 1 } })).json();
    expect(second.document.revision).toBe(2);

    const stale = await request.put(`/api/documents/${id}`, { data: { ...doc("Rev", "stale"), baseRevision: 1 } });
    expect(stale.status()).toBe(409);
    const body = await stale.json();
    expect(body.error.code).toBe("conflict");
    expect(body.error.details.document).toMatchObject({ revision: 2, contentHtml: "<p>two</p>" });

    // "I think this is new" for an existing id is a conflict too; omitting baseRevision skips the check.
    expect((await request.put(`/api/documents/${id}`, { data: { ...doc("Rev", "x"), baseRevision: null } })).status()).toBe(409);
    expect((await request.put(`/api/documents/${id}`, { data: doc("Rev", "forced") })).status()).toBe(200);
    await request.delete(`/api/documents/${id}`);
  });

  test("writing on one device shows up on another, without Ctrl+S", async ({ browser }) => {
    const laptop = await device(browser);
    await laptop.goto("/");
    await ready(laptop);
    await newDocument(laptop);
    const title = `Travel notes ${Date.now()}`;
    await laptop.locator(".doc-title-input").fill(title);
    await laptop.keyboard.press("Enter");
    await laptop.keyboard.type("Written on the laptop.");
    await saved(laptop);

    // A device that has never been used opens the most recently edited document.
    const phone = await device(browser);
    await phone.goto("/");
    await ready(phone);
    await expect(phone.locator(".doc-title-input")).toHaveValue(title);
    await expect(phone.locator(".editor-content")).toContainText("Written on the laptop.");

    // Just opening a document must not save it (that would bump the revision and make the
    // laptop's next save look like a conflict).
    const id = await phone.evaluate(() => localStorage.getItem(`typewriter:${localStorage.getItem("typewriter:last-user")}:current`));
    const revisionBefore = (await (await phone.request.get(`/api/documents/${id}`)).json()).revision;
    await phone.waitForTimeout(4_000); // longer than the autosave delay
    expect((await (await phone.request.get(`/api/documents/${id}`)).json()).revision).toBe(revisionBefore);
    await expect(phone.locator(".statusbar")).toContainText(/Saved \d/);

    // An open document picks up later changes when you come back to it.
    await laptop.locator(".editor-content").click();
    await laptop.keyboard.press("ControlOrMeta+End");
    await laptop.keyboard.type(" And more from the laptop.");
    await saved(laptop);
    await comeBack(phone);
    await expect(phone.locator(".editor-content")).toContainText("And more from the laptop.");
    await expect(phone.locator(".toast")).toContainText("Updated with changes from another device");
  });

  test("editing the same document on two devices asks instead of overwriting; Keep both", async ({ browser, request }) => {
    const laptop = await device(browser);
    await laptop.goto("/");
    await ready(laptop);
    await newDocument(laptop);
    const title = `Shared ${Date.now()}`;
    await laptop.locator(".doc-title-input").fill(title);
    await laptop.keyboard.press("Enter");
    await laptop.keyboard.type("Base text.");
    await saved(laptop);

    const phone = await device(browser);
    await phone.goto("/");
    await ready(phone);
    await expect(phone.locator(".editor-content")).toContainText("Base text.");

    // Both change it; the laptop saves first.
    await laptop.locator(".editor-content").click();
    await laptop.keyboard.press("ControlOrMeta+End");
    await laptop.keyboard.type(" Laptop edit.");
    await saved(laptop);
    await phone.locator(".editor-content").click();
    await phone.keyboard.press("ControlOrMeta+End");
    await phone.keyboard.type(" Phone edit.");

    const dialog = phone.getByRole("dialog", { name: "Changed on another device" });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole("button", { name: "Keep both" }).click();

    // The phone now shows the laptop's version; its own edit lives on as a copy.
    await expect(phone.locator(".editor-content")).toContainText("Laptop edit.");
    await expect(phone.locator(".editor-content")).not.toContainText("Phone edit.");
    const docs = (await (await request.get("/api/documents")).json()) as { id: string; title: string }[];
    const copy = docs.find((d) => d.title === `${title} (conflict copy)`);
    expect(copy).toBeTruthy();
    expect((await (await request.get(`/api/documents/${copy!.id}`)).json()).contentHtml).toContain("Phone edit.");
  });

  test("conflict: Overwrite with mine keeps this device's text", async ({ browser, request }) => {
    const laptop = await device(browser);
    await laptop.goto("/");
    await ready(laptop);
    await newDocument(laptop);
    const title = `Overwrite ${Date.now()}`;
    await laptop.locator(".doc-title-input").fill(title);
    await laptop.keyboard.press("Enter");
    await laptop.keyboard.type("Start.");
    await saved(laptop);
    const id = await laptop.evaluate(() => localStorage.getItem(`typewriter:${localStorage.getItem("typewriter:last-user")}:current`));

    const phone = await device(browser);
    await phone.goto("/");
    await ready(phone);
    await laptop.keyboard.type(" Laptop.");
    await saved(laptop);
    await phone.locator(".editor-content").click();
    await phone.keyboard.press("ControlOrMeta+End");
    await phone.keyboard.type(" Phone wins.");
    const dialog = phone.getByRole("dialog", { name: "Changed on another device" });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole("button", { name: "Overwrite with mine" }).click();
    await saved(phone);
    const server = await (await request.get(`/api/documents/${id}`)).json();
    expect(server.contentHtml).toContain("Phone wins.");
    expect(server.contentHtml).not.toContain("Laptop.");
  });
});
