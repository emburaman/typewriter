import type { JSONContent } from "@tiptap/react";
import type { EditorJson } from "@/lib/shared/schemas";
import StarterKit from "@tiptap/starter-kit";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import Placeholder from "@tiptap/extension-placeholder";
import { TypewriterKeymap } from "./typewriterKeymap";

/**
 * The deliberately small formatting surface: bold, italic, underline, palette colors,
 * bulleted and numbered lists. Headings, code, quotes, links etc. are switched off so
 * Markdown-ish input rules ("# ", "> ", "```") never surprise a writer.
 *
 * List input rules come from TipTap: "1. " starts a numbered list (any number sets the
 * start), "- " (also "* " / "+ ") starts a bulleted list.
 */
export function createExtensions(getColors: () => string[]) {
  return [
    StarterKit.configure({
      heading: false,
      blockquote: false,
      code: false,
      codeBlock: false,
      horizontalRule: false,
      strike: false,
      link: false,
      trailingNode: false,
    }),
    TextStyle,
    Color,
    Placeholder.configure({ placeholder: "Start typing…" }),
    TypewriterKeymap.configure({ getColors }),
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
