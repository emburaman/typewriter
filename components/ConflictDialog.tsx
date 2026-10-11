"use client";

import type { DocumentRecord } from "@/lib/shared/schemas";
import { Modal } from "./Modal";

interface ConflictDialogProps {
  open: boolean;
  server: DocumentRecord;
  onKeepBoth: () => void;
  onUseTheirs: () => void;
  onOverwrite: () => void;
  /** Closing without choosing keeps your text on screen; autosave stays paused until you choose. */
  onLater: () => void;
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Shown when this device and another one both changed the same document. */
export function ConflictDialog({ open, server, onKeepBoth, onUseTheirs, onOverwrite, onLater }: ConflictDialogProps) {
  return (
    <Modal
      open={open}
      title="Changed on another device"
      onClose={onLater}
      onSubmit={onKeepBoth}
      footer={
        <div className="conflict-actions">
          <button type="submit" className="btn btn-primary">
            Keep both
          </button>
          <button type="button" className="btn" onClick={onUseTheirs}>
            Use the other version
          </button>
          <button type="button" className="btn btn-danger" onClick={onOverwrite}>
            Overwrite with mine
          </button>
        </div>
      }
    >
      <p>
        “{server.title || "Untitled"}” was saved on another device ({when(server.updatedAt)}, {server.wordCount} words)
        while you were editing it here.
      </p>
      <ul className="hint conflict-options">
        <li>
          <strong>Keep both</strong>: your version is saved as a separate copy, and this document shows the other
          device&apos;s version.
        </li>
        <li>
          <strong>Use the other version</strong>: your changes here are discarded.
        </li>
        <li>
          <strong>Overwrite with mine</strong>: the other device&apos;s changes are replaced by yours.
        </li>
      </ul>
    </Modal>
  );
}
