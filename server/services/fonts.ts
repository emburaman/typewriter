import { config } from "../config.js";
import { CURATED_FONTS } from "../../lib/shared/schemas.js";

export interface FontCatalog {
  source: "google" | "curated";
  families: string[];
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let cache: { catalog: FontCatalog; expires: number } | null = null;

interface WebfontsResponse {
  items?: { family?: string }[];
}

/**
 * Returns the Google Fonts catalog when GOOGLE_FONTS_API_KEY is configured (cached for a
 * day), otherwise a curated list. A failing upstream call degrades to the curated list.
 */
export async function getFontCatalog(): Promise<FontCatalog> {
  const curated: FontCatalog = { source: "curated", families: [...CURATED_FONTS] };
  if (!config.googleFontsApiKey) return curated;
  if (cache && cache.expires > Date.now()) return cache.catalog;

  try {
    const url = new URL("https://www.googleapis.com/webfonts/v1/webfonts");
    url.searchParams.set("key", config.googleFontsApiKey);
    url.searchParams.set("sort", "popularity");
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`Google Fonts API responded ${res.status}`);
    const body = (await res.json()) as WebfontsResponse;
    const families = (body.items ?? [])
      .map((i) => i.family)
      .filter((f): f is string => typeof f === "string" && /^[A-Za-z0-9 ]+$/.test(f));
    const catalog: FontCatalog = { source: "google", families };
    cache = { catalog, expires: Date.now() + CACHE_TTL_MS };
    return catalog;
  } catch (err) {
    console.warn("[fonts] falling back to curated fonts:", err instanceof Error ? err.message : err);
    return curated;
  }
}
