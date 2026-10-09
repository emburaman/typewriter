import type { ApiErrorBody } from "@/lib/shared/schemas";

/** Error thrown for any non-2xx API response or network failure. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** True when the server could not be reached at all (offline, container down). */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

type Method = "GET" | "POST" | "PUT" | "DELETE";

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as ApiErrorBody).error?.message === "string"
  );
}

/**
 * The single fetch wrapper used by the whole UI. Components never call fetch directly —
 * they use the typed functions exported from `@/lib/api`.
 */
export async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch (err) {
    throw new ApiError(0, "network_error", err instanceof Error ? err.message : "Network request failed");
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let payload: unknown = undefined;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ApiError(res.status, "invalid_response", `Server returned a non-JSON response (${res.status})`);
    }
  }

  if (!res.ok) {
    if (isApiErrorBody(payload)) {
      throw new ApiError(res.status, payload.error.code, payload.error.message, payload.error.details);
    }
    throw new ApiError(res.status, "http_error", `Request failed with status ${res.status}`);
  }
  return payload as T;
}
