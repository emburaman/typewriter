import { expect, request as playwrightRequest, test, type APIRequestContext } from "@playwright/test";
import { ADMIN_EMAIL } from "./global-setup";

/** A separate signed-in API session for another person. */
async function signIn(baseURL: string, email: string): Promise<APIRequestContext> {
  const ctx = await playwrightRequest.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const res = await ctx.post("/api/auth/dev-login", { data: { email } });
  expect(res.status(), await res.text()).toBe(200);
  return ctx;
}

/** Unique per run, so the suite also passes on a database reused from an earlier run. */
const run = Date.now().toString(36);
const email = (name: string) => `${name}-${run}@example.com`;

const doc = (title: string) => ({
  title,
  contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: title }] }] },
  contentHtml: `<p>${title}</p>`,
});

test.describe("accounts", () => {
  test("signed-out visitors are sent to the sign-in page and the API refuses them", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("link", { name: "Sign in with Google" })).toBeVisible();
    const anon = await playwrightRequest.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    for (const path of ["/api/documents", "/api/folders", "/api/settings", "/api/google/status", "/api/users"]) {
      expect((await anon.get(path)).status(), path).toBe(401);
    }
    await ctx.close();
  });

  test("invite-only: strangers can't sign in, invited people can", async ({ request, baseURL }) => {
    const stranger = await playwrightRequest.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    const refused = await stranger.post("/api/auth/dev-login", { data: { email: "stranger@example.com" } });
    expect(refused.status()).toBe(403);
    expect((await refused.json()).error.code).toBe("not_invited");

    const bobEmail = email("bob");
    const invited = await request.post("/api/users", { data: { email: bobEmail.toUpperCase() } });
    expect(invited.status()).toBe(201);
    expect(await invited.json()).toMatchObject({ email: bobEmail, status: "invited", role: "user" });
    expect((await request.post("/api/users", { data: { email: bobEmail } })).status()).toBe(409);

    const bob = await signIn(baseURL!, bobEmail);
    expect(await (await bob.get("/api/auth/me")).json()).toMatchObject({ email: bobEmail, role: "user" });
    // Members can't manage users.
    expect((await bob.get("/api/users")).status()).toBe(403);
    expect((await bob.post("/api/users", { data: { email: "eve@example.com" } })).status()).toBe(403);
  });

  test("each user's documents, folders and settings are separate", async ({ request, baseURL }) => {
    await request.post("/api/users", { data: { email: email("carol") } });
    const carol = await signIn(baseURL!, email("carol"));

    const adminDocId = crypto.randomUUID();
    expect((await request.put(`/api/documents/${adminDocId}`, { data: doc("Admin secret") })).ok()).toBe(true);
    const adminFolder = await (await request.post("/api/folders", { data: { name: "Admin folder" } })).json();

    // Carol sees none of it…
    expect(((await (await carol.get("/api/documents")).json()) as { id: string }[]).map((d) => d.id)).not.toContain(adminDocId);
    expect(((await (await carol.get("/api/folders")).json()) as { name: string }[]).map((f) => f.name)).not.toContain("Admin folder");
    expect((await carol.get(`/api/documents/${adminDocId}`)).status()).toBe(404);

    // …and knowing the id gives no access: no overwrite, move, delete or use of the folder.
    expect((await carol.put(`/api/documents/${adminDocId}`, { data: doc("Hijacked") })).status()).toBe(404);
    expect((await carol.patch(`/api/documents/${adminDocId}`, { data: { folderId: null } })).status()).toBe(404);
    expect((await carol.delete(`/api/documents/${adminDocId}`)).status()).toBe(404);
    expect((await carol.patch(`/api/folders/${adminFolder.id}`, { data: { name: "x" } })).status()).toBe(404);
    expect((await carol.delete(`/api/folders/${adminFolder.id}`)).status()).toBe(404);
    expect((await carol.post("/api/folders", { data: { name: "Sneaky", parentId: adminFolder.id } })).status()).toBe(400);
    expect(
      (await carol.put(`/api/documents/${crypto.randomUUID()}`, { data: { ...doc("x"), folderId: adminFolder.id } })).status(),
    ).toBe(400);

    const stillMine = await (await request.get(`/api/documents/${adminDocId}`)).json();
    expect(stillMine.title).toBe("Admin secret");

    // Settings are per user.
    await carol.put("/api/settings", { data: { theme: "dark", fontSize: 24 } });
    const adminSettings = await (await request.get("/api/settings")).json();
    expect(adminSettings.fontSize).not.toBe(24);

    await request.delete(`/api/documents/${adminDocId}`);
    await request.delete(`/api/folders/${adminFolder.id}`);
  });

  test("removing a user deletes their data and ends their session", async ({ request, baseURL }) => {
    await request.post("/api/users", { data: { email: email("dave") } });
    const dave = await signIn(baseURL!, email("dave"));
    await dave.put(`/api/documents/${crypto.randomUUID()}`, { data: doc("Dave's") });
    const daveFolder = await (await dave.post("/api/folders", { data: { name: "D" } })).json();
    await dave.post("/api/folders", { data: { name: "D child", parentId: daveFolder.id } });

    const users = (await (await request.get("/api/users")).json()) as { id: string; email: string }[];
    const daveId = users.find((u) => u.email === email("dave"))!.id;
    expect((await request.delete(`/api/users/${daveId}`)).status()).toBe(204);
    expect((await dave.get("/api/documents")).status()).toBe(401);

    // The admin can't remove themselves.
    const meId = users.find((u) => u.email === ADMIN_EMAIL)!.id;
    expect((await request.delete(`/api/users/${meId}`)).status()).toBe(400);
  });

  test("sign out ends the session", async ({ baseURL }) => {
    const admin = await signIn(baseURL!, ADMIN_EMAIL);
    expect((await admin.get("/api/auth/me")).status()).toBe(200);
    expect((await admin.post("/api/auth/logout")).status()).toBe(204);
    expect((await admin.get("/api/auth/me")).status()).toBe(401);
  });

  test("cross-site writes are refused", async ({ request }) => {
    const res = await request.post("/api/folders", { data: { name: "csrf" }, headers: { Origin: "https://evil.example.com" } });
    expect(res.status()).toBe(403);
  });

  test("settings shows the account and, for admins, the users list", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
    await expect(page.getByText(ADMIN_EMAIL).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  });
});
