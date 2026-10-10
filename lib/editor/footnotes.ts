import { Node, type Editor } from "@tiptap/react";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { newUuid } from "@/lib/uuid";

/**
 * Footnotes: an inline reference (`<sup><a href="#fn-ID">n</a></sup>`) in the text, and a
 * matching note in a "footnotes" section that always sits at the end of the document.
 *
 * The references are the source of truth. A plugin keeps everything consistent after
 * every change: it numbers the references in reading order, orders the notes to match,
 * deletes notes whose reference was deleted, and creates notes for pasted references.
 */

const safeId = (v: string | null) => (v && /^[A-Za-z0-9-]{1,64}$/.test(v) ? v : null);

export const FootnoteReference = Node.create({
  name: "footnoteReference",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      id: { default: null, rendered: false, parseHTML: (el: HTMLElement) => safeId(el.getAttribute("data-footnote-ref")) },
      label: { default: "?", rendered: false, parseHTML: (el: HTMLElement) => el.textContent?.trim() || "?" },
    };
  },

  parseHTML() {
    return [{ tag: "sup[data-footnote-ref]", priority: 100 }];
  },

  renderHTML({ node }) {
    const id = String(node.attrs.id);
    return [
      "sup",
      { class: "footnote-ref", id: `fnref-${id}`, "data-footnote-ref": id },
      ["a", { href: `#fn-${id}`, "aria-label": `Footnote ${String(node.attrs.label)}` }, String(node.attrs.label)],
    ];
  },
});

export const Footnotes = Node.create({
  name: "footnotes",
  group: "block",
  content: "footnote+",
  isolating: true,

  parseHTML() {
    // Higher priority than the regular list rules, which would otherwise claim the <ol>/<li>.
    return [{ tag: "section[data-footnotes]", contentElement: "ol", priority: 100 }];
  },

  renderHTML() {
    return ["section", { class: "footnotes", "data-footnotes": "", role: "doc-endnotes" }, ["ol", 0]];
  },
});

export const Footnote = Node.create({
  name: "footnote",
  content: "paragraph+",
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      id: { default: null, rendered: false, parseHTML: (el: HTMLElement) => safeId(el.getAttribute("data-footnote")) },
    };
  },

  parseHTML() {
    return [{ tag: "li[data-footnote]", contentElement: "div.footnote-body", priority: 100 }];
  },

  renderHTML({ node }) {
    const id = String(node.attrs.id);
    return [
      "li",
      { id: `fn-${id}`, "data-footnote": id },
      ["div", { class: "footnote-body" }, 0],
      ["a", { href: `#fnref-${id}`, class: "footnote-backref", contenteditable: "false", "aria-label": "Back to text" }, "↩"],
    ];
  },

  addProseMirrorPlugins() {
    return [footnoteSyncPlugin, footnoteNavigationPlugin];
  },
});

/** Builds the transaction that makes footnotes consistent, or null if they already are. */
export function syncFootnotes(state: EditorState): Transaction | null {
  const { doc, schema } = state;
  const refType = schema.nodes.footnoteReference;
  const sectionType = schema.nodes.footnotes;
  const noteType = schema.nodes.footnote;
  const paragraph = schema.nodes.paragraph;
  if (!refType || !sectionType || !noteType || !paragraph) return null;

  const refs: { pos: number; node: PMNode }[] = [];
  const sections: { pos: number; node: PMNode }[] = [];
  doc.descendants((node, pos) => {
    if (node.type === sectionType) {
      sections.push({ pos, node });
      return false; // references inside notes are not numbered
    }
    if (node.type === refType) refs.push({ pos, node });
    return true;
  });

  const tr = state.tr;
  let changed = false;

  // 1. Every reference gets an id; numbering follows first appearance (repeats share a number).
  const order: string[] = [];
  for (const ref of refs) {
    let id = ref.node.attrs.id as string | null;
    if (!id) {
      id = newUuid();
      tr.setNodeMarkup(ref.pos, undefined, { ...ref.node.attrs, id });
      changed = true;
    }
    if (!order.includes(id)) order.push(id);
    const label = String(order.indexOf(id) + 1);
    if (ref.node.attrs.label !== label) {
      tr.setNodeMarkup(ref.pos, undefined, { ...ref.node.attrs, id, label });
      changed = true;
    }
  }

  // 2. Exactly one notes section, last in the document, with one note per reference in order.
  const existing = new Map<string, PMNode>();
  for (const s of sections) {
    s.node.forEach((note) => {
      const id = note.attrs.id as string | null;
      if (id && !existing.has(id)) existing.set(id, note);
    });
  }
  const only = sections[0];
  const sectionOk =
    order.length === 0
      ? sections.length === 0
      : sections.length === 1 &&
        only !== undefined &&
        only.pos + only.node.nodeSize === doc.content.size &&
        only.node.childCount === order.length &&
        order.every((id, i) => only.node.child(i).attrs.id === id);

  if (!sectionOk) {
    for (const s of [...sections].reverse()) {
      const from = tr.mapping.map(s.pos);
      const to = from + s.node.nodeSize;
      // The document must keep at least one block.
      if (tr.doc.childCount === 1) tr.replaceWith(from, to, paragraph.create());
      else tr.delete(from, to);
    }
    if (order.length > 0) {
      const notes = order.map((id) => existing.get(id) ?? noteType.create({ id }, paragraph.create()));
      tr.insert(tr.doc.content.size, sectionType.create(null, notes));
    }
    changed = true;
  }

  return changed ? tr : null;
}

const footnoteSyncPlugin = new Plugin({
  key: new PluginKey("footnoteSync"),
  appendTransaction(transactions, _old, state) {
    return transactions.some((t) => t.docChanged) ? syncFootnotes(state) : null;
  },
});

/** Clicking a reference jumps to its note; clicking ↩ in a note jumps back to the text. */
const footnoteNavigationPlugin = new Plugin({
  key: new PluginKey("footnoteNavigation"),
  props: {
    handleDOMEvents: {
      click(view, event) {
        const anchor = (event.target as HTMLElement | null)?.closest?.('a[href^="#fn"]');
        if (!anchor) return false;
        event.preventDefault();
        const targetId = anchor.getAttribute("href")?.slice(1) ?? "";
        const target = view.dom.querySelector(`[id="${CSS.escape(targetId)}"]`);
        if (!target) return true;
        target.scrollIntoView({ block: "center", behavior: "smooth" });
        const pos = view.posAtDOM(target, 0);
        const $pos = view.state.doc.resolve(Math.min(pos + (targetId.startsWith("fnref-") ? 1 : 0), view.state.doc.content.size));
        view.dispatch(view.state.tr.setSelection(TextSelection.near($pos)));
        view.focus();
        return true;
      },
    },
  },
});

/** Inserts a footnote at the cursor and moves the cursor into its (new, empty) note. */
export function insertFootnote(editor: Editor): boolean {
  if (editor.isActive("footnote")) return false; // no footnotes inside footnotes
  const id = newUuid();
  const ok = editor.chain().focus().insertContent({ type: "footnoteReference", attrs: { id } }).run();
  if (!ok) return false;
  let target = -1;
  editor.state.doc.descendants((node, pos) => {
    if (target >= 0) return false;
    if (node.type.name === "footnote" && node.attrs.id === id) {
      target = pos + 2; // inside the note's first paragraph
      return false;
    }
    return true;
  });
  if (target >= 0) editor.chain().setTextSelection(target).scrollIntoView().run();
  return true;
}
