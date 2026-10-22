import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import type { InspectorItem } from "./InspectorContext";
import { ArrowLeft, PanelRight } from "lucide-react";
import { usePanePreference } from "../../features/shell/panePreferences";
import { Badge, Button, IconButton, cx } from "../primitives";
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

export function InspectorShell({ documentMode = false }: { documentMode?: boolean }): JSX.Element | null {
  const { current } = useInspector();
  return <AnimatePresence initial={false}>{current ? <InspectorPanel key="context-panel" current={current} documentMode={documentMode} /> : null}</AnimatePresence>;
}

function InspectorPanel({ current, documentMode }: { current: InspectorItem; documentMode: boolean }): JSX.Element {
  const { close, isOpen, backToSearch } = useInspector();
  const present = useIsPresent();
  const [opened, setOpened] = useState(false);
  const reduceMotion = useReducedMotion() || document.documentElement.dataset.animations === "disabled";
  const dirty = useSyncExternalStore(current?.dirtyState?.subscribe ?? subscribeStaticDirty, current?.dirtyState?.getSnapshot ?? (current?.dirty ? getStaticDirtyTrue : getStaticDirty));
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = usePanePreference("inspector.width", 380);
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const narrow = viewportWidth < (documentMode ? 840 : 1050);
  const resolvedWidth = Math.min(Math.max(320, width), 560, viewportWidth - 32);
  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

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
    if (node.contains(document.activeElement) || document.activeElement?.closest(".inspector-item-menu")) return;
    const focusable = node.querySelector<HTMLElement>('input:not([disabled]),textarea:not([disabled]),select:not([disabled])') ??
      node.querySelector<HTMLElement>('button:not([disabled]),[tabindex]:not([tabindex="-1"]),a[href]');
    (focusable ?? node).focus();
  }, [isOpen, current?.kind, current?.id]);

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
      if (!node || (dialogs.length > 0 && dialogs[dialogs.length - 1] !== node) || (focusedDialog && focusedDialog !== node)) return;
      event.preventDefault();
      requestClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, requestClose]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (!narrow || event.key !== "Tab" || (event.target as HTMLElement).closest('[role="dialog"]') !== containerRef.current) return;
    const controls = [...(containerRef.current?.querySelectorAll<HTMLElement>('input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])') ?? [])]
      .filter((element) => element.getClientRects().length > 0);
    const first = controls[0], last = controls.at(-1);
    if (!first || !last) { event.preventDefault(); containerRef.current?.focus(); }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }


  const showHeader = !current.hideHeader;

  return (
    <>
      {narrow ? <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0 : .22 }}
        aria-hidden="true"
        className="fixed inset-0 z-40 bg-black/30"
        onClick={requestClose}
      /> : null}
      <motion.section
        initial={documentMode ? { opacity: 0 } : narrow ? { x: "100%" } : { width: 0, opacity: 0 }}
        animate={documentMode && !narrow ? { opacity: 1 } : { width: resolvedWidth, x: 0, opacity: 1 }}
        exit={narrow ? { x: "100%", transition: { duration: reduceMotion ? 0 : .24 } } : { width: 0, opacity: 0, transition: { duration: reduceMotion ? 0 : .24 } }}
        transition={{ duration: reduceMotion || opened ? 0 : .24, ease: [.22, 1, .36, 1] }}
        onAnimationComplete={() => setOpened(true)}
        inert={!present}
        data-state={present ? "open" : "closed"}
        aria-label={showHeader ? undefined : current.title}
        aria-labelledby={showHeader ? titleId : undefined}
        aria-modal={narrow}
        className={cx(
          "inspector-panel relative flex min-h-0 shrink-0 flex-col border-l border-border bg-bg-primary text-text-primary",
          narrow ? "fixed inset-y-0 right-0 z-50 shadow-2xl" : "h-full"
        )}
        style={documentMode && !narrow ? { flex: "1 1 0", minWidth: 320 } : { width: resolvedWidth }}
        data-document-editor={documentMode}
        data-inspector-layout={narrow ? "sheet" : "docked"}
        data-inspector-kind={current.kind}
        data-inspector-id={current.id}
        data-testid="inspector-shell"
        onKeyDown={handleKeyDown}
        ref={containerRef}
        role="dialog"
        tabIndex={-1}
      >
        {!documentMode && !narrow ? <div
          aria-label="Resize details panel"
          aria-orientation="vertical"
          aria-valuemin={320}
          aria-valuemax={560}
          aria-valuenow={resolvedWidth}
          className="absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize hover:bg-accent/30 focus-visible:bg-accent/30"
          role="separator"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              setWidth(Math.max(320, Math.min(560, resolvedWidth + (event.key === "ArrowLeft" ? 24 : -24))));
            }
          }}
          onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setWidth(Math.max(320, Math.min(560, viewportWidth - event.clientX))); }}
          onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
        /> : null}
        {backToSearch ? <button className="inspector-search-back" onClick={backToSearch}><ArrowLeft size={16} />Search</button> : null}
        {showHeader ? (
          <header className="inspector-header flex min-h-12 items-center gap-2 px-4 py-2">
            <h2 className={current.toolbar ? "sr-only" : "min-w-0 flex-1 text-sm font-semibold"} id={titleId}>{current.title}</h2>
            {current.toolbar ?? <InspectorDirtyBadge dirty={current.dirty} dirtyState={current.dirtyState} />}
            <IconButton data-testid="inspector-close" icon={PanelRight} label="Close inspector" onClick={requestClose} size="sm" variant="ghost" />
          </header>
        ) : null}

        <div className="inspector-editor min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pb-4" data-testid="inspector-body"
          onBlurCapture={(event) => {
            if (!current.onSave || !(event.target instanceof HTMLElement)) return;
            if (!event.target.matches('input,textarea,select,[contenteditable="true"]') && !event.target.closest(".markdown-editor")) return;
            const editor = event.target.closest(".markdown-editor");
            if (editor && event.relatedTarget instanceof Node && editor.contains(event.relatedTarget)) return;
            queueMicrotask(() => { void current.onSave?.(); });
          }}
          onChangeCapture={(event) => {
            if (event.target instanceof HTMLElement && event.target.matches('select,input[type="checkbox"],input[type="radio"]') && !event.target.closest(".markdown-editor")) queueMicrotask(() => { void current.onSave?.(); });
          }}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("button") && !(event.target as HTMLElement).closest(".markdown-editor") && !(event.target as HTMLElement).closest('[role="dialog"]:not([data-testid="inspector-shell"])')) queueMicrotask(() => { void current.onSave?.(); });
          }}
        >
          {current.body}
        </div>
          {current.onSave ? <div className="inspector-save-status" role={current.saveError ? "alert" : "status"}>
            <span>{current.saveError ?? (current.saving ? "Saving…" : dirty || current.id === "new" || current.id.startsWith("note-draft-") ? "Changes save when you leave a field" : "Saved")}</span>
            {current.saveError ? <><Button onClick={() => void current.onSave?.()} size="sm" variant="ghost">Retry</Button><Button onClick={() => void current.onDiscard?.()} size="sm" variant="ghost">Discard edits</Button></> : null}
          </div> : null}

        {current.actions ? (
          <footer
            className="flex min-h-14 items-center justify-end gap-2 border-t border-border px-4"
            data-testid="inspector-actions"
          >
            {current.actions}
          </footer>
        ) : null}
      </motion.section>
    </>
  );
}
