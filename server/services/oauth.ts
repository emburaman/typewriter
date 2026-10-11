import { randomBytes } from "node:crypto";
import { google, type Auth } from "googleapis";
import { config } from "../config.js";
import { HttpError } from "../errors.js";

/**
 * Shared Google OAuth plumbing. Signing in and connecting Drive are two different OAuth
 * round-trips, but they share one client and one registered redirect URI
 * (/api/google/callback); the `state` value records which flow it was and for whom.
 */

export type OAuthPurpose = { kind: "login" } | { kind: "drive"; userId: string };

const STATE_TTL_MS = 10 * 60 * 1000;
/** Pending `state` values (CSRF protection). Single process, so memory is enough. */
const pending = new Map<string, { purpose: OAuthPurpose; expires: number }>();

export function createOAuthClient(): Auth.OAuth2Client {
  if (!config.auth.oauthConfigured) {
    throw new HttpError(
      503,
      "google_not_configured",
      "Google sign-in is not configured on the server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    );
  }
  return new google.auth.OAuth2(config.google.clientId, config.google.clientSecret, config.google.redirectUri);
}

export function issueState(purpose: OAuthPurpose): string {
  const now = Date.now();
  for (const [s, v] of pending) if (v.expires < now) pending.delete(s);
  const state = randomBytes(24).toString("base64url");
  pending.set(state, { purpose, expires: now + STATE_TTL_MS });
  return state;
}

/** One-time: a state can be used once, within 10 minutes. */
export function consumeState(state: string): OAuthPurpose {
  const entry = pending.get(state);
  pending.delete(state);
  if (!entry || entry.expires < Date.now()) {
    throw new HttpError(400, "invalid_oauth_state", "The Google sign-in link expired or is invalid. Please try again.");
  }
  return entry.purpose;
}
