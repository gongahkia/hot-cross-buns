"use client";

import * as React from "react";
import { MapPin } from "lucide-react";
import type { CalendarEvent } from "../week-view-types";
import { EventInlineTextField } from "./event-inline-text-field";

export function EventLocationField({
  event,
  onEventChange,
}: {
  event: CalendarEvent;
  onEventChange?: (event: CalendarEvent) => void;
}) {
  const id = React.useId();
  return (
    <div className="flex min-w-0 items-start gap-3">
      <MapPin className="mt-2 size-4 shrink-0 text-foreground/65" />
      <label
        htmlFor={id}
        className="flex min-h-8 shrink-0 items-center text-xs text-foreground/65"
      >
        Location
      </label>
      <EventInlineTextField
        id={id}
        label="Location"
        value={event.location}
        placeholder="Add a location…"
        maxLength={1000}
        trimOnBlur
        className="-mx-2 min-w-0 flex-1"
        onChange={(location) => onEventChange?.({ ...event, location })}
      />
    </div>
  );
}
