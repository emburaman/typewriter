// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { createExtensions } from "../../lib/editor/extensions";
import { normalizeGoogleDocsHtml } from "../../lib/editor/googleImport";

let editor: Editor | null = null;
afterEach(() => editor?.destroy());

/** What the editor ends up with after loading a Google Docs export. */
function load(googleHtml: string): string {
  editor = new Editor({ extensions: createExtensions({ getColors: () => [] }), content: normalizeGoogleDocsHtml(googleHtml) });
  return editor.getHTML();
}

// Shaped like a real Google Docs HTML export.
const GOOGLE = `<html><head><meta content="text/html; charset=UTF-8"><style>.c1{color:#000000}</style></head>
<body class="c5 doc-content">
<h2 class="c3"><span class="c2">Chapter</span></h2>
<p class="c1"><span style="color:#000000;font-weight:400;font-family:Arial">Plain </span><span style="color:#000000;font-weight:700">bold</span><span style="color:#000000;font-style:italic"> it</span><span style="color:#d64541;font-weight:400"> red</span><sup><a href="#ftnt1" id="ftnt_ref1">[1]</a></sup></p>
<p class="c1"><span style="color:#1155cc;text-decoration:underline"><a href="https://www.google.com/url?q=https://example.com/page&amp;sa=D&amp;ust=1">a link</a></span></p>
<p class="c1"><span><a href="https://www.google.com/url?q=https://youtu.be/dQw4w9WgXcQ&amp;sa=D">▶ Video: https://youtu.be/dQw4w9WgXcQ</a></span></p>
<hr><div><p class="c1"><a href="#ftnt_ref1" id="ftnt1">[1]</a><span style="color:#000000"> The note.</span></p></div>
</body></html>`;

describe("normalizeGoogleDocsHtml", () => {
  it("keeps the structure and real formatting", () => {
    const html = load(GOOGLE);
    expect(html).toContain("<h2>Chapter</h2>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em> it</em>");
    expect(html).toMatch(/<span style="color: (rgb\(214, 69, 65\)|#d64541);?"> red<\/span>/);
  });

  it("drops Google's default black so text stays readable in dark mode", () => {
    expect(load(GOOGLE)).not.toMatch(/color: (rgb\(0, 0, 0\)|#000000)/);
  });

  it("unwraps Google's redirect links and drops their styling", () => {
    const html = load(GOOGLE);
    expect(html).toMatch(/<a [^>]*href="https:\/\/example.com\/page"[^>]*>a link<\/a>/);
    expect(html).not.toContain("google.com/url");
    expect(html).not.toMatch(/<u>a link/);
  });

  it("turns Google's footnotes back into the app's footnotes", () => {
    const html = load(GOOGLE);
    expect(html).toMatch(/<sup class="footnote-ref" id="fnref-g1" data-footnote-ref="g1"><a href="#fn-g1"[^>]*>1<\/a><\/sup>/);
    expect(html).toContain('<section class="footnotes"');
    expect(html).toMatch(/<li id="fn-g1" data-footnote="g1"><div class="footnote-body"><p>The note.<\/p><\/div>/);
    expect(html).not.toContain("<hr>");
  });

  it("turns exported player links back into players", () => {
    expect(load(GOOGLE)).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"');
  });

  it("keeps highlights but not Google's white or transparent backgrounds", () => {
    const html = load(
      '<p><span style="background-color:#fff176;color:#000000">marked</span><span style="background-color:#ffffff"> white</span><span style="background-color:transparent"> none</span></p>',
    );
    expect(html).toMatch(/<span style="background-color: (rgb\(255, 241, 118\)|#fff176);?">marked<\/span>/);
    expect(html).toContain("> white none</p>");
  });

  it("leaves ordinary HTML alone", () => {
    expect(load("<p>Hello <strong>world</strong></p>")).toBe("<p>Hello <strong>world</strong></p>");
  });
});
