import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { apiErrorHandler, HttpError, loggableError, notFound } from "../../server/errors";

function run(err: unknown) {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  const req = { method: "GET", originalUrl: "/api/test" } as Request;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  apiErrorHandler(err, req, res as unknown as Response, () => undefined);
  return { status: res.status.mock.calls[0]?.[0] as number, body: res.json.mock.calls[0]?.[0] as { error: { code: string } } };
}

describe("apiErrorHandler", () => {
  it("maps HttpError to its status", () => {
    expect(run(notFound())).toMatchObject({ status: 404, body: { error: { code: "not_found" } } });
    expect(run(new HttpError(409, "conflict", "x")).status).toBe(409);
  });

  it("maps zod errors to 400 validation_error", () => {
    const result = z.object({ a: z.string() }).safeParse({});
    expect(run(result.error)).toMatchObject({ status: 400, body: { error: { code: "validation_error" } } });
  });

  it("hides unexpected errors behind a generic 500", () => {
    const { status, body } = run(new Error("db password is hunter2"));
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("hunter2");
  });
});

describe("loggableError", () => {
  it("never logs a Google client error's request (it contains the refresh token)", () => {
    const err = Object.assign(new Error("invalid_grant"), {
      code: 400,
      config: { data: { refresh_token: "1//secret-refresh-token" } },
      response: { status: 400, data: { error: "invalid_grant" } },
    });
    const logged = loggableError(err);
    expect(logged).toBe("invalid_grant (HTTP 400)");
    expect(JSON.stringify(logged)).not.toContain("secret-refresh-token");
  });

  it("keeps other errors as they are (with their stack)", () => {
    const err = new Error("boom");
    expect(loggableError(err)).toBe(err);
  });
});
