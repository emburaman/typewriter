import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

/**
 * A small fake of the Google Drive v3 REST API — just what Olive Writer calls — so end-to-end
 * tests can exercise real two-way sync without a Google account. The app is pointed at it with
 * GOOGLE_API_ROOT_URL (test-only). Test-control endpoints under /__test simulate what a person
 * does in Drive / Google Docs (edit, rename, move, trash, restore).
 */

export const FAKE_DRIVE_PORT = Number(process.env.FAKE_DRIVE_PORT ?? 4555);
export const FAKE_DRIVE_URL = `http://localhost:${FAKE_DRIVE_PORT}`;
const FOLDER = "application/vnd.google-apps.folder";
const DOC = "application/vnd.google-apps.document";

interface Item {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  trashed: boolean;
  version: number;
  /** Document body HTML (what Google Docs would hold). */
  body?: string;
}

const items = new Map<string, Item>();
let seq = 0;

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const publicItem = (i: Item) => ({ id: i.id, name: i.name, mimeType: i.mimeType, parents: i.parents, trashed: i.trashed, version: String(i.version) });
const notFound = (res: ServerResponse) => json(res, 404, { error: { code: 404, message: "File not found", errors: [{ reason: "notFound" }] } });

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** multipart/related upload: [JSON metadata, media]. */
function parseMultipart(contentType: string, raw: string): { meta: Record<string, unknown>; media: string | null } {
  const boundary = /boundary=([^;]+)/.exec(contentType)?.[1]?.replace(/"/g, "");
  if (!boundary) return { meta: raw ? (JSON.parse(raw) as Record<string, unknown>) : {}, media: null };
  const parts = raw
    .split(`--${boundary}`)
    .map((p) => p.replace(/^\r?\n/, ""))
    .filter((p) => p.trim() && !p.startsWith("--"));
  const bodyOf = (p: string) => p.slice(p.indexOf("\r\n\r\n") + 4).replace(/\r\n$/, "");
  const meta = parts[0] ? (JSON.parse(bodyOf(parts[0]) || "{}") as Record<string, unknown>) : {};
  return { meta, media: parts[1] ? bodyOf(parts[1]) : null };
}

/** Google Docs keeps the body of uploaded HTML and renders it back in its own export format. */
const bodyOf = (html: string) => /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
const exportOf = (i: Item) =>
  `<html><head><meta content="text/html; charset=UTF-8" http-equiv="content-type"><style>.c1{color:#000000}</style></head><body class="doc-content">${i.body ?? ""}</body></html>`;

/** The handful of query shapes the app sends. */
function matches(i: Item, q: string): boolean {
  if (!q) return true;
  const unq = (s: string) => s.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  const cond = (c: string): boolean => {
    let m: RegExpExecArray | null;
    if ((m = /^mimeType = '(.+)'$/.exec(c))) return i.mimeType === m[1];
    if ((m = /^name = '(.+)'$/.exec(c))) return i.name === unq(m[1] ?? "");
    if ((m = /^'(.+)' in parents$/.exec(c))) return i.parents.includes(unq(m[1] ?? ""));
    if ((m = /^trashed = (true|false)$/.exec(c))) return i.trashed === (m[1] === "true");
    throw new Error(`fake drive: unsupported query condition: ${c}`);
  };
  return q.split(/\s+or\s+/).some((part) => part.split(/\s+and\s+/).every((c) => cond(c.trim())));
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", FAKE_DRIVE_URL);
  const path = url.pathname;
  const method = req.method ?? "GET";
  const raw = method === "GET" ? "" : await readBody(req);
  let m: RegExpExecArray | null;

  /* ------------------------- test controls ------------------------- */
  if (path === "/__test/reset") {
    items.clear();
    return json(res, 200, {});
  }
  if (path === "/__test/state") return json(res, 200, [...items.values()]);
  if (path === "/__test/change" && method === "POST") {
    const c = JSON.parse(raw) as { id: string; body?: string; name?: string; parent?: string; trashed?: boolean };
    const i = items.get(c.id);
    if (!i) return notFound(res);
    if (c.body !== undefined) i.body = c.body;
    if (c.name !== undefined) i.name = c.name;
    if (c.parent !== undefined) i.parents = [c.parent];
    if (c.trashed !== undefined) i.trashed = c.trashed;
    // Trashing a folder in Drive trashes everything in it.
    if (c.trashed !== undefined && i.mimeType === FOLDER) {
      for (const child of items.values()) if (child.parents.includes(i.id)) child.trashed = c.trashed;
    }
    i.version += 1;
    return json(res, 200, i);
  }

  /* --------------------------- Drive API --------------------------- */
  if (path === "/drive/v3/files" && method === "GET") {
    const q = url.searchParams.get("q") ?? "";
    return json(res, 200, { files: [...items.values()].filter((i) => matches(i, q)).map(publicItem) });
  }
  if ((path === "/drive/v3/files" || path === "/upload/drive/v3/files") && method === "POST") {
    const { meta, media } = parseMultipart(req.headers["content-type"] ?? "", raw);
    const id = `file${++seq}`;
    const item: Item = {
      id,
      name: String(meta.name ?? "Untitled"),
      mimeType: String(meta.mimeType ?? DOC),
      parents: Array.isArray(meta.parents) && meta.parents.length ? (meta.parents as string[]) : ["root"],
      trashed: false,
      version: 1,
      body: media !== null ? bodyOf(media) : undefined,
    };
    items.set(id, item);
    return json(res, 200, publicItem(item));
  }
  if ((m = /^\/drive\/v3\/files\/([^/]+)\/export$/.exec(path))) {
    const i = items.get(decodeURIComponent(m[1] ?? ""));
    if (!i) return notFound(res);
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(exportOf(i));
  }
  if ((m = /^\/(?:upload\/)?drive\/v3\/files\/([^/]+)$/.exec(path))) {
    const i = items.get(decodeURIComponent(m[1] ?? ""));
    if (!i) return notFound(res);
    if (method === "GET") return json(res, 200, publicItem(i));
    if (method === "PATCH") {
      const { meta, media } = parseMultipart(req.headers["content-type"] ?? "", raw);
      if (typeof meta.name === "string") i.name = meta.name;
      if (typeof meta.trashed === "boolean") i.trashed = meta.trashed;
      const add = url.searchParams.get("addParents");
      const remove = url.searchParams.get("removeParents")?.split(",") ?? [];
      if (add) i.parents = [...i.parents.filter((p) => !remove.includes(p)), add];
      if (media !== null) i.body = bodyOf(media);
      i.version += 1;
      return json(res, 200, publicItem(i));
    }
  }
  json(res, 400, { error: { code: 400, message: `fake drive: unsupported ${method} ${path}` } });
}

export function startFakeDrive(): Promise<Server> {
  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => json(res, 500, { error: { code: 500, message: String(err) } }));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(FAKE_DRIVE_PORT, () => resolve(server));
  });
}

/* ---------------------- helpers for the specs ---------------------- */

export async function driveState(): Promise<Item[]> {
  return (await (await fetch(`${FAKE_DRIVE_URL}/__test/state`)).json()) as Item[];
}

/** Simulates a change made by a person in Google Drive / Google Docs. */
export async function changeInDrive(change: { id: string; body?: string; name?: string; parent?: string; trashed?: boolean }) {
  const res = await fetch(`${FAKE_DRIVE_URL}/__test/change`, { method: "POST", body: JSON.stringify(change) });
  if (!res.ok) throw new Error(`fake drive change failed: ${res.status}`);
}
