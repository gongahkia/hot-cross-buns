import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { X } from "lucide-react";
import { Badge, IconButton, cx } from "../primitives";
import { useInspector } from "./InspectorContext";

const titleId = "inspector-title";
const subscribeStaticDirty = (): (() => void) => () => undefined;
const getStaticDirty = (): boolean => false;
const getStaticDirtyTrue = (): boolean => true;

function InspectorDirtyBadge({
  dirty,
  dirtyState
}: {
  dirty?: boolean;
  dirtyState?: { getSnapshot: () => boolean; subscribe: (listener: () => void) => () => void };
}): JSX.Element | null {
  const resolvedDirty = useSyncExternalStore(
    dirtyState?.subscribe ?? subscribeStaticDirty,
    dirtyState?.getSnapshot ?? (dirty ? getStaticDirtyTrue : getStaticDirty),
    dirtyState?.getSnapshot ?? (dirty ? getStaticDirtyTrue : getStaticDirty)
  );

  return resolvedDirty ? <Badge tone="warning">Unsaved</Badge> : null;
}

export function InspectorShell(): JSX.Element | null {
  const { current, close, isOpen } = useInspector();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }

    const node = containerRef.current;
    if (!node) {
      return;
    }

    // Respect an editor's own autofocus and complete the fallback handoff
    // before paint, so immediate typing/Escape cannot land behind the dialog.
    if (node.contains(document.activeElement)) return;
    const focusable = node.querySelector<HTMLElement>('input:not([disabled]),textarea:not([disabled]),select:not([disabled])') ??
      node.querySelector<HTMLElement>('button:not([disabled]),[tabindex]:not([tabindex="-1"]),a[href]');
    (focusable ?? node).focus();
  }, [isOpen, current?.kind, current?.id, current?.body]);

  const requestClose = useCallback(() => {
    void close();
  }, [close]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const node = containerRef.current;
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      const focusedDialog = document.activeElement?.closest('[role="dialog"][aria-modal="true"]');
      if (!node || dialogs[dialogs.length - 1] !== node || (focusedDialog && focusedDialog !== node)) return;
      event.preventDefault();
      requestClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, requestClose]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "Tab" || (event.target as HTMLElement).closest('[role="dialog"]') !== containerRef.current) return;
    const controls = [...(containerRef.current?.querySelectorAll<HTMLElement>('input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])') ?? [])]
      .filter((element) => element.getClientRects().length > 0);
    const first = controls[0], last = controls.at(-1);
    if (!first || !last) { event.preventDefault(); containerRef.current?.focus(); }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  if (!current) {
    return null;
  }

  const showHeader = !current.hideHeader;

  return (
    <>
      <div
        aria-hidden="true"
        className="fixed inset-0 z-40 bg-bg-primary/80"
        onClick={requestClose}
      />
      <section
        aria-label={showHeader ? undefined : current.title}
        aria-labelledby={showHeader ? titleId : undefined}
        aria-modal="true"
        className={cx(
          "hcb-raised fixed left-1/2 top-1/2 z-50 flex max-h-[min(820px,calc(100dvh-32px))] w-[min(760px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-hcbLg border border-border bg-bg-secondary"
        )}
        data-inspector-kind={current.kind}
        data-inspector-id={current.id}
        data-testid="inspector-shell"
        onKeyDown={handleKeyDown}
        ref={containerRef}
        role="dialog"
        tabIndex={-1}
      >
        {showHeader ? (
          <header className="flex min-h-14 items-start justify-between gap-3 border-b border-border px-4 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2
                  className="hcb-heading min-w-0 whitespace-normal break-words text-[var(--text-lg)] font-semibold leading-snug text-text-primary"
                  id={titleId}
                >
                  {current.title}
                </h2>
                <InspectorDirtyBadge dirty={current.dirty} dirtyState={current.dirtyState} />
              </div>
              {current.subtitle ? (
                <p className="hcb-copy mt-0.5 whitespace-normal break-words text-[var(--text-xs)] leading-snug text-text-muted">{current.subtitle}</p>
              ) : null}
            </div>
            <IconButton
              data-testid="inspector-close"
              icon={X}
              label="Close inspector"
              onClick={requestClose}
              variant="ghost"
            />
          </header>
        ) : null}

        <div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-3" data-testid="inspector-body">
          {current.body}
        </div>

        {current.actions ? (
          <footer
            className="flex min-h-14 items-center justify-end gap-2 border-t border-border px-4"
            data-testid="inspector-actions"
          >
            {current.actions}
          </footer>
        ) : null}
      </section>
    </>
  );
}
