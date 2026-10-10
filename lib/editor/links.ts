import { Extension, InputRule } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { normalizeHref } from "./media";

/**
 * Link extras on top of TipTap's Link mark:
 * - Markdown input rule: typing `[text](https://…)` turns into a link ("![alt](url)" stays an image);
 * - Ctrl/Cmd+click opens an external link in a new tab (plain clicks just place the cursor);
 * - clicking a `#anchor` link scrolls to that element in the document.
 */
export const LinkExtras = Extension.create({
  name: "linkExtras",

  addInputRules() {
    return [
      new InputRule({
        find: /(^|[^!])\[([^\]]+)\]\(([^)\s]+)\)$/,
        handler: ({ state, range, match }) => {
          const [, lead = "", text = "", rawHref = ""] = match;
          const href = normalizeHref(rawHref);
          const linkType = state.schema.marks.link;
          if (!href || !linkType || !text) return null;
          const from = range.from + lead.length;
          state.tr.insertText(text, from, range.to);
          state.tr.addMark(from, from + text.length, linkType.create({ href }));
          state.tr.removeStoredMark(linkType);
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("linkClicks"),
        props: {
          handleDOMEvents: {
            click(view, event) {
              const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]");
              if (!anchor || anchor.closest("[data-footnote-ref], [data-footnote]")) return false;
              const href = anchor.getAttribute("href") ?? "";
              if (href.startsWith("#")) {
                event.preventDefault();
                view.dom.querySelector(`[id="${CSS.escape(href.slice(1))}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
                return true;
              }
              if (event.ctrlKey || event.metaKey) {
                event.preventDefault();
                window.open(href, "_blank", "noopener,noreferrer");
                return true;
              }
              return false;
            },
          },
        },
      }),
    ];
  },
});
