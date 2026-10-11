import { describe, expect, it } from "vitest";
import { DRIVE_FILE_SCOPE, hasDriveScope, isInsufficientScopeError } from "../../server/services/googleScopes";

describe("hasDriveScope", () => {
  it("detects whether Drive file access was granted", () => {
    expect(hasDriveScope(`openid https://www.googleapis.com/auth/userinfo.email ${DRIVE_FILE_SCOPE}`)).toBe(true);
    // The person unticked Drive on Google's granular consent screen:
    expect(hasDriveScope("openid https://www.googleapis.com/auth/userinfo.email")).toBe(false);
    expect(hasDriveScope(`${DRIVE_FILE_SCOPE}.readonly openid`)).toBe(false);
  });

  it("doesn't block when Google didn't report scopes", () => {
    expect(hasDriveScope(null)).toBe(true);
    expect(hasDriveScope("")).toBe(true);
  });
});

describe("isInsufficientScopeError", () => {
  it("recognizes Google's insufficient-scope 403 in its different shapes", () => {
    expect(
      isInsufficientScopeError({ code: 403, message: "Request had insufficient authentication scopes.", errors: [{ reason: "insufficientPermissions" }] }),
    ).toBe(true);
    expect(isInsufficientScopeError({ code: "403", response: { data: { error: { details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] } } } })).toBe(true);
    expect(isInsufficientScopeError({ code: 403, message: "Request had insufficient authentication scopes." })).toBe(true);
  });

  it("ignores other errors", () => {
    expect(isInsufficientScopeError({ code: 403, message: "Google Drive API has not been used in project 123", errors: [{ reason: "accessNotConfigured" }] })).toBe(false);
    expect(isInsufficientScopeError({ code: 404, message: "File not found" })).toBe(false);
    expect(isInsufficientScopeError(new Error("network"))).toBe(false);
    expect(isInsufficientScopeError(null)).toBe(false);
  });
});
