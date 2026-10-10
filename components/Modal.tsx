"use client";

import { useEffect, useRef, type FormEvent, type ReactNode } from "react";

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  onSubmit: () => void;
  children: ReactNode;
  footer: ReactNode;
}

/** Thin wrapper over <dialog>: native focus trapping, Esc to close, backdrop. */
export function Modal({ open, title, onClose, onSubmit, children, footer }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  return (
    <dialog ref={ref} className="modal" aria-label={title} onClose={onClose}>
      <form onSubmit={submit}>
        <h2 className="modal-title">{title}</h2>
        {children}
        <div className="modal-actions">{footer}</div>
      </form>
    </dialog>
  );
}
