import { Node } from "@tiptap/react";
import {
  isHttpUrl,
  isValidVideoRef,
  parseVideoUrl,
  videoEmbedSrc,
  videoWatchUrl,
  type VideoRef,
} from "./media";

declare module "@tiptap/react" {
  interface Commands<ReturnType> {
    videoEmbed: {
      /** Inserts a YouTube/Vimeo player. Fails (returns false) for any other URL. */
      setVideoEmbed: (url: string) => ReturnType;
    };
    mediaFile: {
      /** Inserts an <audio>/<video> player for a direct http(s) file URL. */
      setMediaFile: (options: { kind: "audio" | "video"; src: string }) => ReturnType;
    };
  }
}

/** Attributes stored in the document JSON only — never copied to the DOM as-is. */
const internal = (name: string, fallback: unknown = null) => ({
  default: fallback,
  rendered: false,
  parseHTML: (el: HTMLElement) => el.getAttribute(`data-${name}`),
});

/**
 * YouTube / Vimeo embed. The document stores provider + id (+ start/hash); the iframe `src`
 * is rebuilt from those on every render, so pasted or tampered HTML can't inject other frames.
 */
export const VideoEmbed = Node.create({
  name: "videoEmbed",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      provider: internal("provider"),
      videoId: internal("video-id"),
      start: { ...internal("start"), parseHTML: (el: HTMLElement) => Number(el.getAttribute("data-start")) || null },
      hash: internal("hash"),
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-embed]",
        getAttrs: (el) => {
          const kind = el.getAttribute("data-embed");
          if (kind !== "youtube" && kind !== "vimeo") return false;
          const ref = parseVideoUrl(el.getAttribute("data-url") ?? "");
          return ref ? { ...ref } : false;
        },
      },
    ];
  },

  renderHTML({ node }) {
    const ref = node.attrs as Partial<VideoRef>;
    if (!isValidVideoRef(ref)) return ["div", { class: "embed embed-invalid" }, "Unsupported video"];
    const url = videoWatchUrl(ref);
    return [
      "div",
      { class: "embed embed-video", "data-embed": ref.provider, "data-url": url },
      [
        "iframe",
        {
          src: videoEmbedSrc(ref),
          title: ref.provider === "youtube" ? "YouTube video" : "Vimeo video",
          allow: "accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen",
          allowfullscreen: "true",
          referrerpolicy: "strict-origin-when-cross-origin",
          loading: "lazy",
          frameborder: "0",
        },
      ],
    ];
  },

  addCommands() {
    return {
      setVideoEmbed:
        (url) =>
        ({ commands }) => {
          const ref = parseVideoUrl(url);
          return ref ? commands.insertContent({ type: this.name, attrs: { ...ref } }) : false;
        },
    };
  },
});

/** Direct audio / video file from a URL, played with the browser's native controls. */
export const MediaFile = Node.create({
  name: "mediaFile",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      kind: { default: "video", rendered: false, parseHTML: (el: HTMLElement) => el.getAttribute("data-embed") },
      src: { default: null, rendered: false, parseHTML: (el: HTMLElement) => el.getAttribute("data-url") },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-embed]",
        getAttrs: (el) => {
          const kind = el.getAttribute("data-embed");
          const src = el.getAttribute("data-url") ?? "";
          return (kind === "audio" || kind === "video") && isHttpUrl(src) ? null : false;
        },
      },
    ];
  },

  renderHTML({ node }) {
    const kind = node.attrs.kind === "audio" ? "audio" : "video";
    const src = String(node.attrs.src ?? "");
    if (!isHttpUrl(src)) return ["div", { class: "embed embed-invalid" }, "Unsupported media URL"];
    return [
      "div",
      { class: `embed embed-${kind}`, "data-embed": kind, "data-url": src },
      [kind, { src, controls: "true", preload: "metadata" }],
    ];
  },

  addCommands() {
    return {
      setMediaFile:
        ({ kind, src }) =>
        ({ commands }) =>
          isHttpUrl(src) ? commands.insertContent({ type: this.name, attrs: { kind, src } }) : false,
    };
  },
});
