/** Which typewriter sound a keystroke makes. Pure, so it can be unit tested. */
export type KeySound = "key" | "space" | "return" | "backspace";

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
}

/**
 * Maps a keydown to a sound, or null for keys a typewriter doesn't have: modifiers,
 * navigation keys, and shortcuts (Ctrl/Cmd/Alt combinations such as Ctrl+B or Alt+1).
 */
export function soundForKey(e: KeyLike): KeySound | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return null;
  switch (e.key) {
    case " ":
      return "space";
    case "Enter":
      return "return";
    case "Backspace":
    case "Delete":
      return "backspace";
    case "Tab":
    case "Unidentified": // mobile virtual keyboards
      return "key";
  }
  // A single printable character (Array.from counts emoji/astral characters as one).
  return Array.from(e.key).length === 1 ? "key" : null;
}
