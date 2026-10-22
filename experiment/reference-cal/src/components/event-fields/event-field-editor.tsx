"use client";

import * as React from "react";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { EventEditorContext } from "../week-view-types";

/** Let an inline editor handle Escape before its Radix host dismisses. */
export function preventInlineEventEditorDismissal(event: KeyboardEvent) {
  if (
    event.target instanceof Element &&
    event.target.closest("[data-inline-event-editor]")
  )
    event.preventDefault();
}

interface EventFieldEditorProps {
  context: EventEditorContext;
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactNode;
  className?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  compact?: boolean;
}

/** Inline in a sidebar; an anchored child popover beside a calendar event. */
export function EventFieldEditor({
  context,
  label,
  open,
  onOpenChange,
  trigger,
  className,
  children,
  actions,
  compact = false,
}: EventFieldEditorProps) {
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const id = React.useId();
  // Anchor sub-editors to the event card's edge, so they never cover its fields.
  const [anchor, setAnchor] = React.useState<{
    getBoundingClientRect: () => DOMRect;
    contextElement: HTMLElement;
  } | null>(null);
  const virtualAnchor = React.useMemo(
    () => (anchor ? { current: anchor } : null),
    [anchor],
  );
  function changePopoverOpen(next: boolean) {
    if (next) {
      const trigger = triggerRef.current;
      const card = trigger?.closest<HTMLElement>(
        '[data-slot="popover-content"]:not([data-event-field-editor])',
      );
      if (trigger && card) {
        setAnchor({
          contextElement: card,
          getBoundingClientRect: () => {
            // Registering a custom Radix anchor can replace the trigger node.
            const field = (
              triggerRef.current ?? trigger
            ).getBoundingClientRect();
            const bounds = card.getBoundingClientRect();
            return new DOMRect(
              bounds.left,
              field.top,
              bounds.width,
              field.height,
            );
          },
        });
      }
    }
    onOpenChange(next);
  }
  const previouslyOpen = React.useRef(open);
  React.useEffect(() => {
    if (!open && previouslyOpen.current && context === "sidebar")
      triggerRef.current?.focus({ preventScroll: true });
    previouslyOpen.current = open;
  }, [open, context]);
  React.useEffect(() => {
    if (!open || context !== "sidebar") return;
    const frame = requestAnimationFrame(() =>
      contentRef.current
        ?.querySelector<HTMLElement>("input, button, [role=combobox]")
        ?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, [open, context]);

  const button = (
    <button
      ref={triggerRef}
      type="button"
      aria-label={label}
      aria-expanded={open}
      aria-controls={context === "sidebar" && open ? id : undefined}
      className={cn(
        "flex min-h-8 min-w-0 items-center gap-3 rounded-sm border border-transparent px-2 py-1.5 text-left text-xs outline-none hover:border-border hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30",
        className,
      )}
      onClick={context === "sidebar" ? () => onOpenChange(!open) : undefined}
    >
      {trigger}
    </button>
  );

  if (context === "popover") {
    return (
      <Popover open={open} onOpenChange={changePopoverOpen}>
        {virtualAnchor && <PopoverAnchor virtualRef={virtualAnchor} />}
        <div className="flex min-w-0 items-center">
          <PopoverTrigger asChild>{button}</PopoverTrigger>
          {actions}
        </div>
        <PopoverContent
          aria-label={label}
          data-event-field-editor="true"
          side="right"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="z-[60] w-72 max-w-[calc(100vw-24px)] max-h-[min(540px,80dvh)] overflow-y-auto p-3 text-xs motion-reduce:animate-none!"
          onClick={(event) => event.stopPropagation()}
          onEscapeKeyDown={(event) => event.stopPropagation()}
        >
          {children}
        </PopoverContent>
      </Popover>
    );
  }
  return (
    <div className={cn("min-w-0", compact && "contents")}>
      <div
        className={cn("flex min-w-0 items-center", compact && "row-start-1")}
      >
        {button}
        {actions}
      </div>
      {open && (
        <div
          ref={contentRef}
          id={id}
          role="region"
          aria-label={label}
          data-event-field-editor="true"
          className={cn(
            "mx-2 mt-1 rounded-sm border border-border bg-popover p-3 text-xs text-popover-foreground shadow-xs animate-in fade-in-0 slide-in-from-top-1 duration-150 motion-reduce:animate-none",
            compact && "col-span-3 col-start-1 -ml-6 mr-0",
          )}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || event.defaultPrevented) return;
            event.preventDefault();
            event.stopPropagation();
            onOpenChange(false);
            triggerRef.current?.focus({ preventScroll: true });
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function EventFieldActions({
  onCancel,
  disabled,
  saveLabel = "Save",
}: {
  onCancel: () => void;
  disabled?: boolean;
  saveLabel?: string;
}) {
  return (
    <div className="mt-3 flex items-center justify-end gap-1 border-t border-border pt-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 text-xs"
        onClick={onCancel}
      >
        Cancel
      </Button>
      <Button
        type="submit"
        size="sm"
        className="h-8 text-xs"
        disabled={disabled}
      >
        {saveLabel}
      </Button>
    </div>
  );
}

export const eventFieldInputClass =
  "h-8 w-full min-w-0 rounded-sm border border-input bg-background px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30";

export const eventInlineTextClass =
  "text-foreground placeholder:text-[#C7C5C1] dark:placeholder:text-[#595959] rounded-sm border border-transparent bg-transparent px-2 py-1.5 text-xs outline-none hover:border-[#E8E8E4] dark:hover:border-[#373737] focus:border-[#F5F5F5] focus:bg-[#F5F5F5] dark:focus:border-[#242424] dark:focus:bg-[#242424]";
