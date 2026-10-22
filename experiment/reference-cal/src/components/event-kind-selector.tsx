"use client";

import * as React from "react";
import * as ReactDOM from "react-dom";
import { Check, ChevronDown, CircleHelp } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
  CalendarEntryKind,
  CalendarEvent,
  CalendarEventType,
} from "./week-view-types";

interface EntryTypeOption {
  label: string;
  kind: CalendarEntryKind;
  eventType?: CalendarEventType;
  tooltip?: string;
}

const ENTRY_TYPES: readonly EntryTypeOption[] = [
  { label: "Event", kind: "event", eventType: "event" },
  { label: "Task", kind: "task" },
  {
    label: "Focus time",
    kind: "event",
    eventType: "focus",
    tooltip:
      "Create a focus time event with the option to automatically decline meetings during this time. Available for work and school accounts.",
  },
  {
    label: "Out of office",
    kind: "event",
    eventType: "out-of-office",
    tooltip:
      "Create an out of office (OOO) event with the option to automatically decline meetings during this time. Available for work and school accounts.",
  },
  {
    label: "Birthday",
    kind: "event",
    eventType: "birthday",
    tooltip:
      "Create a birthday event to keep track of a person's upcoming birthdays. Birthdays from your Google Contacts may appear on a separate Birthday calendar.",
  },
];

function EventTypeHelpIcon({ tooltip }: { tooltip?: string }) {
  const [tooltipPos, setTooltipPos] = React.useState<{
    top: number;
    left: number;
  } | null>(null);

  if (!tooltip) {
    return null;
  }

  function handleMouseEnter(e: React.MouseEvent<HTMLSpanElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltipPos({ top: rect.top + rect.height / 2, left: rect.left });
  }

  function handleMouseLeave() {
    setTooltipPos(null);
  }

  return (
    <span
      className="ml-auto shrink-0 opacity-0 group-hover/item:opacity-100 transition-opacity"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <CircleHelp className="size-3.5 text-white" />
      {tooltipPos &&
        ReactDOM.createPortal(
          <div
            className="pointer-events-none fixed z-[100] max-w-[240px] rounded-sm bg-[#252525] border border-[#303030] px-2 py-1 text-xs text-white shadow-md"
            style={{
              top: tooltipPos.top,
              left: tooltipPos.left - 8,
              transform: "translate(-100%, -50%)",
            }}
          >
            {tooltip}
          </div>,
          document.body,
        )}
    </span>
  );
}

interface EventKindSelectorProps {
  event: CalendarEvent;
  onEventChange?: (event: CalendarEvent) => void;
}

/** The same selector is used by the anchored editor and the context panel. */
export function EventKindSelector({
  event,
  onEventChange,
}: EventKindSelectorProps) {
  const [open, setOpen] = React.useState(false);
  const [hoveredOther, setHoveredOther] = React.useState(false);
  const kind = event.kind ?? "event";
  const selected =
    ENTRY_TYPES.find(
      (option) =>
        option.kind === kind &&
        (kind === "task" || option.eventType === (event.eventType ?? "event")),
    ) ?? ENTRY_TYPES[0];
  const otherTypes = ENTRY_TYPES.filter((option) => option !== selected);

  function selectType(option: EntryTypeOption) {
    onEventChange?.({
      ...event,
      kind: option.kind,
      eventType: option.eventType,
    });
  }

  return (
    <DropdownMenu
      modal={false}
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) setHoveredOther(false);
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={!onEventChange}
          className={cn(
            "flex items-center text-xs font-medium rounded-sm border border-transparent px-2.5 py-1.5 -ml-2.5 gap-1.5 hover:border-[#E8E8E4] dark:hover:border-[#373737]",
            open ? "bg-[#252525] text-white" : "text-foreground",
          )}
        >
          {selected.label}
          <ChevronDown
            className={cn(
              "size-3.5",
              open ? "text-[#595959]" : "text-[#C7C5C1] dark:text-[#595959]",
            )}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="left"
        sideOffset={12}
        alignOffset={-4}
        className="min-w-[180px] bg-[#252525] border-[#303030]"
        onClick={(event) => event.stopPropagation()}
        onEscapeKeyDown={(event) => event.stopPropagation()}
        onMouseLeave={() => setHoveredOther(false)}
      >
        <DropdownMenuItem
          className={cn(
            "group/item text-xs text-white focus:bg-[#303030] focus:text-white",
            !hoveredOther && "bg-[#303030]",
          )}
          onSelect={() => selectType(selected)}
          onMouseEnter={() => setHoveredOther(false)}
        >
          <Check className="size-3.5" />
          <span className="flex-1">{selected.label}</span>
          <EventTypeHelpIcon tooltip={selected.tooltip} />
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-[#303030]" />
        {otherTypes.map((option) => (
          <DropdownMenuItem
            key={option.label}
            className="group/item text-xs text-white focus:bg-[#303030] focus:text-white pl-8"
            onSelect={() => selectType(option)}
            onMouseEnter={() => setHoveredOther(true)}
          >
            <span className="flex-1">{option.label}</span>
            <EventTypeHelpIcon tooltip={option.tooltip} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
