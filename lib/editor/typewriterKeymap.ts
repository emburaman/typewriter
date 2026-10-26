import { Extension, type Editor, type KeyboardShortcutCommand } from "@tiptap/react";
import { MAX_TOOLBAR_COLORS } from "@/lib/shared/schemas";
import { insertFootnote } from "./footnotes";

export interface TypewriterKeymapOptions {
  /** Returns the current toolbar palette (read lazily so settings changes apply immediately). */
  getColors: () => string[];
  /** Returns the current highlight palette (read lazily, like getColors). */
  getHighlights: () => string[];
  /** Opens the link dialog (Ctrl/Cmd+K). */
  onLinkShortcut: () => void;
}

/** The two attributes this app stores in the `textStyle` mark. */
type StyleAttr = "color" | "backgroundColor";

/**
 * Removes one textStyle attribute (text color or highlight) and keeps the other. When nothing
 * else is left at a collapsed cursor the whole mark goes: `unsetColor()` would leave an empty
 * stored mark behind there, producing bare `<span>`s in the HTML.
 */
function clearStyleAttr(editor: Editor, attr: StyleAttr): boolean {
  const other: StyleAttr = attr === "color" ? "backgroundColor" : "color";
  if (editor.state.selection.empty && !editor.getAttributes("textStyle")[other]) {
    return editor.chain().focus().unsetMark("textStyle").run();
  }
  return editor.chain().focus().setMark("textStyle", { [attr]: null }).removeEmptyTextStyle().run();
}

/** Toggles palette entry `index` for `attr`: applying the active color again removes it. */
function togglePaletteStyle(editor: Editor, attr: StyleAttr, palette: string[], index: number): boolean {
  const value = palette[index];
  if (!value) return false;
  if (editor.isActive("textStyle", { [attr]: value })) return clearStyleAttr(editor, attr);
  return editor.chain().focus().setMark("textStyle", { [attr]: value }).run();
}

/** Returns text to the default color (a highlight stays). */
export const clearColor = (editor: Editor) => clearStyleAttr(editor, "color");

/** Removes the highlight (the text color stays). */
export const clearHighlight = (editor: Editor) => clearStyleAttr(editor, "backgroundColor");

/**
 * Toggles palette color `index` on the selection / stored marks. Pressing the shortcut
 * for the color that is already active returns the text to the default color.
 */
export const applyPaletteColor = (editor: Editor, colors: string[], index: number) =>
  togglePaletteStyle(editor, "color", colors, index);

/** Toggles highlight color `index`, like applyPaletteColor. */
export const applyHighlight = (editor: Editor, highlights: string[], index: number) =>
  togglePaletteStyle(editor, "backgroundColor", highlights, index);

/**
 * Tab behaviour for a typewriter:
 * - in a list item, at the very start of its text (i.e. right after the bullet/number)
 *   or with a range selected → nest the item one level deeper;
 * - anywhere else → insert a literal tab character.
 * Always handled, so Tab never moves focus out of the page mid-sentence (Esc does).
 */
export function handleTab(editor: Editor): boolean {
  const { empty, $from } = editor.state.selection;
  if (editor.isActive("listItem") && (!empty || $from.parentOffset === 0)) {
    // sinkListItem fails for the first item of a list (nothing to nest under); swallow the key anyway.
    editor.commands.sinkListItem("listItem");
    return true;
  }
  return editor.commands.insertContent("\t");
}

export const TypewriterKeymap = Extension.create<TypewriterKeymapOptions>({
  name: "typewriterKeymap",
  // Run before ListItem's own Tab handler (priority 100).
  priority: 1000,

  addOptions() {
    return { getColors: () => [], getHighlights: () => [], onLinkShortcut: () => undefined };
  },

  addKeyboardShortcuts() {
    const shortcuts: Record<string, KeyboardShortcutCommand> = {
      Tab: ({ editor }) => handleTab(editor),
      "Shift-Tab": ({ editor }) => {
        if (editor.isActive("listItem")) editor.commands.liftListItem("listItem");
        return true;
      },
      Escape: ({ editor }) => editor.commands.blur(),
      "Mod-k": () => {
        this.options.onLinkShortcut();
        return true;
      },
      "Mod-Alt-f": ({ editor }) => insertFootnote(editor),
      "Mod-0": ({ editor }) => clearColor(editor),
      "Alt-0": ({ editor }) => clearColor(editor),
      "Mod-Shift-0": ({ editor }) => clearHighlight(editor),
      "Alt-Shift-0": ({ editor }) => clearHighlight(editor),
    };
    for (let i = 1; i <= MAX_TOOLBAR_COLORS; i++) {
      const run: KeyboardShortcutCommand = ({ editor }) => applyPaletteColor(editor, this.options.getColors(), i - 1);
      // Mod = Ctrl on Windows/Linux, Cmd on macOS. Alt is a fallback for browsers that reserve Ctrl+digit.
      shortcuts[`Mod-${i}`] = run;
      shortcuts[`Alt-${i}`] = run;
      // Highlights: the same with Shift (ProseMirror matches Shift+digit by key code, not "!" etc.).
      const highlight: KeyboardShortcutCommand = ({ editor }) =>
        applyHighlight(editor, this.options.getHighlights(), i - 1);
      shortcuts[`Mod-Shift-${i}`] = highlight;
      shortcuts[`Alt-Shift-${i}`] = highlight;
    }
    return shortcuts;
  },
});
