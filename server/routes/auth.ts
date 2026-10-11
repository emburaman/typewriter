import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { HttpError } from "../errors.js";
import * as usersRepo from "../repositories/usersRepository.js";
import { devLogin, endSession, googleLoginUrl, startSession } from "../services/auth.js";
import type { AuthConfig } from "../../lib/shared/schemas.js";

/** Sign-in endpoints (public). */
export const authRouter = Router();

/** GET /api/auth/config — what the sign-in page needs to know. */
authRouter.get("/config", async (_req, res) => {
  const body: AuthConfig = {
    googleConfigured: config.auth.oauthConfigured,
    needsSetup: (await usersRepo.countUsers()) === 0,
    devLogin: config.auth.devLogin,
  };
  res.status(200).json(body);
});

/** GET /api/auth/me — the signed-in user, or 401. */
authRouter.get("/me", (req, res) => {
  if (!req.user) throw new HttpError(401, "unauthenticated", "Please sign in.");
  res.status(200).json(req.user);
});

/** GET /api/auth/login — starts "Sign in with Google" (browser navigation, not fetch). */
authRouter.get("/login", (_req, res) => {
  if (!config.auth.oauthConfigured) return res.redirect(303, "/login?error=not_configured");
  res.redirect(303, googleLoginUrl());
});

/** POST /api/auth/logout */
authRouter.post("/logout", async (req, res) => {
  await endSession(req, res);
  res.status(204).end();
});

const LOGIN_ERRORS: Record<string, string> = {
  not_invited: "This email hasn't been invited. Ask the admin to add it in Settings → Users.",
  admin_only: "The first account must be the admin (ADMIN_EMAIL).",
  email_unverified: "This email address isn't verified.",
};

/** POST /api/auth/dev-login — test-only sign-in without Google (AUTH_DEV_LOGIN; never in production). */
authRouter.post("/dev-login", async (req, res) => {
  if (!config.auth.devLogin) throw new HttpError(404, "not_found", "Not found");
  const { email } = z.object({ email: z.string().trim().toLowerCase().pipe(z.email()) }).parse(req.body);
  const result = await devLogin(email);
  if (typeof result === "string") throw new HttpError(403, result, LOGIN_ERRORS[result] ?? "Sign-in refused");
  await startSession(req, res, result);
  res.status(200).json(result);
});
