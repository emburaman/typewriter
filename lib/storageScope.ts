/**
 * Per-user namespacing for browser storage. Several people can use the same browser, so
 * drafts, the settings mirror and UI state are stored under `typewriter:<userId>:…`.
 * The signed-in user's id is set by AuthProvider before anything reads storage.
 */
let scope = "signed-out";

/** Remembered so the pre-paint theme script can find the last user's settings. */
export const LAST_USER_KEY = "typewriter:last-user";

export function setStorageScope(userId: string): void {
  scope = userId;
  try {
    window.localStorage.setItem(LAST_USER_KEY, userId);
  } catch (err) {
    console.warn("[storage] could not remember the signed-in user:", err);
  }
}

export function scopedKey(name: string): string {
  return `typewriter:${scope}:${name}`;
}

/**
 * Browser data saved before accounts existed (`typewriter:draft:…`, `typewriter:current`, …)
 * moves to the first user who signs in on this browser — normally the person who wrote it —
 * so unsaved drafts aren't orphaned by the upgrade.
 */
export function adoptLegacyStorage(): void {
  try {
    const s = window.localStorage;
    const legacy = /^typewriter:(draft:.+|current|settings|expanded-folders)$/;
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && legacy.test(k)) keys.push(k);
    }
    for (const k of keys) {
      const name = k.slice("typewriter:".length);
      const target = scopedKey(name);
      const value = s.getItem(k);
      if (value !== null && s.getItem(target) === null) s.setItem(target, value);
      s.removeItem(k);
    }
  } catch (err) {
    console.warn("[storage] could not migrate drafts from before accounts:", err);
  }
}
