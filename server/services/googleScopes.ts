/**
 * Google's consent screen lets people untick individual permissions, so a successful
 * sign-in does not guarantee Drive access. These helpers detect that case.
 */

export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/** Whether a granted-scope string (space separated) includes Drive file access. Unknown → assume yes. */
export function hasDriveScope(scope: string | null | undefined): boolean {
  if (!scope) return true; // Older rows / responses without a scope list: let the API decide.
  return scope.split(/\s+/).includes(DRIVE_FILE_SCOPE);
}

interface GoogleApiErrorShape {
  code?: unknown;
  message?: unknown;
  errors?: { reason?: unknown }[];
  response?: { data?: { error?: { status?: unknown; details?: { reason?: unknown }[] } } };
}

/** True for Google's 403 "Request had insufficient authentication scopes". */
export function isInsufficientScopeError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as GoogleApiErrorShape;
  if (Number(e.code) !== 403) return false;
  const reasons = [
    ...(e.errors ?? []).map((x) => x.reason),
    ...(e.response?.data?.error?.details ?? []).map((x) => x.reason),
    e.response?.data?.error?.status,
  ];
  return (
    reasons.some((r) => r === "insufficientPermissions" || r === "ACCESS_TOKEN_SCOPE_INSUFFICIENT") ||
    (typeof e.message === "string" && /insufficient authentication scopes/i.test(e.message))
  );
}

/**
 * True when Google refuses the stored refresh token ("invalid_grant": expired or revoked). That
 * happens when the user removes the app's access in their Google account, after 7 days while the
 * OAuth consent screen is in "Testing", or when Google resets tokens (e.g. a password change).
 * Only reconnecting fixes it.
 */
export function isRevokedGrantError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { message?: unknown; response?: { data?: { error?: unknown } } };
  return e.message === "invalid_grant" || e.response?.data?.error === "invalid_grant";
}

export const DRIVE_RECONNECT_MESSAGE =
  "Google Drive access has expired or was revoked. In Settings → Storage, click Reconnect Google Drive.";

export const MISSING_DRIVE_ACCESS_MESSAGE =
  "Google Drive access wasn't granted. In Settings → Storage, disconnect Google Drive and connect again, " +
  "and on Google's screen tick the box that lets the app see and edit the Drive files it creates.";
