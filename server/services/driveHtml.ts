/** HTML helpers for documents uploaded to Google Drive. */

export const escapeHtml = (v: string) =>
  v.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c] ?? c);

/**
 * Google Docs drops <iframe>, <video> and <audio> when converting HTML. The editor wraps every
 * embed in `<div data-embed="…" data-url="…">`, so swap each one for a visible link instead.
 */
export function replaceEmbedsWithLinks(html: string): string {
  return html.replace(/<div\b[^>]*\bdata-embed="(video|audio|youtube|vimeo)"[^>]*>[\s\S]*?<\/div>/g, (block, kind: string) => {
    const url = /\bdata-url="([^"]*)"/.exec(block)?.[1];
    if (!url || !/^https?:\/\//i.test(url)) return "";
    const label = kind === "audio" ? "Audio" : "Video";
    return `<p><a href="${url}">▶ ${label}: ${url}</a></p>`;
  });
}
