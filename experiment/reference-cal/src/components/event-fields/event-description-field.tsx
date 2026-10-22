"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { CalendarEvent } from "../week-view-types";
import { EventFieldActions, eventFieldInputClass } from "./event-field-editor";

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
  const previouslyEditing = React.useRef(false);
  const id = React.useId();

  React.useEffect(() => {
    if (editing) textareaRef.current?.focus({ preventScroll: true });
    else if (previouslyEditing.current)
      triggerRef.current?.focus({ preventScroll: true });
    previouslyEditing.current = editing;
  }, [editing]);

  React.useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!editing || !textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [editing, draft]);

  return (
    <div className="flex min-w-0 flex-col gap-1 px-4">
      <label htmlFor={id} className="text-xs text-foreground/65">
        Description
      </label>
      {editing ? (
        <form
          aria-label="Edit description"
          data-inline-event-editor="description"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft !== (event.description ?? ""))
              onEventChange?.({ ...event, description: draft });
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setEditing(false);
            } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.requestSubmit();
            }
          }}
        >
          <textarea
            ref={textareaRef}
            id={id}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a description…"
            className={cn(
              eventFieldInputClass,
              "block h-auto min-h-24 max-h-[40dvh] resize-none overflow-y-auto py-2 leading-relaxed [overflow-wrap:anywhere]",
            )}
          />
          <EventFieldActions onCancel={() => setEditing(false)} />
        </form>
      ) : (
        <button
          ref={triggerRef}
          id={id}
          type="button"
          aria-label="Edit description"
          onClick={() => {
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
