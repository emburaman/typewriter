import type { JSONContent } from "@tiptap/react";
import type { EditorJson } from "@/lib/shared/schemas";
import StarterKit from "@tiptap/starter-kit";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import { Footnote, FootnoteReference, Footnotes } from "./footnotes";
import { LinkExtras } from "./links";
import { MediaFile, VideoEmbed } from "./mediaNodes";
import { TypewriterKeymap } from "./typewriterKeymap";

/**
 * Formatting surface: bold, italic, underline, inline code, palette colors, links,
 * headings H1–H6, bulleted / numbered lists, blockquotes, code blocks, horizontal lines,
 * footnotes, images, audio/video files and YouTube/Vimeo embeds.
 *
 * Markdown input rules (all from TipTap unless noted):
 *   "# " … "###### " headings · "> " quote · "- " / "1. " lists · "```" code block ·
 *   `code` inline code · "---" horizontal line · **bold** · *italic* ·
 *   ![alt](url) image · [text](url) link (ours, see links.ts)
 */
export function createExtensions(getColors: () => string[], onLinkShortcut: () => void = () => undefined) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      strike: false,
      trailingNode: false,
      link: {
        openOnClick: false, // writing app: a click places the cursor; Ctrl/Cmd+click opens
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: "https",
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
      },
    }),
    TextStyle,
    Color,
    Image.configure({ allowBase64: false, HTMLAttributes: { loading: "lazy", referrerpolicy: "no-referrer" } }),
    VideoEmbed,
    MediaFile,
    FootnoteReference,
    Footnotes,
    Footnote,
    LinkExtras,
    Placeholder.configure({ placeholder: "Start typing…" }),
    TypewriterKeymap.configure({ getColors, onLinkShortcut }),
  ];
}

export function countWords(text: string): number {
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

/**
 * The single bridge between the API's structurally-validated `EditorJson` and TipTap's
 * `JSONContent`. ProseMirror validates the node tree itself when content is set.
 */
export function toEditorContent(doc: EditorJson): JSONContent {
  return doc as JSONContent;
}
