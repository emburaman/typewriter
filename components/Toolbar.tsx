"use client";

import { useEditorState, type Editor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { insertFootnote } from "@/lib/editor/footnotes";
import { applyHighlight, applyPaletteColor, clearColor, clearHighlight } from "@/lib/editor/typewriterKeymap";
import { Icon, type IconName } from "./Icon";

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

interface ToolbarProps {
  editor: Editor;
  colors: string[];
  highlights: string[];
  /** Whether the toolbar is currently showing (an open color menu closes when it hides). */
  shown: boolean;
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

const sameColor = (a: string | null, b: string) => a?.toLowerCase() === b.toLowerCase();

/**
 * A toolbar button that opens a row of swatches: 0 removes the color, 1…n apply the palette.
 * The menu is positioned `fixed` so the phone toolbar's sideways scrolling can't clip it.
 */
function PaletteMenu(props: {
  label: string;
  menuLabel: string;
  trigger: React.ReactNode;
  current: string | null;
  palette: string[];
  noneLabel: string;
  /** Swatch 0 shows the theme's text color ("default") or an empty, crossed-out circle ("none"). */
  noneSwatch: "default" | "none";
  itemLabel: (n: number, color: string) => string;
  /** Shortcut text for swatch n (0 = remove). */
  keys: (n: number) => string;
  shown: boolean;
  onClear: () => void;
  onPick: (index: number) => void;
}) {
  const { shown, current } = props;
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const open = at !== null;

  useEffect(() => {
    if (!shown) setAt(null);
  }, [shown]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof PointerEvent && root.current?.contains(e.target as Node)) return;
      setAt(null);
    };
    const closeNow = () => setAt(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    window.addEventListener("resize", closeNow);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
      window.removeEventListener("resize", closeNow);
    };
  }, [open]);

  const toggle = (button: HTMLElement) => {
    if (open) return setAt(null);
    const r = button.getBoundingClientRect();
    // Keep the menu on screen; ~16rem is its widest (6 swatches).
    const width = Math.min(260, window.innerWidth - 16);
    setAt({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) });
  };
  const pick = (action: () => void) => {
    action();
    setAt(null);
  };

  return (
    <div className="palette" ref={root}>
      <button
        type="button"
        className="tool-btn palette-btn"
        aria-label={props.label}
        aria-haspopup="true"
        aria-expanded={open}
        title={props.label}
        onMouseDown={keepFocus}
        onClick={(e) => toggle(e.currentTarget)}
      >
        {props.trigger}
        <span className={`palette-bar palette-bar-${current ? "set" : props.noneSwatch}`} style={current ? { background: current } : undefined} />
        <Icon name="chevronDown" size={12} />
      </button>
      {at && (
        <div className="palette-menu" role="group" aria-label={props.menuLabel} style={{ top: at.top, left: at.left }}>
          <button
            type="button"
            className={`swatch swatch-${props.noneSwatch}`}
            aria-pressed={current === null}
            aria-label={props.noneLabel}
            title={`${props.noneLabel} (${props.keys(0)})`}
            onMouseDown={keepFocus}
            onClick={() => pick(props.onClear)}
          >
            <span className="swatch-key" aria-hidden="true">
              0
            </span>
          </button>
          {props.palette.map((color, i) => (
            <button
              key={`${color}-${i}`}
              type="button"
              className="swatch"
              aria-pressed={sameColor(current, color)}
              aria-label={props.itemLabel(i + 1, color)}
              title={`${props.itemLabel(i + 1, color)} (${props.keys(i + 1)})`}
              style={{ "--swatch": color } as React.CSSProperties}
              onMouseDown={keepFocus}
              onClick={() => pick(() => props.onPick(i))}
            >
              <span className="swatch-key" aria-hidden="true">
                {i + 1}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Formatting toolbar. Every action is also reachable from the keyboard (see Settings → Shortcuts). */
export function Toolbar({ editor, colors, highlights, shown, onLink, onMedia }: ToolbarProps) {
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
        highlight: (e.getAttributes("textStyle").backgroundColor as string | undefined) ?? null,
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

      <div className="toolbar-group">
        <PaletteMenu
          label="Text color"
          menuLabel="Font colors"
          trigger={<span className="color-glyph">A</span>}
          current={s.color}
          palette={colors}
          noneLabel="Default text color"
          noneSwatch="default"
          itemLabel={(i, c) => `Color ${i} (${c})`}
          keys={(n) => `${mod}${n}`}
          shown={shown}
          onClear={() => clearColor(editor)}
          onPick={(i) => applyPaletteColor(editor, colors, i)}
        />
        <PaletteMenu
          label="Highlight"
          menuLabel="Highlight colors"
          trigger={icon("highlighter")}
          current={s.highlight}
          palette={highlights}
          noneLabel="No highlight"
          noneSwatch="none"
          itemLabel={(i, c) => `Highlight ${i} (${c})`}
          keys={(n) => `${mod}Shift+${n}`}
          shown={shown}
          onClear={() => clearHighlight(editor)}
          onPick={(i) => applyHighlight(editor, highlights, i)}
        />
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
