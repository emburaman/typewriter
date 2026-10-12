import { parseVideoUrl } from "./media";

/**
 * Turns HTML exported from Google Docs back into HTML the editor understands, undoing what
 * Google's conversion does to the app's documents:
 *  - links wrapped in https://www.google.com/url?q=… redirects are unwrapped;
 *  - default black text color (which would be unreadable in dark mode), fonts and sizes are
 *    dropped; real colors are kept, and links lose Google's blue/underline styling;
 *  - Google's footnotes ([1] links + a list at the end) become the app's footnotes;
 *  - "▶ Video: <link>" / "▶ Audio: <link>" lines (how the app exports players) become players again.
 * Runs in the browser (DOMParser). Anything Google-only (fonts, tables…) degrades gracefully.
 */
export function normalizeGoogleDocsHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.body;
  body.querySelectorAll("style, script, meta, title, link").forEach((n) => n.remove());

  // 1. Unwrap Google's redirect links.
  body.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
    const real = googleRedirectTarget(a.getAttribute("href") ?? "");
    if (real) a.setAttribute("href", real);
  });

  // 2. Styles: keep only meaningful text colors; links keep no styling of their own.
  body.querySelectorAll<HTMLElement>("[style]").forEach((el) => {
    // Google styles links on the span inside OR around the <a>; either way it's link styling.
    const isLinkStyling = Boolean(el.closest("a") || el.querySelector("a"));
    const color = el.style.color;
    const keep = color && !isDefaultTextColor(color) && !isLinkStyling ? `color: ${color}` : "";
    const weight = el.style.fontWeight;
    const italic = el.style.fontStyle === "italic";
    const underline = /underline/.test(el.style.textDecoration) && !isLinkStyling;
    const styles = [
      keep,
      weight && /^(bold|[6-9]00)$/.test(weight) ? "font-weight: 700" : "",
      italic ? "font-style: italic" : "",
      underline ? "text-decoration: underline" : "",
    ].filter(Boolean);
    if (styles.length) el.setAttribute("style", styles.join("; "));
    else el.removeAttribute("style");
  });
  body.querySelectorAll("[class]").forEach((el) => el.removeAttribute("class"));

  // 3. Footnotes: notes first (they contain links back to the references), then references.
  const notes: { id: string; html: string }[] = [];
  body.querySelectorAll<HTMLAnchorElement>('a[id^="ftnt"]:not([id^="ftnt_ref"])').forEach((a) => {
    const n = a.id.slice("ftnt".length);
    const container = a.closest("div") ?? a.parentElement;
    a.remove();
    if (!container) return;
    const inner = container.innerHTML.replace(/^(\s|&nbsp;)+/, "").trim();
    notes.push({ id: `g${n}`, html: /^<p[\s>]/.test(inner) ? inner : `<p>${inner}</p>` });
    container.remove();
  });
  if (notes.length) {
    // Google puts a horizontal line above its footnotes.
    const last = body.lastElementChild;
    if (last?.tagName === "HR") last.remove();
  }
  body.querySelectorAll<HTMLAnchorElement>('a[id^="ftnt_ref"]').forEach((a) => {
    const n = a.id.slice("ftnt_ref".length);
    const ref = doc.createElement("sup");
    ref.setAttribute("data-footnote-ref", `g${n}`);
    ref.textContent = n;
    (a.closest("sup") ?? a).replaceWith(ref);
  });
  if (notes.length) {
    const section = doc.createElement("section");
    section.setAttribute("data-footnotes", "");
    const ol = doc.createElement("ol");
    for (const note of notes) {
      const li = doc.createElement("li");
      li.setAttribute("data-footnote", note.id);
      const bodyDiv = doc.createElement("div");
      bodyDiv.className = "footnote-body";
      bodyDiv.innerHTML = note.html;
      li.appendChild(bodyDiv);
      ol.appendChild(li);
    }
    section.appendChild(ol);
    body.appendChild(section);
  }

  // 4. Players exported as "▶ Video: <link>" lines.
  body.querySelectorAll("p").forEach((p) => {
    const m = /^\s*▶\s*(Video|Audio):\s*(\S+)\s*$/.exec(p.textContent ?? "");
    const url = p.querySelector("a")?.getAttribute("href") ?? m?.[2];
    if (!m || !url) return;
    const kind = m[1] === "Audio" ? "audio" : parseVideoUrl(url)?.provider ?? "video";
    const div = doc.createElement("div");
    div.setAttribute("data-embed", kind);
    div.setAttribute("data-url", url);
    p.replaceWith(div);
  });

  return body.innerHTML;
}

function googleRedirectTarget(href: string): string | null {
  try {
    const u = new URL(href);
    if (/(^|\.)google\.com$/.test(u.hostname) && u.pathname === "/url") return u.searchParams.get("q");
  } catch {
    return null; // relative or malformed: leave as is
  }
  return null;
}

/** Black / near-black: Google's default text color, not a choice the writer made. */
function isDefaultTextColor(color: string): boolean {
  const c = color.replace(/\s+/g, "").toLowerCase();
  return c === "#000000" || c === "#000" || c === "black" || c === "rgb(0,0,0)" || c === "windowtext";
}
