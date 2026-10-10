import { describe, expect, it } from "vitest";
import { guessMediaKind, isValidVideoRef, normalizeHref, parseVideoUrl, videoEmbedSrc } from "../../lib/editor/media";
import { replaceEmbedsWithLinks } from "../../server/services/driveHtml";

describe("parseVideoUrl", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=share", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ])("YouTube %s", (url, id) => {
    expect(parseVideoUrl(url)).toMatchObject({ provider: "youtube", videoId: id });
  });

  it("reads YouTube start times", () => {
    expect(parseVideoUrl("https://youtu.be/dQw4w9WgXcQ?t=1m30s")?.start).toBe(90);
    expect(parseVideoUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42")?.start).toBe(42);
  });

  it.each([
    ["https://vimeo.com/76979871", "76979871", null],
    ["https://vimeo.com/76979871/abcdef1234", "76979871", "abcdef1234"],
    ["https://player.vimeo.com/video/76979871?h=abcdef1234", "76979871", "abcdef1234"],
  ])("Vimeo %s", (url, id, hash) => {
    expect(parseVideoUrl(url)).toMatchObject({ provider: "vimeo", videoId: id, hash });
  });

  it("rejects other hosts, bad ids and non-http schemes", () => {
    for (const url of [
      "https://example.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=short",
      "https://youtu.be/dQw4w9WgXcQ\"><script>",
      "javascript:alert(1)//youtube.com/watch?v=dQw4w9WgXcQ",
      "https://vimeo.com/channels/staffpicks",
      "not a url",
    ]) {
      expect(parseVideoUrl(url)).toBeNull();
    }
  });

  it("builds privacy-friendly player URLs and re-validates stored refs", () => {
    expect(videoEmbedSrc({ provider: "vimeo", videoId: "1", hash: "abcdef12", start: null })).toBe(
      "https://player.vimeo.com/video/1?dnt=1&h=abcdef12",
    );
    expect(isValidVideoRef({ provider: "youtube", videoId: "../../evil" })).toBe(false);
  });
});

describe("normalizeHref", () => {
  it("accepts http(s), mailto, anchors and bare www.", () => {
    expect(normalizeHref("https://a.dev/x")).toBe("https://a.dev/x");
    expect(normalizeHref("www.a.dev")).toBe("https://www.a.dev");
    expect(normalizeHref("mailto:me@a.dev")).toBe("mailto:me@a.dev");
    expect(normalizeHref("#fn-1")).toBe("#fn-1");
  });

  it("rejects dangerous or empty values", () => {
    for (const v of ["", "javascript:alert(1)", "data:text/html,x", "vbscript:x", "# bad anchor"]) {
      expect(normalizeHref(v)).toBeNull();
    }
  });
});

describe("guessMediaKind", () => {
  it("detects by file extension", () => {
    expect(guessMediaKind("https://a.dev/p/photo.JPG?x=1")).toBe("image");
    expect(guessMediaKind("https://a.dev/song.mp3")).toBe("audio");
    expect(guessMediaKind("https://a.dev/clip.webm")).toBe("video");
    expect(guessMediaKind("https://a.dev/page")).toBeNull();
    expect(guessMediaKind("ftp://a.dev/a.png")).toBeNull();
  });
});

describe("replaceEmbedsWithLinks (Drive export)", () => {
  it("turns embeds into links and keeps everything else", () => {
    const html =
      '<p>before</p><div class="embed embed-video" data-embed="youtube" data-url="https://www.youtube.com/watch?v=dQw4w9WgXcQ"><iframe src="x"></iframe></div>' +
      '<div class="embed" data-embed="audio" data-url="https://a.dev/s.mp3"><audio src="https://a.dev/s.mp3" controls="true"></audio></div><p>after</p>';
    const out = replaceEmbedsWithLinks(html);
    expect(out).toContain('<a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">▶ Video:');
    expect(out).toContain('<a href="https://a.dev/s.mp3">▶ Audio:');
    expect(out).not.toMatch(/iframe|<audio/);
    expect(out).toMatch(/^<p>before<\/p>.*<p>after<\/p>$/);
  });

  it("drops embeds whose URL isn't http(s)", () => {
    expect(replaceEmbedsWithLinks('<div data-embed="video" data-url="javascript:x"><video></video></div>')).toBe("");
  });
});
