"use client";

import { useEditorState, type Editor } from "@tiptap/react";
import { insertFootnote } from "@/lib/editor/footnotes";
import { applyPaletteColor, clearColor } from "@/lib/editor/typewriterKeymap";
import { Icon, type IconName } from "./Icon";

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

interface ToolbarProps {
  editor: Editor;
  colors: string[];
  onLink: () => void;
  onMedia: () => void;
}

type BlockType = "paragraph" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;

/** Keep the editor selection when clicking toolbar buttons. */
const keepFocus = (e: React.MouseEvent) => e.preventDefault();

function ToolButton(props: {
  label: string;
  shortcut?: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="tool-btn"
      aria-label={props.label}
      aria-pressed={props.pressed}
      disabled={props.disabled}
      title={props.shortcut ? `${props.label} (${props.shortcut})` : props.label}
      onMouseDown={keepFocus}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

const icon = (name: IconName) => <Icon name={name} size={17} />;

/** Formatting toolbar. Every action is also reachable from the keyboard (see Settings → Shortcuts). */
export function Toolbar({ editor, colors, onLink, onMedia }: ToolbarProps) {
  const mod = isMac() ? "⌘" : "Ctrl+";
  const alt = isMac() ? "⌥" : "Alt+";
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const level = HEADING_LEVELS.find((l) => e.isActive("heading", { level: l }));
      return {
        bold: e.isActive("bold"),
        italic: e.isActive("italic"),
        underline: e.isActive("underline"),
        code: e.isActive("code"),
        link: e.isActive("link"),
        bulletList: e.isActive("bulletList"),
        orderedList: e.isActive("orderedList"),
        blockquote: e.isActive("blockquote"),
        codeBlock: e.isActive("codeBlock"),
        inFootnote: e.isActive("footnote"),
        block: (level ? `h${level}` : "paragraph") as BlockType,
        color: (e.getAttributes("textStyle").color as string | undefined) ?? null,
      };
    },
  });

  const setBlock = (value: BlockType) => {
    const chain = editor.chain().focus();
    if (value === "paragraph") chain.setParagraph().run();
    else chain.setHeading({ level: Number(value.slice(1)) as (typeof HEADING_LEVELS)[number] }).run();
  };

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <div className="toolbar-group">
        <ToolButton label="Bold" shortcut={`${mod}B`} pressed={s.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
          <strong>B</strong>
        </ToolButton>
        <ToolButton label="Italic" shortcut={`${mod}I`} pressed={s.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <em>I</em>
        </ToolButton>
        <ToolButton
          label="Underline"
          shortcut={`${mod}U`}
          pressed={s.underline}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <span style={{ textDecoration: "underline" }}>U</span>
        </ToolButton>
        <ToolButton label="Inline code" shortcut={`${mod}E or \`code\``} pressed={s.code} onClick={() => editor.chain().focus().toggleCode().run()}>
          {icon("code")}
        </ToolButton>
        <ToolButton label="Link" shortcut={`${mod}K`} pressed={s.link} onClick={onLink}>
          {icon("link")}
        </ToolButton>
      </div>

      <div className="toolbar-group" aria-label="Font colors">
        <button
          type="button"
          className="swatch swatch-default"
          aria-pressed={s.color === null}
          aria-label="Default text color"
          title={`Default text color (${mod}0)`}
          onMouseDown={keepFocus}
          onClick={() => clearColor(editor)}
        >
          <span className="swatch-key" aria-hidden="true">
            0
          </span>
        </button>
        {colors.map((color, i) => {
          const active = s.color?.toLowerCase() === color.toLowerCase();
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
      </div>

      <div className="toolbar-group">
        <select
          className="block-select"
          aria-label="Text style"
          title={`Text style (headings: ${mod}${alt}1…6, or type "# " … "###### ")`}
          value={s.block}
          onChange={(e) => setBlock(e.target.value as BlockType)}
        >
          <option value="paragraph">Paragraph</option>
          {HEADING_LEVELS.map((l) => (
            <option key={l} value={`h${l}`}>
              Heading {l}
            </option>
          ))}
        </select>
      </div>

      <div className="toolbar-group">
        <ToolButton label="Bulleted list" shortcut='type "- "' pressed={s.bulletList} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          {icon("bulletList")}
        </ToolButton>
        <ToolButton label="Numbered list" shortcut='type "1. "' pressed={s.orderedList} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          {icon("orderedList")}
        </ToolButton>
        <ToolButton label="Quote" shortcut={`${mod}Shift+B or type "> "`} pressed={s.blockquote} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          {icon("quote")}
        </ToolButton>
        <ToolButton label="Code block" shortcut={`${mod}${alt}C or type \`\`\``} pressed={s.codeBlock} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
          {icon("codeBlock")}
        </ToolButton>
      </div>

      <div className="toolbar-group" aria-label="Insert">
        <ToolButton label="Horizontal line" shortcut='type "---"' onClick={() => editor.chain().focus().setHorizontalRule().run()}>
          {icon("rule")}
        </ToolButton>
        <ToolButton label="Footnote" shortcut={`${mod}${alt}F`} disabled={s.inFootnote} onClick={() => insertFootnote(editor)}>
          <span className="footnote-icon" aria-hidden="true">
            x<sup>1</sup>
          </span>
        </ToolButton>
        <ToolButton label="Insert media (image, audio, video, YouTube, Vimeo)" onClick={onMedia}>
          {icon("image")}
        </ToolButton>
      </div>
    </div>
  );
}
