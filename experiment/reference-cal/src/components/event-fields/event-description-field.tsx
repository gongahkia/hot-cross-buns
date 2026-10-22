"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { CalendarEvent } from "../week-view-types";
import { eventFieldInputClass } from "./event-field-editor";

/** Edit in place in both the event popover and the context sidebar. */
export function EventDescriptionField({
  event,
  onEventChange,
}: {
  event: CalendarEvent;
  onEventChange?: (event: CalendarEvent) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const originalDescription = React.useRef(event.description);
  const restoreFocus = React.useRef(false);
  const blurFrame = React.useRef<number | null>(null);
  const id = React.useId();

  React.useEffect(() => {
    if (editing) textareaRef.current?.focus({ preventScroll: true });
    else if (restoreFocus.current) {
      restoreFocus.current = false;
      triggerRef.current?.focus({ preventScroll: true });
    }
  }, [editing]);

  React.useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!editing || !textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [editing, draft]);

  React.useEffect(
    () => () => {
      if (blurFrame.current !== null) cancelAnimationFrame(blurFrame.current);
    },
    [],
  );

  return (
    <div className="flex min-w-0 flex-col gap-1 px-4">
      <label htmlFor={id} className="text-xs text-foreground/65">
        Description
      </label>
      {editing ? (
        <textarea
          ref={textareaRef}
          id={id}
          data-inline-event-editor="description"
          value={draft}
          onChange={(e) => {
            const description = e.target.value;
            setDraft(description);
            // Like the title, keep edits through outside clicks and host changes.
            onEventChange?.({ ...event, description });
          }}
          onBlur={() => {
            if (blurFrame.current !== null)
              cancelAnimationFrame(blurFrame.current);
            // Let a modal move focus before removing its previously focused field.
            blurFrame.current = requestAnimationFrame(() => {
              blurFrame.current = null;
              if (
                restoreFocus.current ||
                document.activeElement !== textareaRef.current
              )
                setEditing(false);
            });
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              if (draft !== (originalDescription.current ?? ""))
                onEventChange?.({
                  ...event,
                  description: originalDescription.current,
                });
              restoreFocus.current = true;
              e.currentTarget.blur();
            } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              e.stopPropagation();
              restoreFocus.current = true;
              e.currentTarget.blur();
            }
          }}
          placeholder="Add a description…"
          className={cn(
            eventFieldInputClass,
            "block h-auto min-h-24 max-h-[40dvh] resize-none overflow-y-auto py-2 leading-relaxed [overflow-wrap:anywhere]",
          )}
        />
      ) : (
        <button
          ref={triggerRef}
          id={id}
          type="button"
          aria-label="Edit description"
          onClick={() => {
            originalDescription.current = event.description;
            restoreFocus.current = false;
            setDraft(event.description ?? "");
            setEditing(true);
          }}
          className={cn(
            "-mx-2 min-h-8 min-w-0 rounded-sm border border-transparent px-2 py-1.5 text-left text-xs whitespace-pre-wrap outline-none [overflow-wrap:anywhere] hover:border-border hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30",
            event.description ? "text-foreground" : "text-foreground/65",
          )}
        >
          {event.description || "Add a description…"}
        </button>
      )}
    </div>
  );
}
