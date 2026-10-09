import { Extension, type Editor, type KeyboardShortcutCommand } from "@tiptap/react";
import { MAX_TOOLBAR_COLORS } from "@/lib/shared/schemas";

export interface TypewriterKeymapOptions {
  /** Returns the current toolbar palette (read lazily so settings changes apply immediately). */
  getColors: () => string[];
}

/**
 * Returns text to the default color. Color is the only attribute this app stores in
 * `textStyle`, so the whole mark is removed — `unsetColor()` would leave an empty
 * stored mark behind at a collapsed cursor, producing bare `<span>`s in the HTML.
 */
export function clearColor(editor: Editor): boolean {
  return editor.chain().focus().unsetMark("textStyle").run();
}

/**
 * Toggles palette color `index` on the selection / stored marks. Pressing the shortcut
 * for the color that is already active returns the text to the default color.
 */
export function applyPaletteColor(editor: Editor, colors: string[], index: number): boolean {
  const color = colors[index];
  if (!color) return false;
  if (editor.isActive("textStyle", { color })) return clearColor(editor);
  return editor.chain().focus().setColor(color).run();
}

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
    return { getColors: () => [] };
  },

  addKeyboardShortcuts() {
    const shortcuts: Record<string, KeyboardShortcutCommand> = {
      Tab: ({ editor }) => handleTab(editor),
      "Shift-Tab": ({ editor }) => {
        if (editor.isActive("listItem")) editor.commands.liftListItem("listItem");
        return true;
      },
      Escape: ({ editor }) => editor.commands.blur(),
      "Mod-0": ({ editor }) => clearColor(editor),
      "Alt-0": ({ editor }) => clearColor(editor),
    };
    for (let i = 1; i <= MAX_TOOLBAR_COLORS; i++) {
      const run: KeyboardShortcutCommand = ({ editor }) => applyPaletteColor(editor, this.options.getColors(), i - 1);
      // Mod = Ctrl on Windows/Linux, Cmd on macOS. Alt is a fallback for browsers that reserve Ctrl+digit.
      shortcuts[`Mod-${i}`] = run;
      shortcuts[`Alt-${i}`] = run;
    }
    return shortcuts;
  },
});
