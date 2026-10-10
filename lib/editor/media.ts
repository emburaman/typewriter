/**
 * URL helpers for links and media. Pure functions (unit tested). Anything that ends up in a
 * `src`/`href` goes through here, and embeds are always rebuilt from validated pieces —
 * never from a URL or iframe `src` found in stored or pasted HTML.
 */

export type MediaKind = "image" | "audio" | "video";

export interface VideoRef {
  provider: "youtube" | "vimeo";
  videoId: string;
  /** Start offset in seconds (YouTube `t=`/`start=`). */
  start: number | null;
  /** Vimeo privacy hash for unlisted videos. */
  hash: string | null;
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{1,12}$/;
const VIMEO_HASH = /^[0-9a-f]{6,20}$/i;

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false; // not a URL at all
  }
}

/** Accepts http(s), mailto and in-document anchors; adds https:// to bare "www." hosts. */
export function normalizeHref(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (/^#[A-Za-z0-9_-]+$/.test(v)) return v;
  if (/^mailto:[^\s]+@[^\s]+$/i.test(v)) return v;
  const candidate = /^www\./i.test(v) ? `https://${v}` : v;
  return isHttpUrl(candidate) ? candidate : null;
}

/** "1h2m3s", "90s", "90" → seconds. */
function parseTime(t: string | null): number | null {
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  if (!m || !m[0]) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

export function parseVideoUrl(value: string): VideoRef | null {
  let u: URL;
  try {
    u = new URL(value.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.replace(/^(www|m)\./, "");
  const parts = u.pathname.split("/").filter(Boolean);

  if (["youtube.com", "youtube-nocookie.com", "music.youtube.com", "youtu.be"].includes(host)) {
    let id: string | undefined;
    if (host === "youtu.be") id = parts[0];
    else if (parts[0] === "watch") id = u.searchParams.get("v") ?? undefined;
    else if (["embed", "shorts", "live", "v"].includes(parts[0] ?? "")) id = parts[1];
    if (!id || !YOUTUBE_ID.test(id)) return null;
    return { provider: "youtube", videoId: id, start: parseTime(u.searchParams.get("t") ?? u.searchParams.get("start")), hash: null };
  }

  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const idx = host === "player.vimeo.com" ? parts.indexOf("video") + 1 : 0;
    const id = parts[idx];
    if (!id || !VIMEO_ID.test(id)) return null;
    const hash = u.searchParams.get("h") ?? (host === "vimeo.com" ? parts[idx + 1] : undefined) ?? null;
    return { provider: "vimeo", videoId: id, start: null, hash: hash && VIMEO_HASH.test(hash) ? hash : null };
  }
  return null;
}

/** Re-validates stored attributes, so a tampered document can't point the iframe elsewhere. */
export function isValidVideoRef(v: Partial<VideoRef>): v is VideoRef {
  if (v.provider === "youtube") return typeof v.videoId === "string" && YOUTUBE_ID.test(v.videoId);
  if (v.provider === "vimeo") {
    return typeof v.videoId === "string" && VIMEO_ID.test(v.videoId) && (v.hash == null || VIMEO_HASH.test(v.hash));
  }
  return false;
}

/** Privacy-friendly player URLs (no tracking cookies until play / Do Not Track). */
export function videoEmbedSrc(v: VideoRef): string {
  if (v.provider === "youtube") {
    const start = v.start && v.start > 0 ? `?start=${Math.floor(v.start)}` : "";
    return `https://www.youtube-nocookie.com/embed/${v.videoId}${start}`;
  }
  const params = new URLSearchParams({ dnt: "1" });
  if (v.hash) params.set("h", v.hash);
  return `https://player.vimeo.com/video/${v.videoId}?${params.toString()}`;
}

/** Canonical public page for the video (used for links and the Drive export). */
export function videoWatchUrl(v: VideoRef): string {
  if (v.provider === "youtube") {
    return `https://www.youtube.com/watch?v=${v.videoId}${v.start ? `&t=${Math.floor(v.start)}s` : ""}`;
  }
  return `https://vimeo.com/${v.videoId}${v.hash ? `/${v.hash}` : ""}`;
}

const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i;
const VIDEO_EXT = /\.(mp4|m4v|webm|ogv|mov)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i;

/** Guesses the media kind from the URL's file extension (null when it can't tell). */
export function guessMediaKind(value: string): MediaKind | null {
  if (!isHttpUrl(value)) return null;
  const path = new URL(value).pathname;
  if (AUDIO_EXT.test(path)) return "audio";
  if (VIDEO_EXT.test(path)) return "video";
  if (IMAGE_EXT.test(path)) return "image";
  return null;
}
