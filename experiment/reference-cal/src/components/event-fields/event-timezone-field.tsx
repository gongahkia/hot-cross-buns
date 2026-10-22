"use client";

import * as React from "react";
import { format } from "date-fns";
import { Check, Globe } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import {
  eventTimeZone,
  inTimeZone,
  supportedTimeZones,
  timeZoneLabel,
} from "@/lib/event-timezone";
import type { CalendarEvent, EventEditorContext } from "../week-view-types";
import { EventFieldActions, EventFieldEditor } from "./event-field-editor";

export function EventTimezoneField({
  event,
  context,
  compact = false,
  onEventChange,
}: {
  event: CalendarEvent;
  context: EventEditorContext;
  compact?: boolean;
  onEventChange?: (event: CalendarEvent) => void;
}) {
  const zone = eventTimeZone(event);
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(zone);
  const choices = React.useMemo(
    () =>
      open
        ? supportedTimeZones().map((value) => ({
            value,
            label: timeZoneLabel(value, event.start),
          }))
        : [],
    [event.start, open],
  );
  const label = timeZoneLabel(zone, event.start);
  function changeOpen(next: boolean) {
    if (next) setDraft(zone);
    setOpen(next);
  }
  return (
    <EventFieldEditor
      context={context}
      label="Edit time zone"
      open={open}
      onOpenChange={changeOpen}
      className={
        compact ? "-ml-2 text-muted-foreground" : "-mx-2 w-[calc(100%+16px)]"
      }
      trigger={
        compact ? (
          "Time zone"
        ) : (
          <>
            <Globe className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 text-foreground">{label}</span>
          </>
        )
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onEventChange?.({ ...event, timezone: draft });
          setOpen(false);
        }}
      >
        <h3 className="mb-2 font-medium">Event time zone</h3>
        <Command className="rounded-sm border border-border">
          <CommandInput
            aria-label="Search time zones"
            placeholder="Search time zones…"
            className="h-9 text-xs"
          />
          <CommandList className="max-h-44">
            <CommandEmpty className="px-3 py-4 text-xs">
              No time zones found.
            </CommandEmpty>
            {choices.map((choice) => (
              <CommandItem
                key={choice.value}
                value={choice.value}
                keywords={[choice.label, choice.value.replaceAll("_", " ")]}
                onSelect={() => setDraft(choice.value)}
                className="items-start gap-2 text-xs"
              >
                <Check
                  className={cn(
                    "mt-0.5 size-3 shrink-0",
                    draft !== choice.value && "invisible",
                  )}
                />
                <span className="min-w-0">
                  <span className="block">{choice.label}</span>
                  <span className="block text-[10px] text-muted-foreground">
                    {choice.value}
                  </span>
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
        <p className="mt-3 font-medium">
          {format(inTimeZone(event.start, draft), "EEE, MMM d · h:mm a")}
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          Changes how this event’s times are displayed. The event stays at the
          same moment.
        </p>
        <EventFieldActions onCancel={() => setOpen(false)} />
      </form>
    </EventFieldEditor>
  );
}
