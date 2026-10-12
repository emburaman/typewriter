import { expect, request as playwrightRequest, test, type APIRequestContext, type Browser } from "@playwright/test";
import { changeInDrive, driveState } from "./fake-drive";

/**
 * Two-way Google Drive sync against the fake Drive (tests/e2e/fake-drive.ts). Runs as its own
 * user so Drive sync doesn't affect the other suites. Needs the app started with
 * GOOGLE_API_ROOT_URL pointing at the fake (see README → Testing); otherwise these tests skip.
 */
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const EMAIL = `drive-writer-${run}@example.com`;
let me: APIRequestContext;

const doc = (title: string, text: string, extra: Record<string, unknown> = {}) => ({
  title,
  contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
  contentHtml: `<p>${text}</p>`,
  ...extra,
});

/** Ask the app to pull from Drive right now. */
async function pull() {
  await new Promise((r) => setTimeout(r, 1_100)); // past the burst guard
  const res = await me.post("/api/google/pull", { data: { force: true } });
  expect(res.status(), await res.text()).toBe(200);
  return res.json();
}

async function fileOf(docId: string) {
  const d = await (await me.get(`/api/documents/${docId}`)).json();
  const f = (await driveState()).find((i) => i.id === d.driveFileId);
  if (!f) throw new Error(`no Drive file for ${docId}`);
  return f;
}

async function userPage(browser: Browser) {
  const ctx = await browser.newContext({ storageState: await me.storageState() });
  return { ctx, page: await ctx.newPage() };
}

test.beforeAll(async ({ request, baseURL }) => {
  await request.post("/api/users", { data: { email: EMAIL } });
  me = await playwrightRequest.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  expect((await me.post("/api/auth/dev-login", { data: { email: EMAIL } })).status()).toBe(200);
  const connected = await me.post("/api/auth/dev-drive-connection", { data: { email: EMAIL } });
  test.skip(connected.status() === 404, "app not started with the fake Drive (GOOGLE_API_ROOT_URL)");
  expect((await me.put("/api/settings", { data: { storageProvider: "google_drive", driveFolderName: `Olive ${run}` } })).ok()).toBe(true);
});

test.describe("two-way Google Drive sync", () => {
  test("app → Drive: documents land in their folder as Google Docs", async () => {
    const folder = await (await me.post("/api/folders", { data: { name: "Novel" } })).json();
    const id = crypto.randomUUID();
    const saved = await (await me.put(`/api/documents/${id}`, { data: doc("Chapter 1", "It began.", { folderId: folder.id }) })).json();
    expect(saved.drive.status).toBe("synced");

    const state = await driveState();
    const root = state.find((i) => i.name === `Olive ${run}`)!;
    const novel = state.find((i) => i.name === "Novel" && i.parents[0] === root.id)!;
    const file = await fileOf(id);
    expect(file).toMatchObject({ name: "Chapter 1", parents: [novel.id], trashed: false });
    expect(file.body).toContain("It began.");
  });

  test("Drive → app: an edit made in Google Docs comes back into the app", async ({ browser }) => {
    const id = crypto.randomUUID();
    await me.put(`/api/documents/${id}`, { data: doc("Edited elsewhere", "Original text.") });
    const file = await fileOf(id);

    await changeInDrive({ id: file.id, body: '<p class="c1"><span style="color:#000000">Rewritten in Google Docs.</span></p>' });
    expect((await pull()).pulled).toBe(1);

    const pulled = await (await me.get(`/api/documents/${id}`)).json();
    expect(pulled).toMatchObject({ contentSource: "html" });
    expect(pulled.contentHtml).toContain("Rewritten in Google Docs.");

    // Opening it shows the edit, stores it as editor content, and does NOT bounce it back to Drive.
    const versionBefore = (await fileOf(id)).version;
    const { ctx, page } = await userPage(browser);
    await page.goto("/");
    await page.getByRole("button", { name: "Files" }).click();
    await page.locator(".doc-row", { hasText: "Edited elsewhere" }).getByRole("button").first().click();
    await expect(page.locator(".editor-content")).toContainText("Rewritten in Google Docs.");
    await expect.poll(async () => (await (await me.get(`/api/documents/${id}`)).json()).contentSource).toBe("json");
    expect(await page.locator(".editor-content").innerHTML()).not.toMatch(/color: (rgb\(0, 0, 0\)|#000000)/);
    expect((await fileOf(id)).version).toBe(versionBefore);
    await ctx.close();

    // …and a pull right after finds nothing new (no echo of our own conversion).
    expect((await pull()).pulled).toBe(0);
  });

  test("an open document updates when you come back to it after editing in Google Docs", async ({ browser }) => {
    const { ctx, page } = await userPage(browser);
    await page.goto("/");
    await page.getByRole("button", { name: "New document" }).click();
    await page.locator(".doc-title-input").fill("Open while edited");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Typed in the app.");
    await expect(page.locator(".statusbar")).toContainText(/Saved \d/, { timeout: 10_000 });
    await page.keyboard.press("ControlOrMeta+s"); // upload to Drive now
    await expect(page.locator(".toast")).toContainText("Google Drive");

    const id = await page.evaluate(() => localStorage.getItem(`typewriter:${localStorage.getItem("typewriter:last-user")}:current`));
    await changeInDrive({ id: (await fileOf(id!)).id, body: "<p>Typed in the app. Plus a line from Google Docs.</p>" });
    await new Promise((r) => setTimeout(r, 5_500)); // past the focus pull guard (one pull per 5 s)
    await page.evaluate(() => window.dispatchEvent(new Event("focus"))); // switch back to the tab
    await expect(page.locator(".editor-content")).toContainText("Plus a line from Google Docs.", { timeout: 10_000 });
    await ctx.close();
  });

  test("renames and moves made in Drive are applied in the app", async () => {
    const a = await (await me.post("/api/folders", { data: { name: "Drafts" } })).json();
    const b = await (await me.post("/api/folders", { data: { name: "Final" } })).json();
    const id = crypto.randomUUID();
    await me.put(`/api/documents/${id}`, { data: doc("Old name", "x", { folderId: a.id }) });
    const state = await driveState();
    const finalFolder = state.find((i) => i.name === "Final")!;
    const draftsFolder = state.find((i) => i.name === "Drafts")!;

    await changeInDrive({ id: (await fileOf(id)).id, name: "New name", parent: finalFolder.id });
    await changeInDrive({ id: draftsFolder.id, name: "Drafts (old)" });
    await pull();

    expect(await (await me.get(`/api/documents/${id}`)).json()).toMatchObject({ title: "New name", folderId: b.id });
    const folders = (await (await me.get("/api/folders")).json()) as { id: string; name: string }[];
    expect(folders.find((f) => f.id === a.id)?.name).toBe("Drafts (old)");
  });

  test("deleted in Drive → app Trash; restored in Drive → back in the app", async () => {
    const id = crypto.randomUUID();
    await me.put(`/api/documents/${id}`, { data: doc("Trash me in Drive", "x") });
    const file = await fileOf(id);

    await changeInDrive({ id: file.id, trashed: true });
    expect((await pull()).trashed).toBe(1);
    expect((await me.get(`/api/documents/${id}`)).status()).toBe(404);
    const trash = (await (await me.get("/api/documents/trash")).json()) as { id: string }[];
    expect(trash.map((t) => t.id)).toContain(id);

    await changeInDrive({ id: file.id, trashed: false });
    expect((await pull()).restored).toBe(1);
    expect((await me.get(`/api/documents/${id}`)).status()).toBe(200);
  });

  test("deleted in the app → Drive trash; restored in the app → back in Drive", async () => {
    const id = crypto.randomUUID();
    await me.put(`/api/documents/${id}`, { data: doc("Trash me in the app", "x") });
    const fileId = (await fileOf(id)).id;

    expect((await me.delete(`/api/documents/${id}`)).status()).toBe(204);
    expect((await driveState()).find((i) => i.id === fileId)?.trashed).toBe(true);
    // A pull right after must not resurrect it.
    await pull();
    expect((await me.get(`/api/documents/${id}`)).status()).toBe(404);

    expect((await me.post(`/api/documents/trash/${id}/restore`)).status()).toBe(200);
    expect((await driveState()).find((i) => i.id === fileId)?.trashed).toBe(false);
  });

  test("edited on both sides → the app keeps its version and imports Drive's as a copy", async () => {
    const id = crypto.randomUUID();
    const first = await (await me.put(`/api/documents/${id}`, { data: doc("Both sides", "Base.", { baseRevision: null }) })).json();
    // App edit that hasn't reached Drive yet (background autosave within the 2-minute window).
    await me.put(`/api/documents/${id}`, {
      data: doc("Both sides", "App edit.", { baseRevision: first.document.revision, driveSync: "skip" }),
    });
    await changeInDrive({ id: (await fileOf(id)).id, body: "<p>Drive edit.</p>" });
    expect((await pull()).conflicts).toBe(1);

    expect((await (await me.get(`/api/documents/${id}`)).json()).contentHtml).toContain("App edit.");
    const docs = (await (await me.get("/api/documents")).json()) as { id: string; title: string }[];
    const copy = docs.find((d) => d.title === "Both sides (Google Docs version)");
    expect(copy).toBeTruthy();
    expect((await (await me.get(`/api/documents/${copy!.id}`)).json()).contentHtml).toContain("Drive edit.");
  });

  test("a folder trashed in Drive: its documents go to the app Trash and the folder is removed", async () => {
    const folder = await (await me.post("/api/folders", { data: { name: "Doomed" } })).json();
    const id = crypto.randomUUID();
    await me.put(`/api/documents/${id}`, { data: doc("Inside doomed", "x", { folderId: folder.id }) });
    const driveFolder = (await driveState()).find((i) => i.name === "Doomed")!;

    await changeInDrive({ id: driveFolder.id, trashed: true });
    await pull();
    const folders = (await (await me.get("/api/folders")).json()) as { id: string }[];
    expect(folders.map((f) => f.id)).not.toContain(folder.id);
    const trash = (await (await me.get("/api/documents/trash")).json()) as { id: string }[];
    expect(trash.map((t) => t.id)).toContain(id);
  });
});
