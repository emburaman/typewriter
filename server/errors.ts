import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import type { ApiErrorBody } from "../lib/shared/schemas.js";

/** An error that maps directly onto an HTTP response. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, "bad_request", message, details);
export const notFound = (message = "Resource not found") => new HttpError(404, "not_found", message);

export const apiNotFoundHandler: RequestHandler = (req, _res, next) => {
  next(notFound(`No API route for ${req.method} ${req.originalUrl}`));
};

/** Final error handler for /api — always responds with an `ApiErrorBody`. */
export const apiErrorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  let status = 500;
  let body: ApiErrorBody = { error: { code: "internal_error", message: "Something went wrong" } };

  if (err instanceof HttpError) {
    status = err.status;
    body = { error: { code: err.code, message: err.message, details: err.details } };
  } else if (err instanceof ZodError) {
    status = 400;
    body = {
      error: {
        code: "validation_error",
        message: "Request validation failed",
        details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    };
  } else if (err instanceof SyntaxError && "body" in err) {
    // Malformed JSON from express.json()
    status = 400;
    body = { error: { code: "invalid_json", message: "Request body is not valid JSON" } };
  } else if (isPayloadTooLarge(err)) {
    status = 413;
    body = { error: { code: "payload_too_large", message: "Request body is too large" } };
  }

  if (status >= 500) {
    console.error(`[api] ${req.method} ${req.originalUrl} failed:`, loggableError(err));
  }
  res.status(status).json(body);
};

function isPayloadTooLarge(err: unknown): boolean {
  return typeof err === "object" && err !== null && "type" in err && err.type === "entity.too.large";
}

/**
 * What to log for an error. Google client errors carry the whole request, including the user's
 * refresh token in its body, so only their message and status are logged. Other errors keep
 * their stack.
 */
export function loggableError(err: unknown): unknown {
  if (typeof err !== "object" || err === null || !("config" in err || "response" in err)) return err;
  const e = err as { message?: unknown; code?: unknown; status?: unknown };
  const status = e.status ?? e.code;
  return `${String(e.message)}${status === undefined ? "" : ` (HTTP ${String(status)})`}`;
}
