// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { createExtensions } from "../../lib/editor/extensions";
import { insertFootnote } from "../../lib/editor/footnotes";
import { applyHighlight, applyPaletteColor, clearColor, clearHighlight } from "../../lib/editor/typewriterKeymap";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function make(content = "<p></p>") {
  editor = new Editor({ extensions: createExtensions({ getColors: () => ["#d64541"], getHighlights: () => ["#fff176"] }), content });
  return editor;
}

const labels = (e: Editor) => Array.from(e.view.dom.querySelectorAll("sup.footnote-ref a")).map((a) => a.textContent);
const notes = (e: Editor) => Array.from(e.view.dom.querySelectorAll("section.footnotes li")).map((li) => li.querySelector(".footnote-body")?.textContent);

describe("footnotes", () => {
  it("inserts a numbered reference and moves the cursor into a new note", () => {
    const e = make("<p>Hello world</p>");
    e.commands.setTextSelection(6); // after "Hello"
    expect(insertFootnote(e)).toBe(true);
    e.commands.insertContent("First note");
    expect(labels(e)).toEqual(["1"]);
    expect(notes(e)).toEqual(["First note"]);
    expect(e.state.doc.lastChild?.type.name).toBe("footnotes");
  });

  it("renumbers by reading order and reorders notes", () => {
    const e = make("<p>aaa bbb</p>");
    e.commands.setTextSelection(8); // end
    insertFootnote(e);
    e.commands.insertContent("note B");
    e.commands.setTextSelection(4); // after "aaa"
    insertFootnote(e);
    e.commands.insertContent("note A");
    expect(labels(e)).toEqual(["1", "2"]);
    expect(notes(e)).toEqual(["note A", "note B"]);
  });

  it("removes the note when its reference is deleted, and the section when empty", () => {
    const e = make("<p>x</p>");
    e.commands.setTextSelection(2);
    insertFootnote(e);
    e.commands.insertContent("gone soon");
    // select and delete the reference (it sits right after "x")
    e.commands.setNodeSelection(2);
    e.commands.deleteSelection();
    expect(labels(e)).toEqual([]);
    expect(e.view.dom.querySelector("section.footnotes")).toBeNull();
  });

  it("round-trips through HTML with working anchors", () => {
    const e = make("<p>x</p>");
    e.commands.setTextSelection(2);
    insertFootnote(e);
    e.commands.insertContent("note");
    const html = e.getHTML();
    const id = /data-footnote-ref="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`href="#fn-${id}"`);
    expect(html).toContain(`id="fn-${id}"`);
    expect(html).toContain(`href="#fnref-${id}"`);
    const again = make(html);
    expect(labels(again)).toEqual(["1"]);
    expect(notes(again)).toEqual(["note"]);
  });
});

describe("media and embeds", () => {
  it("embeds YouTube via the privacy-friendly player", () => {
    const e = make();
    expect(e.commands.setVideoEmbed("https://youtu.be/dQw4w9WgXcQ?t=42")).toBe(true);
    const html = e.getHTML();
    expect(html).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=42"');
    expect(html).toContain('data-embed="youtube"');
  });

  it("rejects non-video URLs for embeds", () => {
    const e = make();
    expect(e.commands.setVideoEmbed("https://evil.example.com/embed")).toBe(false);
  });

  it("never trusts a pasted iframe src", () => {
    const e = make(
      '<div data-embed="youtube" data-url="https://www.youtube.com/watch?v=dQw4w9WgXcQ"><iframe src="https://evil.example.com"></iframe></div>',
    );
    const html = e.getHTML();
    expect(html).not.toContain("evil");
    expect(html).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
  });

  it("drops arbitrary iframes and javascript: media", () => {
    const e = make('<iframe src="https://evil.example.com"></iframe><div data-embed="video" data-url="javascript:alert(1)"></div><p>ok</p>');
    expect(e.getHTML()).not.toMatch(/evil|javascript/);
  });

  it("inserts audio/video file players", () => {
    const e = make();
    e.commands.setMediaFile({ kind: "audio", src: "https://example.com/a.mp3" });
    expect(e.getHTML()).toContain('<audio src="https://example.com/a.mp3" controls="true" preload="metadata">');
  });
});

describe("markdown input", () => {
  it("parses headings, quotes, code, rules and links from HTML", () => {
    const e = make('<h3>T</h3><blockquote><p>q</p></blockquote><pre><code>c</code></pre><hr><p><code>i</code> <a href="https://x.dev">l</a></p>');
    const html = e.getHTML();
    for (const tag of ["<h3>", "<blockquote>", "<pre>", "<hr>", "<code>i</code>", 'href="https://x.dev"']) expect(html).toContain(tag);
  });

  it("blocks javascript: links", () => {
    const e = make('<p><a href="javascript:alert(1)">bad</a></p>');
    expect(e.getHTML()).not.toContain("javascript");
  });
});

describe("paragraph count", () => {
  it("counts non-empty text blocks, ignoring blanks and footnotes", async () => {
    const { countParagraphs } = await import("../../lib/editor/stats");
    const e = make("<h2>Title</h2><p>One</p><p></p><ul><li><p>a</p></li><li><p>b</p></li></ul><blockquote><p>q</p></blockquote><pre><code>x\ny</code></pre>");
    expect(countParagraphs(e.state.doc)).toBe(6);
    e.commands.setTextSelection(3);
    insertFootnote(e);
    e.commands.insertContent("a note");
    expect(countParagraphs(e.state.doc)).toBe(6);
  });
});

describe("text colors and highlights", () => {
  const selectAll = (e: Editor) => e.commands.setTextSelection({ from: 1, to: e.state.doc.content.size - 1 });
  /** HTML with jsdom's rgb() colors written back as hex. */
  const html = (e: Editor) =>
    e.getHTML().replace(/rgb\((\d+), (\d+), (\d+)\)/g, (_m, ...c: string[]) =>
      "#" + c.slice(0, 3).map((v) => Number(v).toString(16).padStart(2, "0")).join(""),
    );

  it("highlights the selection, keeping its text color, and toggles off", () => {
    const e = make("<p>word</p>");
    selectAll(e);
    applyPaletteColor(e, ["#d64541"], 0);
    applyHighlight(e, ["#fff176"], 0);
    expect(html(e)).toBe('<p><span style="color: #d64541; background-color: #fff176;">word</span></p>');
    applyHighlight(e, ["#fff176"], 0); // same color again removes it
    expect(html(e)).toBe('<p><span style="color: #d64541;">word</span></p>');
  });

  it("removing one keeps the other, and removing both leaves no empty span", () => {
    const e = make("<p>word</p>");
    selectAll(e);
    applyPaletteColor(e, ["#d64541"], 0);
    applyHighlight(e, ["#fff176"], 0);
    clearColor(e);
    expect(html(e)).toBe('<p><span style="background-color: #fff176;">word</span></p>');
    clearHighlight(e);
    expect(html(e)).toBe("<p>word</p>");
  });

  it("ignores palette positions that don't exist", () => {
    const e = make("<p>word</p>");
    selectAll(e);
    expect(applyHighlight(e, ["#fff176"], 3)).toBe(false);
    expect(html(e)).toBe("<p>word</p>");
  });

  it("Ctrl+Shift+1 highlights with highlight color 1", () => {
    const e = make("<p>word</p>");
    selectAll(e);
    const event = new KeyboardEvent("keydown", { key: "!", code: "Digit1", keyCode: 49, ctrlKey: true, shiftKey: true });
    e.view.someProp("handleKeyDown", (f) => f(e.view, event));
    expect(html(e)).toBe('<p><span style="background-color: #fff176;">word</span></p>');
  });
});
