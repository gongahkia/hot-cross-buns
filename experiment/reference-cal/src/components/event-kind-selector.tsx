"use client";

import * as React from "react";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { withCalendarEntryKind } from "@/lib/calendar-entry";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CalendarEntryKind, CalendarEvent } from "./week-view-types";

interface EntryTypeOption {
  label: string;
  kind: CalendarEntryKind;
}

const ENTRY_TYPES: readonly EntryTypeOption[] = [
  { label: "Event", kind: "event" },
  { label: "Task", kind: "task" },
  { label: "Birthday", kind: "birthday" },
];

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
    ENTRY_TYPES.find((option) => option.kind === kind) ?? ENTRY_TYPES[0];
  const otherTypes = ENTRY_TYPES.filter((option) => option !== selected);

  function selectType(option: EntryTypeOption) {
    setOpen(false);
    if (option.kind !== kind)
      onEventChange?.(withCalendarEntryKind(event, option.kind));
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
        onKeyDown={(event) => event.stopPropagation()}
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
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
