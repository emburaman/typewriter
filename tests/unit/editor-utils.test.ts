import { describe, expect, it } from "vitest";
import { countWords } from "../../lib/editor/extensions";
import { newUuid } from "../../lib/uuid";

describe("countWords", () => {
  it("counts whitespace-separated words", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
    expect(countWords("one")).toBe(1);
    expect(countWords(" hello\tworld\n\nagain ")).toBe(3);
  });
});

describe("newUuid", () => {
  it("produces RFC 4122 v4 UUIDs", () => {
    const re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    for (let i = 0; i < 50; i++) expect(newUuid()).toMatch(re);
  });

  it("works without crypto.randomUUID (insecure contexts)", () => {
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      expect(newUuid()).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      Object.defineProperty(crypto, "randomUUID", { value: original, configurable: true });
    }
  });
});
