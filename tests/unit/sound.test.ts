import { describe, expect, it } from "vitest";
import { soundForKey } from "../../lib/sound/keySounds";
import { parseSoundCookie, serializeSoundCookie, SOUND_COOKIE } from "../../lib/sound/preference";

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; isComposing: boolean }> = {}) =>
  soundForKey({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });

describe("soundForKey", () => {
  it("strikes for printable characters", () => {
    for (const k of ["a", "Z", "7", ".", "é", "ß", "😀"]) expect(key(k)).toBe("key");
  });

  it("has dedicated sounds for space, enter and backspace/delete", () => {
    expect(key(" ")).toBe("space");
    expect(key("Enter")).toBe("return");
    expect(key("Backspace")).toBe("backspace");
    expect(key("Delete")).toBe("backspace");
    expect(key("Tab")).toBe("key");
  });

  it("is silent for modifiers, navigation and shortcuts", () => {
    for (const k of ["Shift", "Control", "Alt", "Meta", "CapsLock", "ArrowLeft", "Home", "Escape", "F5", "Dead"]) {
      expect(key(k)).toBeNull();
    }
    expect(key("b", { ctrlKey: true })).toBeNull();
    expect(key("s", { metaKey: true })).toBeNull();
    expect(key("1", { altKey: true })).toBeNull();
    expect(key("a", { isComposing: true })).toBeNull();
  });
});

describe("sound cookie", () => {
  it("defaults to on", () => {
    expect(parseSoundCookie("")).toBe(true);
    expect(parseSoundCookie("other=1; foo=bar")).toBe(true);
  });

  it("reads an explicit off/on", () => {
    expect(parseSoundCookie(`a=1; ${SOUND_COOKIE}=off; b=2`)).toBe(false);
    expect(parseSoundCookie(`${SOUND_COOKIE}=on`)).toBe(true);
  });

  it("serializes a long-lived, site-wide cookie", () => {
    const c = serializeSoundCookie(false, true);
    expect(c).toMatch(new RegExp(`^${SOUND_COOKIE}=off;`));
    expect(c).toContain("Max-Age=31536000");
    expect(c).toContain("Path=/");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Secure");
    expect(serializeSoundCookie(true, false)).not.toContain("Secure");
  });
});
