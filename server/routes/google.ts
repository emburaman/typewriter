import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../errors.js";
import { completeGoogleLogin, currentUser, startSession } from "../services/auth.js";
import * as drive from "../services/googleDrive.js";
import * as driveSync from "../services/driveSync.js";
import { consumeState } from "../services/oauth.js";

/** The signed-in user's Google Drive connection (mounted behind requireAuth). */
export const googleRouter = Router();

/** GET /api/google/status */
googleRouter.get("/status", async (req, res) => {
  res.status(200).json(await drive.getStatus(currentUser(req).id));
});

/** GET /api/google/auth-url — the Drive consent URL the browser should navigate to. */
googleRouter.get("/auth-url", (req, res) => {
  res.status(200).json({ url: drive.createAuthUrl(currentUser(req).id) });
});

/**
 * POST /api/google/sync — mirror every folder and upload every document to Drive now.
 * Works whatever the storage setting is, as long as Drive is connected with Drive access.
 */
googleRouter.post("/sync", async (req, res) => {
  const user = currentUser(req);
  if (!(await drive.isConnectedWithDriveAccess(user.id))) {
    throw new HttpError(409, "google_not_connected", "Connect Google Drive (with Drive access) in Settings first.");
  }
  res.status(200).json(await driveSync.syncEverything(user.id));
});

/**
 * POST /api/google/pull — bring in changes made in Google Drive now (the server also does this
 * every minute). Skipped when one ran in the last 5 s (1 s with `{"force": true}`) or Drive
 * sync is off.
 */
googleRouter.post("/pull", async (req, res) => {
  // `force` (the "Sync with Drive" button) only waits out a short burst guard.
  const force = req.body && typeof req.body === "object" && (req.body as { force?: unknown }).force === true;
  const result = await driveSync.pullIfDue(currentUser(req).id, force ? 1_000 : 5_000);
  res.status(200).json(result ?? { skipped: true });
});

/** DELETE /api/google/connection — disconnect Drive. */
googleRouter.delete("/connection", async (req, res) => {
  await drive.disconnect(currentUser(req).id);
  res.status(204).end();
});

/* ---------------------------------------------------------------------- */

const callbackQuery = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().optional(),
});

/**
 * GET /api/google/callback — the one OAuth redirect target (public). The `state` says whether
 * this round-trip was a sign-in (→ start a session, go to the editor) or a Drive connection for
 * the signed-in user (→ back to Settings). Errors redirect with a reason instead of a JSON body.
 */
export const googleCallbackRouter = Router();

googleCallbackRouter.get("/callback", async (req, res) => {
  const q = callbackQuery.parse(req.query);
  const go = (path: string, params: Record<string, string>) => res.redirect(303, `${path}?${new URLSearchParams(params).toString()}`);

  let purpose;
  try {
    purpose = consumeState(q.state ?? "");
  } catch (err) {
    return go("/login", { error: "expired", message: err instanceof Error ? err.message : "Invalid sign-in link" });
  }

  if (purpose.kind === "login") {
    if (q.error || !q.code) return go("/login", { error: q.error === "access_denied" ? "denied" : "google" });
    try {
      const result = await completeGoogleLogin(q.code);
      if (typeof result === "string") return go("/login", { error: result });
      await startSession(req, res, result);
      return res.redirect(303, "/");
    } catch (err) {
      console.error("[auth] Google sign-in failed:", err);
      return go("/login", { error: "google", message: err instanceof HttpError ? err.message : "Google sign-in failed" });
    }
  }

  // Drive connection: must finish in the same account that started it.
  if (req.user?.id !== purpose.userId) {
    return go("/settings", { google: "error", message: "Sign in again, then reconnect Google Drive." });
  }
  if (q.error) return go("/settings", { google: "denied", message: q.error });
  if (!q.code) return go("/settings", { google: "error", message: "Missing code from Google" });
  try {
    await drive.completeDriveConnection(purpose.userId, q.code);
    return go("/settings", { google: "connected" });
  } catch (err) {
    console.error("[google] Drive connection failed:", err);
    return go("/settings", { google: "error", message: err instanceof HttpError ? err.message : "Could not connect Google Drive" });
  }
});
