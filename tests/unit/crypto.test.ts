import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "../../server/services/crypto";

describe("token encryption", () => {
  const key = randomBytes(32);

  it("round-trips a value", () => {
    const secret = "ya29.a0Af-refresh-token";
    expect(decrypt(encrypt(secret, key), key)).toBe(secret);
  });

  it("uses a fresh IV every time", () => {
    expect(encrypt("same", key)).not.toBe(encrypt("same", key));
  });

  it("rejects tampered ciphertext", () => {
    const raw = Buffer.from(encrypt("secret", key), "base64");
    raw[raw.length - 1]! ^= 0xff;
    expect(() => decrypt(raw.toString("base64"), key)).toThrow();
  });

  it("rejects the wrong key", () => {
    expect(() => decrypt(encrypt("secret", key), randomBytes(32))).toThrow();
  });

  it("rejects truncated payloads", () => {
    expect(() => decrypt("AAAA", key)).toThrow(/truncated/);
  });
});
