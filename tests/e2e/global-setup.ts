import { request, type FullConfig } from "@playwright/test";
import { startFakeDrive } from "./fake-drive";

/**
 * Signs in once as the admin through the test-only endpoint (the server must run with
 * AUTH_DEV_LOGIN=true and NODE_ENV≠production) and saves the session for every test.
 * On a fresh database this first sign-in creates the admin account.
 */
export const ADMIN_EMAIL = "admin@example.com";
export const ADMIN_STATE = "tests/e2e/.auth/admin.json";

export default async function globalSetup(config: FullConfig) {
  // A fake Google Drive for the two-way sync tests (the app must run with GOOGLE_API_ROOT_URL).
  const fakeDrive = await startFakeDrive().catch((err: unknown) => {
    console.warn(`[e2e] fake Drive not started: ${String(err)}`);
    return null;
  });
  const baseURL = config.projects[0]?.use.baseURL ?? "http://localhost:4000";
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post("/api/auth/dev-login", { data: { email: ADMIN_EMAIL } });
  if (!res.ok()) {
    throw new Error(
      `Test sign-in failed (${res.status()}): ${await res.text()}\n` +
        "Start the app with AUTH_DEV_LOGIN=true and NODE_ENV=test on a fresh database.",
    );
  }
  await ctx.storageState({ path: ADMIN_STATE });
  await ctx.dispose();
  return async () => {
    await new Promise((resolve) => (fakeDrive ? fakeDrive.close(resolve) : resolve(undefined)));
  };
}
