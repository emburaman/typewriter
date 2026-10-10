/**
 * The sound on/off choice lives in a cookie (per browser, not per server), so it survives
 * reloads and is available before any API call. Default: on.
 */
export const SOUND_COOKIE = "ow_sound";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Parses a `document.cookie` string. Anything other than an explicit "off" means on. */
export function parseSoundCookie(cookieHeader: string): boolean {
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SOUND_COOKIE) return rest.join("=") !== "off";
  }
  return true;
}

export function serializeSoundCookie(enabled: boolean, secure: boolean): string {
  return `${SOUND_COOKIE}=${enabled ? "on" : "off"}; Max-Age=${ONE_YEAR_SECONDS}; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function readSoundPreference(): boolean {
  return typeof document === "undefined" ? true : parseSoundCookie(document.cookie);
}

export function writeSoundPreference(enabled: boolean): void {
  document.cookie = serializeSoundCookie(enabled, window.location.protocol === "https:");
}
