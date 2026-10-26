import type { JSONContent } from "@tiptap/react";
import type { EditorJson } from "@/lib/shared/schemas";
import StarterKit from "@tiptap/starter-kit";
import { BackgroundColor, Color, TextStyle } from "@tiptap/extension-text-style";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import { Footnote, FootnoteReference, Footnotes } from "./footnotes";
import { LinkExtras } from "./links";
import { MediaFile, VideoEmbed } from "./mediaNodes";
import { TypewriterKeymap } from "./typewriterKeymap";

/**
 * Formatting surface: bold, italic, underline, inline code, palette colors and highlights, links,
 * headings H1–H6, bulleted / numbered lists, blockquotes, code blocks, horizontal lines,
 * footnotes, images, audio/video files and YouTube/Vimeo embeds.
 *
 * Markdown input rules (all from TipTap unless noted):
 *   "# " … "###### " headings · "> " quote · "- " / "1. " lists · "```" code block ·
 *   `code` inline code · "---" horizontal line · **bold** · *italic* ·
 *   ![alt](url) image · [text](url) link (ours, see links.ts)
 */
export interface ExtensionOptions {
  /** Text color palette (Ctrl+1…5), read lazily so settings changes apply immediately. */
  getColors: () => string[];
  /** Highlight palette (Ctrl+Shift+1…5), read lazily too. */
  getHighlights?: () => string[];
  /** Opens the link dialog (Ctrl+K). */
  onLinkShortcut?: () => void;
}

export function createExtensions({ getColors, getHighlights = () => [], onLinkShortcut = () => undefined }: ExtensionOptions) {
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
    BackgroundColor, // highlights: background-color on the same <span>, as Google Docs does
    Image.configure({ allowBase64: false, HTMLAttributes: { loading: "lazy", referrerpolicy: "no-referrer" } }),
    VideoEmbed,
    MediaFile,
    FootnoteReference,
    Footnotes,
    Footnote,
    LinkExtras,
    Placeholder.configure({ placeholder: "Start typing…" }),
    TypewriterKeymap.configure({ getColors, getHighlights, onLinkShortcut }),
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
