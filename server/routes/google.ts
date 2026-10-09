import { Router } from "express";
import { z } from "zod";
import * as drive from "../services/googleDrive.js";
import { HttpError } from "../errors.js";

export const googleRouter = Router();

/** GET /api/google/status */
googleRouter.get("/status", async (_req, res) => {
  res.status(200).json(await drive.getStatus());
});

/** GET /api/google/auth-url — the consent URL the browser should navigate to. */
googleRouter.get("/auth-url", (_req, res) => {
  res.status(200).json({ url: drive.createAuthUrl() });
});

const callbackQuery = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().optional(),
});

/**
 * GET /api/google/callback — OAuth redirect target. Always redirects back to the
 * settings page with a `google=` flag so the UI can show the outcome.
 */
googleRouter.get("/callback", async (req, res) => {
  const q = callbackQuery.parse(req.query);
  const back = (status: string, message?: string) => {
    const params = new URLSearchParams({ google: status });
    if (message) params.set("message", message);
    res.redirect(303, `/settings?${params.toString()}`);
  };

  if (q.error) return back("denied", q.error);
  if (!q.code || !q.state) return back("error", "Missing code or state from Google");
  try {
    await drive.handleCallback(q.code, q.state);
    back("connected");
  } catch (err) {
    console.error("[google] OAuth callback failed:", err);
    back("error", err instanceof HttpError ? err.message : "Could not complete Google sign-in");
  }
});

/** DELETE /api/google/connection — disconnect Drive. */
googleRouter.delete("/connection", async (_req, res) => {
  await drive.disconnect();
  res.status(204).end();
});
