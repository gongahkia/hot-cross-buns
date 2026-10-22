"use client";

import * as React from "react";
import { MapPin } from "lucide-react";
import type { CalendarEvent, EventEditorContext } from "../week-view-types";
import {
  EventFieldActions,
  EventFieldEditor,
  eventFieldInputClass,
} from "./event-field-editor";

export function EventLocationField({
  event,
  context,
  onEventChange,
}: {
  event: CalendarEvent;
  context: EventEditorContext;
  onEventChange?: (event: CalendarEvent) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState(event.location ?? "");
  const id = React.useId();
  function changeOpen(next: boolean) {
    if (next) setValue(event.location ?? "");
    setOpen(next);
  }
  return (
    <EventFieldEditor
      context={context}
      label="Edit location"
      open={open}
      onOpenChange={changeOpen}
      className="-mx-2 w-[calc(100%+16px)]"
      trigger={
        <>
          <MapPin className="size-4 shrink-0 text-foreground/65" />
          <span className="text-foreground/65">Location</span>
          {event.location && (
            <span className="min-w-0 break-words text-foreground">
              {event.location}
            </span>
          )}
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onEventChange?.({ ...event, location: value.trim() });
          setOpen(false);
        }}
      >
        <label htmlFor={id} className="mb-2 block font-medium">
          Location
        </label>
        <input
          id={id}
          value={value}
          maxLength={1000}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Address, meeting room, or link"
          className={eventFieldInputClass}
          autoComplete="off"
        />
        <p className="mt-2 text-[11px] text-foreground/65">
          Enter a place or address. Clear the field to remove it.
        </p>
        <EventFieldActions onCancel={() => setOpen(false)} />
      </form>
    </EventFieldEditor>
  );
}
