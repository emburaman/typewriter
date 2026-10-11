import { createHash, randomBytes } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { config } from "../config.js";
import { HttpError } from "../errors.js";
import * as sessionsRepo from "../repositories/sessionsRepository.js";
import * as usersRepo from "../repositories/usersRepository.js";
import { createOAuthClient, issueState } from "./oauth.js";
import type { AuthUser } from "../../lib/shared/schemas.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express's own augmentation pattern
  namespace Express {
    interface Request {
      /** Set by `sessionMiddleware` when the request carries a valid session cookie. */
      user?: AuthUser;
      sessionTokenHash?: string;
    }
  }
}

export const SESSION_COOKIE = "ow_session";
const SESSION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    const raw = part.slice(i + 1).trim();
    try {
      out[name] = decodeURIComponent(raw);
    } catch {
      out[name] = raw; // malformed %-escape: keep the raw value
    }
  }
  return out;
}

const cookieOptions = (maxAgeMs: number) => ({
  httpOnly: true,
  secure: config.secureCookies,
  sameSite: "lax" as const,
  path: "/",
  maxAge: maxAgeMs,
});

/** Starts a session: random token in an httpOnly cookie, only its hash in the database. */
export async function startSession(req: Request, res: Response, user: AuthUser): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * DAY_MS);
  await sessionsRepo.deleteExpiredSessions();
  await sessionsRepo.createSession(hashToken(token), user.id, expires, req.get("user-agent") ?? null);
  res.cookie(SESSION_COOKIE, token, cookieOptions(SESSION_DAYS * DAY_MS));
}

export async function endSession(req: Request, res: Response): Promise<void> {
  if (req.sessionTokenHash) await sessionsRepo.deleteSession(req.sessionTokenHash);
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(0), maxAge: undefined });
}

/** Identifies the user from the session cookie (if any) and slides the expiry forward daily. */
export const sessionMiddleware: RequestHandler = async (req, res, next) => {
  try {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) {
      const hash = hashToken(token);
      const session = await sessionsRepo.findSessionUser(hash);
      if (session) {
        req.user = session.user;
        req.sessionTokenHash = hash;
        if (Date.now() - session.lastSeenAt.getTime() > DAY_MS) {
          const expires = new Date(Date.now() + SESSION_DAYS * DAY_MS);
          await sessionsRepo.renewSession(hash, expires);
          res.cookie(SESSION_COOKIE, token, cookieOptions(SESSION_DAYS * DAY_MS));
        }
      }
    }
    next();
  } catch (err) {
    next(err);
  }
};

export const requireAuth: RequestHandler = (req, _res, next) => {
  next(req.user ? undefined : new HttpError(401, "unauthenticated", "Please sign in."));
};

export const requireAdmin: RequestHandler = (req, _res, next) => {
  next(req.user?.role === "admin" ? undefined : new HttpError(403, "forbidden", "Only an admin can do that."));
};

/** The signed-in user; only call behind `requireAuth`. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw new HttpError(401, "unauthenticated", "Please sign in.");
  return req.user;
}

/**
 * CSRF defence in depth (on top of SameSite=Lax cookies): requests that change data must not
 * come from another site. Browsers send `Origin` on such requests; non-browser clients may omit it.
 */
export function sameOriginForWrites(req: Request, _res: Response, next: NextFunction): void {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("origin");
  if (!origin) return next();
  const allowed = new Set([new URL(config.appUrl).origin, `${req.protocol}://${req.get("host") ?? ""}`]);
  next(allowed.has(origin) ? undefined : new HttpError(403, "cross_site_request", "Cross-site request refused."));
}

/* --------------------------- Google sign-in --------------------------- */

export function googleLoginUrl(): string {
  return createOAuthClient().generateAuthUrl({
    scope: ["openid", "email", "profile"],
    prompt: "select_account",
    state: issueState({ kind: "login" }),
  });
}

export type LoginError = "not_invited" | "admin_only" | "email_unverified";

/** Turns an OAuth code into an account: an existing/invited user, or the very first admin. */
export async function completeGoogleLogin(code: string): Promise<AuthUser | LoginError> {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.id_token) throw new HttpError(502, "google_error", "Google didn't return an identity token.");
  const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.google.clientId });
  const p = ticket.getPayload();
  if (!p?.sub || !p.email) throw new HttpError(502, "google_error", "Google didn't return an email address.");
  if (!p.email_verified) return "email_unverified";

  const profile = { sub: p.sub, email: p.email, name: p.name ?? null, picture: p.picture ?? null };
  const existing = await usersRepo.signInWithGoogle(profile);
  if (existing) return existing;

  if ((await usersRepo.countUsers()) === 0) {
    if (config.auth.adminEmail && config.auth.adminEmail !== profile.email.toLowerCase()) return "admin_only";
    // Lost a race with another first sign-in? Then this person needs an invite like anyone else.
    return (await usersRepo.bootstrapAdmin(profile)) ?? (await usersRepo.signInWithGoogle(profile)) ?? "not_invited";
  }
  return "not_invited";
}

/**
 * Test-only sign-in without Google (AUTH_DEV_LOGIN, never in production). Follows the same
 * rules as Google sign-in: invited emails only, and the first account becomes admin.
 */
export async function devLogin(email: string): Promise<AuthUser | LoginError> {
  const profile = { sub: `dev:${email.toLowerCase()}`, email, name: email.split("@")[0] ?? null, picture: null };
  const existing = await usersRepo.signInWithGoogle(profile);
  if (existing) return existing;
  if ((await usersRepo.countUsers()) === 0) {
    if (config.auth.adminEmail && config.auth.adminEmail !== email.toLowerCase()) return "admin_only";
    return (await usersRepo.bootstrapAdmin(profile)) ?? "not_invited";
  }
  return "not_invited";
}
