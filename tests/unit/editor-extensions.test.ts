// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { createExtensions } from "../../lib/editor/extensions";
import { insertFootnote } from "../../lib/editor/footnotes";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function make(content = "<p></p>") {
  editor = new Editor({ extensions: createExtensions(() => ["#d64541"]), content });
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
