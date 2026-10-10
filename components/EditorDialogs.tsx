"use client";

import type { Editor } from "@tiptap/react";
import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { guessMediaKind, isHttpUrl, normalizeHref, parseVideoUrl, type MediaKind } from "@/lib/editor/media";

/* ---------------------------------------------------------------- */

export function LinkDialog({ editor, open, onClose }: { editor: Editor; open: boolean; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hasLink, setHasLink] = useState(false);
  const [needsText, setNeedsText] = useState(false);

  useEffect(() => {
    if (!open) return;
    const existing = (editor.getAttributes("link").href as string | undefined) ?? "";
    setUrl(existing);
    setHasLink(Boolean(existing));
    setNeedsText(editor.state.selection.empty && !existing);
    setText("");
    setError(null);
  }, [open, editor]);

  const close = () => {
    onClose();
    editor.commands.focus();
  };

  const apply = () => {
    const href = normalizeHref(url);
    if (!href) {
      setError("Enter a web address (https://…), an email (mailto:…) or an in-document anchor (#…).");
      return;
    }
    const chain = editor.chain().focus();
    if (needsText) {
      const label = text.trim() || url.trim();
      chain.insertContent({ type: "text", text: label, marks: [{ type: "link", attrs: { href } }] }).run();
    } else {
      chain.extendMarkRange("link").setLink({ href }).run();
    }
    onClose();
  };

  const remove = () => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    onClose();
  };

  return (
    <Modal
      open={open}
      title={hasLink ? "Edit link" : "Insert link"}
      onClose={close}
      onSubmit={apply}
      footer={
        <>
          {hasLink && (
            <button type="button" className="btn btn-danger" onClick={remove}>
              Remove link
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            {hasLink ? "Update" : "Insert"}
          </button>
        </>
      }
    >
      <label className="modal-field">
        <span>Address</span>
        <input
          className="input"
          autoFocus
          value={url}
          placeholder="https://example.com"
          aria-invalid={Boolean(error)}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
        />
      </label>
      {needsText && (
        <label className="modal-field">
          <span>Text to show</span>
          <input className="input" value={text} placeholder="Defaults to the address" onChange={(e) => setText(e.target.value)} />
        </label>
      )}
      {error && <p className="error-text">{error}</p>}
      <p className="hint">Tip: type <code>[text](https://…)</code> in the page to make a link without this dialog. Use the footnote button for in-document notes.</p>
    </Modal>
  );
}

/* ---------------------------------------------------------------- */

type MediaChoice = "auto" | MediaKind;

function describe(url: string, choice: MediaChoice): { kind: MediaKind | "embed" | null; label: string } {
  const video = parseVideoUrl(url);
  if (video) return { kind: "embed", label: video.provider === "youtube" ? "YouTube video" : "Vimeo video" };
  if (!isHttpUrl(url)) return { kind: null, label: "" };
  const kind = choice === "auto" ? guessMediaKind(url) : choice;
  return { kind, label: kind ? { image: "Image", audio: "Audio file", video: "Video file" }[kind] : "" };
}

export function MediaDialog({ editor, open, onClose }: { editor: Editor; open: boolean; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [choice, setChoice] = useState<MediaChoice>("auto");
  const [alt, setAlt] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setUrl("");
    setChoice("auto");
    setAlt("");
    setError(null);
  }, [open]);

  const detected = describe(url.trim(), choice);

  const close = () => {
    onClose();
    editor.commands.focus();
  };

  const insert = () => {
    const src = url.trim();
    const chain = editor.chain().focus();
    let ok = false;
    if (detected.kind === "embed") ok = chain.setVideoEmbed(src).run();
    else if (detected.kind === "image") ok = chain.setImage({ src, alt: alt.trim() || undefined }).run();
    else if (detected.kind === "audio" || detected.kind === "video") ok = chain.setMediaFile({ kind: detected.kind, src }).run();

    if (ok) onClose();
    else if (!isHttpUrl(src)) setError("Enter a full web address starting with https://");
    else setError("Couldn't tell what kind of media this is. Choose Image, Audio or Video.");
  };

  return (
    <Modal
      open={open}
      title="Insert media"
      onClose={close}
      onSubmit={insert}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Insert
          </button>
        </>
      }
    >
      <label className="modal-field">
        <span>Media URL</span>
        <input
          className="input"
          autoFocus
          value={url}
          placeholder="https://… image, audio or video file, or a YouTube / Vimeo link"
          aria-invalid={Boolean(error)}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
        />
      </label>
      {detected.kind !== "embed" && (
        <label className="modal-field">
          <span>Type</span>
          <select className="input" value={choice} onChange={(e) => setChoice(e.target.value as MediaChoice)}>
            <option value="auto">Detect from the address</option>
            <option value="image">Image</option>
            <option value="audio">Audio</option>
            <option value="video">Video file</option>
          </select>
        </label>
      )}
      {detected.kind === "image" && (
        <label className="modal-field">
          <span>Description (alt text)</span>
          <input className="input" value={alt} placeholder="What the image shows" onChange={(e) => setAlt(e.target.value)} />
        </label>
      )}
      {detected.label && <p className="hint">Will insert: {detected.label}</p>}
      {error && <p className="error-text">{error}</p>}
    </Modal>
  );
}
