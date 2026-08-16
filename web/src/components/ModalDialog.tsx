import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface ModalDialogProps {
  readonly children: React.ReactNode;
  readonly className: string;
  readonly labelledBy: string;
  readonly initialFocusRef?: React.RefObject<HTMLElement | null>;
  readonly onClose: () => void;
}

const modalStack: string[] = [];

function notifyStackChange(): void {
  window.dispatchEvent(new Event("hot-cross-buns-modal-stack-change"));
}

function modalHost(): HTMLElement {
  let host = document.getElementById("hot-cross-buns-modal-root");
  if (!host) {
    host = document.createElement("div");
    host.id = "hot-cross-buns-modal-root";
    document.body.append(host);
  }
  return host;
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(
    "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])"
  )].filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
}

export function ModalDialog({ children, className, labelledBy, initialFocusRef, onClose }: ModalDialogProps): React.JSX.Element | null {
  const id = useRef(crypto.randomUUID()).current;
  const dialogRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [revision, setRevision] = useState(0);
  const isTop = modalStack.at(-1) === id;

  useLayoutEffect(() => {
    const refresh = () => setRevision((current) => current + 1);
    window.addEventListener("hot-cross-buns-modal-stack-change", refresh);
    return () => window.removeEventListener("hot-cross-buns-modal-stack-change", refresh);
  }, []);

  useLayoutEffect(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modalStack.push(id);
    document.getElementById("root")?.setAttribute("inert", "");
    notifyStackChange();
    queueMicrotask(() => {
      const target = initialFocusRef?.current ?? focusableElements(dialogRef.current ?? document.body)[0];
      target?.focus();
    });
    return () => {
      const index = modalStack.lastIndexOf(id);
      if (index >= 0) {
        modalStack.splice(index, 1);
      }
      if (modalStack.length === 0) {
        document.getElementById("root")?.removeAttribute("inert");
      }
      notifyStackChange();
      const opener = openerRef.current;
      if (opener?.isConnected) {
        queueMicrotask(() => opener.focus());
      }
    };
  }, [id, initialFocusRef]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (isTop) {
      dialog.removeAttribute("inert");
      dialog.removeAttribute("aria-hidden");
    } else {
      dialog.setAttribute("inert", "");
      dialog.setAttribute("aria-hidden", "true");
    }
  }, [isTop, revision]);

  function onKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
    if (!isTop) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    const focusable = focusableElements(dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const index = focusable.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey
      ? (index <= 0 ? focusable.length - 1 : index - 1)
      : (index >= focusable.length - 1 ? 0 : index + 1);
    event.preventDefault();
    focusable[next]?.focus();
  }

  if (typeof document === "undefined") {
    return null;
  }
  return createPortal(
    <div className="modal-backdrop" role="presentation" data-modal-depth={modalStack.indexOf(id)}>
      <section ref={dialogRef} className={`modal-card ${className}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} onKeyDown={onKeyDown}>
        {children}
      </section>
    </div>,
    modalHost()
  );
}
