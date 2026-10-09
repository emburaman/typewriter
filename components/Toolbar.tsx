"use client";

import { useEditorState, type Editor } from "@tiptap/react";
import { applyPaletteColor, clearColor } from "@/lib/editor/typewriterKeymap";
import { Icon } from "./Icon";

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

interface ToolbarProps {
  editor: Editor;
  colors: string[];
}

/** Formatting toolbar. Every action is also reachable from the keyboard (see Settings → Shortcuts). */
export function Toolbar({ editor, colors }: ToolbarProps) {
  const mod = isMac() ? "⌘" : "Ctrl+";
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      bulletList: e.isActive("bulletList"),
      orderedList: e.isActive("orderedList"),
      color: (e.getAttributes("textStyle").color as string | undefined) ?? null,
    }),
  });

  // Keep the editor selection when clicking toolbar buttons.
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <div className="toolbar-group">
        <button
          type="button"
          className="tool-btn"
          aria-pressed={state.bold}
          title={`Bold (${mod}B)`}
          onMouseDown={keepFocus}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          className="tool-btn"
          aria-pressed={state.italic}
          title={`Italic (${mod}I)`}
          onMouseDown={keepFocus}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <em>I</em>
        </button>
        <button
          type="button"
          className="tool-btn"
          aria-pressed={state.underline}
          title={`Underline (${mod}U)`}
          onMouseDown={keepFocus}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <span style={{ textDecoration: "underline" }}>U</span>
        </button>
      </div>

      <div className="toolbar-group" aria-label="Font colors">
        {colors.map((color, i) => {
          const active = state.color?.toLowerCase() === color.toLowerCase();
          return (
            <button
              key={`${color}-${i}`}
              type="button"
              className="swatch"
              aria-pressed={active}
              aria-label={`Color ${i + 1} (${color})`}
              title={`Color ${i + 1} — ${color} (${mod}${i + 1})`}
              style={{ "--swatch": color } as React.CSSProperties}
              onMouseDown={keepFocus}
              onClick={() => applyPaletteColor(editor, colors, i)}
            >
              <span className="swatch-key" aria-hidden="true">
                {i + 1}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          className="tool-btn"
          title={`Default color (${mod}0)`}
          aria-label="Default text color"
          onMouseDown={keepFocus}
          onClick={() => clearColor(editor)}
        >
          <Icon name="eraser" size={16} />
        </button>
      </div>

      <div className="toolbar-group">
        <button
          type="button"
          className="tool-btn"
          aria-pressed={state.bulletList}
          title='Bulleted list (type "- ")'
          aria-label="Bulleted list"
          onMouseDown={keepFocus}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <Icon name="bulletList" />
        </button>
        <button
          type="button"
          className="tool-btn"
          aria-pressed={state.orderedList}
          title='Numbered list (type "1. ")'
          aria-label="Numbered list"
          onMouseDown={keepFocus}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <Icon name="orderedList" />
        </button>
      </div>
    </div>
  );
}
