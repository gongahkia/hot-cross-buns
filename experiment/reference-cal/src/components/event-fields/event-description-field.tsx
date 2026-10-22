"use client";

import * as React from "react";
import type { CalendarEvent } from "../week-view-types";
import { EventInlineTextField } from "./event-inline-text-field";

export function EventDescriptionField({
  event,
  onEventChange,
}: {
  event: CalendarEvent;
  onEventChange?: (event: CalendarEvent) => void;
}) {
  const id = React.useId();
  return (
    <div className="flex min-w-0 flex-col gap-1 px-4">
      <label htmlFor={id} className="text-xs text-foreground/65">
        Description
      </label>
      <EventInlineTextField
        id={id}
        label="Description"
        value={event.description}
        placeholder="Add a description…"
        multiline
        className="-mx-2 w-[calc(100%+16px)]"
        onChange={(description) => onEventChange?.({ ...event, description })}
      />
    </div>
  );
}
