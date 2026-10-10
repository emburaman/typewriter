import type { Node as PMNode } from "@tiptap/pm/model";

/**
 * Document statistics for the status bar. Footnotes are notes, not body text, so they are
 * excluded from paragraph and line counts; blank paragraphs count as neither.
 */

/** Non-empty text blocks (paragraphs, headings, list items, quotes, code blocks). */
export function countParagraphs(doc: PMNode): number {
  let count = 0;
  doc.descendants((node) => {
    if (node.type.name === "footnotes") return false;
    if (node.isTextblock) {
      if (node.textContent.trim().length > 0) count += 1;
      return false;
    }
    return true;
  });
  return count;
}

const TEXTBLOCKS = "p, h1, h2, h3, h4, h5, h6, pre";

/**
 * Lines of text as currently laid out on screen (like Word's line count), so it follows
 * the window width, font and font size. Measured with Range.getClientRects(): every line
 * box of a block yields rects with the same top, give or take inline offsets such as
 * superscripts or inline code, which are folded together using half the line height.
 */
export function countVisualLines(root: HTMLElement): number {
  let total = 0;
  const range = document.createRange();
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(TEXTBLOCKS))) {
    if (el.closest("section.footnotes") || !el.textContent?.trim()) continue;
    range.selectNodeContents(el);
    const tops = Array.from(range.getClientRects())
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => r.top)
      .sort((a, b) => a - b);
    if (tops.length === 0) continue;

    const style = getComputedStyle(el);
    const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2 || 16;
    let lines = 1;
    let lineTop = tops[0]!;
    for (const top of tops) {
      if (top - lineTop > lineHeight / 2) {
        lines += 1;
        lineTop = top;
      }
    }
    total += lines;
  }
  return total;
}
