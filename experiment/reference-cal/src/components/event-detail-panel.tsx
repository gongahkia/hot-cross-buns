"use client";

import * as React from "react";
import * as ReactDOM from "react-dom";
import {
  addDays,
  differenceInCalendarDays,
  differenceInMinutes,
  format,
  parse,
} from "date-fns";
import {
  Bell,
  Check,
  ChevronDown,
  CircleHelp,
  Clock,
  Copy,
  MoreHorizontal,
  SquareDashed,
  TabletSmartphone,
  Trash2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import type {
  CalendarEvent,
  EventColor,
  EventEditorContext,
} from "./week-view-types";
import { EventLocationField } from "./event-fields/event-location-field";
import { EventDescriptionField } from "./event-fields/event-description-field";
import { eventInlineTextClass } from "./event-fields/event-field-editor";
import { EventTimezoneField } from "./event-fields/event-timezone-field";
import { EventRecurrenceField } from "./event-fields/event-recurrence-field";
import {
  allDayDates,
  applyZonedTime,
  eventTimeZone,
  inTimeZone,
  shiftZonedDays,
} from "@/lib/event-timezone";

interface EventDetailPanelProps {
  editorContext?: EventEditorContext;
  event: CalendarEvent;
  onEventChange?: (event: CalendarEvent) => void;
  onPrevWeek?: () => void;
  onNextWeek?: () => void;
  /** Extra action buttons rendered in the header row (after the "..." menu). */
  headerActions?: React.ReactNode;
  /** When true, focuses and selects the title input once (e.g. for a just-created event). */
  autoFocusTitle?: boolean;
  /** Called after the title input was auto-focused, so the request is not repeated. */
  onTitleAutoFocused?: () => void;
}

const colorDotClass: Record<EventColor, string> = {
  red: "bg-event-red-border",
  orange: "bg-event-orange-border",
  yellow: "bg-event-yellow-border",
  green: "bg-event-green-border",
  blue: "bg-event-blue-border",
  purple: "bg-event-purple-border",
  gray: "bg-event-gray-border",
};

function formatDuration(start: Date, end: Date): string {
  const totalMinutes = differenceInMinutes(end, start);

  if (totalMinutes < 60) {
    return `${totalMinutes}min`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (minutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${minutes}min`;
}

function formatTimeDisplay(date: Date): string {
  const minutes = date.getMinutes();
  if (minutes === 0) {
    return format(date, "h a");
  }
  return format(date, "h:mm a");
}

interface ParsedTime {
  hours: number;
  minutes: number;
}

/**
 * Parses a user-typed time string into hours and minutes.
 * Accepts formats: "3 PM", "3:30 PM", "15:00", "3pm", "330pm", "3:30pm".
 * Returns null if the input cannot be parsed.
 */
function parseTimeInput(input: string): ParsedTime | null {
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length === 0) {
    return null;
  }

  const isPM = /pm$/.test(trimmed);
  const isAM = /am$/.test(trimmed);
  const stripped = trimmed.replace(/\s*(am|pm)\s*$/, "").trim();

  if (stripped.length === 0) {
    return null;
  }

  let hours: number;
  let minutes: number;

  if (stripped.includes(":")) {
    const parts = stripped.split(":");
    if (parts.length !== 2) {
      return null;
    }
    hours = Number.parseInt(parts[0], 10);
    minutes = Number.parseInt(parts[1], 10);
  } else {
    const num = Number.parseInt(stripped, 10);
    if (Number.isNaN(num)) {
      return null;
    }
    if (stripped.length > 2 && num > 99) {
      // e.g., "330" → 3:30, "1230" → 12:30
      minutes = num % 100;
      hours = Math.floor(num / 100);
    } else {
      hours = num;
      minutes = 0;
    }
  }

  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }

  // Apply AM/PM conversion
  if (isPM && hours < 12) {
    hours += 12;
  }
  if (isAM && hours === 12) {
    hours = 0;
  }

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return { hours, minutes };
}

function formatDateDisplay(date: Date): string {
  return format(date, "EEE MMM d");
}

/**
 * Parses a user-typed date string into a Date.
 * Strips any leading weekday name and parses "MMM d" (e.g., "Mar 11").
 * Uses the reference date's year. Returns null if unparseable.
 */
function parseDateInput(input: string, referenceDate: Date): Date | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }

  // Strip optional leading weekday (e.g., "Tue ", "Wed ")
  const withoutWeekday = trimmed.replace(
    /^(sun|mon|tue|wed|thu|fri|sat)\s+/i,
    "",
  );
  if (withoutWeekday.length === 0) {
    return null;
  }

  const parsed = parse(withoutWeekday, "MMM d", referenceDate);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function formatVisibility(
  visibility?: "default" | "public" | "private",
): string {
  if (visibility === "public") {
    return "Public";
  }
  if (visibility === "private") {
    return "Private";
  }
  return "Default visibility";
}

const EVENT_TYPES = [
  "Event",
  "Focus time",
  "Out of office",
  "Birthday",
] as const;
type EventType = (typeof EVENT_TYPES)[number];

const EVENT_TYPE_TOOLTIPS: Partial<Record<EventType, string>> = {
  "Focus time":
    "Create a focus time event with the option to automatically decline meetings during this time. Available for work and school accounts.",
  "Out of office":
    "Create an out of office (OOO) event with the option to automatically decline meetings during this time. Available for work and school accounts.",
  Birthday:
    "Create a birthday event to keep track of a person's upcoming birthdays. Birthdays from your Google Contacts may appear on a separate Birthday calendar.",
};

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

export function EventDetailPanel({
  editorContext = "sidebar",
  event,
  onEventChange,
  onPrevWeek,
  onNextWeek,
  headerActions,
  autoFocusTitle,
  onTitleAutoFocused,
}: EventDetailPanelProps) {
  const zone = eventTimeZone(event);
  const editStart = React.useMemo(
    () => (event.isAllDay ? event.start : inTimeZone(event.start, zone)),
    [event.start, event.isAllDay, zone],
  );
  const editEnd = React.useMemo(
    () => (event.isAllDay ? event.end : inTimeZone(event.end, zone)),
    [event.end, event.isAllDay, zone],
  );
  const [timeError, setTimeError] = React.useState<string | null>(null);
  const color = event.color ?? "blue";
  const [eventType, setEventType] = React.useState<EventType>("Event");
  const [eventDropdownOpen, setEventDropdownOpen] = React.useState(false);
  const [hoveredOther, setHoveredOther] = React.useState(false);
  /** Whether the compact "All-day / Time zone / Repeat" row is expanded into individual rows. */
  const [optionsExpanded, setOptionsExpanded] = React.useState(false);
  const [titleValue, setTitleValue] = React.useState(event.title);
  const titleRef = React.useRef<HTMLInputElement>(null);
  const escapePressedRef = React.useRef(false);
  /** Stores the title when the input gains focus, used to restore on Escape. */
  const titleOnFocusRef = React.useRef(event.title);

  // --- All-day toggle handler ---
  /**
   * Stores the original hours/minutes before toggling to all-day.
   * When toggling off, these are applied to the current (possibly resized) dates.
   */
  const savedTimeOfDayRef = React.useRef<{
    startHours: number;
    startMinutes: number;
    endHours: number;
    endMinutes: number;
  } | null>(null);

  React.useEffect(() => {
    setTimeError(null);
  }, [zone]);

  React.useEffect(() => {
    setTitleValue(event.title);
  }, [event.title]);

  // Reset expanded options when switching to a different event
  React.useEffect(() => {
    setOptionsExpanded(false);
    setTimeError(null);
    savedTimeOfDayRef.current = null;
  }, [event.id]);

  // Focus + select the title on request so a new event can be named right away.
  // Deferred a frame so a popover host has been positioned before focusing.
  React.useEffect(() => {
    if (!autoFocusTitle) return;
    const frame = requestAnimationFrame(() => {
      titleRef.current?.focus({ preventScroll: true });
      titleRef.current?.select();
      onTitleAutoFocused?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [autoFocusTitle, onTitleAutoFocused]);

  const handleTitleChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      setTitleValue(next);
      onEventChange?.({ ...event, title: next });
    },
    [event, onEventChange],
  );

  const handleTitleFocus = React.useCallback(() => {
    titleOnFocusRef.current = event.title;
  }, [event.title]);

  const commitTitle = React.useCallback(() => {
    if (escapePressedRef.current) {
      escapePressedRef.current = false;
      return;
    }
    const trimmed = titleValue.trim();
    if (trimmed === titleValue) {
      return;
    }
    onEventChange?.({ ...event, title: trimmed });
  }, [titleValue, event, onEventChange]);

  const handleTitleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        titleRef.current?.blur();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        escapePressedRef.current = true;
        const original = titleOnFocusRef.current;
        setTitleValue(original);
        onEventChange?.({ ...event, title: original });
        titleRef.current?.blur();
      }
    },
    [event, onEventChange],
  );

  // --- Start time input state & handlers ---
  const [startTimeValue, setStartTimeValue] = React.useState(() =>
    formatTimeDisplay(editStart),
  );
  const startTimeRef = React.useRef<HTMLInputElement>(null);
  const startTimeEscapePressedRef = React.useRef(false);
  const startTimeOnFocusRef = React.useRef(formatTimeDisplay(editStart));

  React.useEffect(() => {
    setStartTimeValue(formatTimeDisplay(editStart));
  }, [editStart]);

  const handleStartTimeChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setStartTimeValue(e.target.value);
    },
    [],
  );

  const handleStartTimeFocus = React.useCallback(() => {
    startTimeOnFocusRef.current = formatTimeDisplay(editStart);
    requestAnimationFrame(() => {
      startTimeRef.current?.select();
    });
  }, [editStart]);

  const commitStartTime = React.useCallback(() => {
    if (startTimeEscapePressedRef.current) {
      startTimeEscapePressedRef.current = false;
      return;
    }
    const parsed = parseTimeInput(startTimeValue);
    if (!parsed) {
      setStartTimeValue(startTimeOnFocusRef.current);
      return;
    }
    const newStart = applyZonedTime(
      event.start,
      parsed.hours,
      parsed.minutes,
      zone,
    );
    if (!newStart) {
      setTimeError(
        "This time does not exist in the event’s time zone because the clocks move forward.",
      );
      return;
    }
    if (newStart.getTime() >= event.end.getTime()) {
      setStartTimeValue(startTimeOnFocusRef.current);
      return;
    }
    setTimeError(null);
    setStartTimeValue(formatTimeDisplay(inTimeZone(newStart, zone)));
    onEventChange?.({ ...event, start: newStart });
  }, [startTimeValue, event, onEventChange, zone]);

  const handleStartTimeKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        startTimeRef.current?.blur();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        startTimeEscapePressedRef.current = true;
        setTimeError(null);
        setStartTimeValue(startTimeOnFocusRef.current);
        startTimeRef.current?.blur();
      }
    },
    [],
  );

  // --- End time input state & handlers ---
  const [endTimeValue, setEndTimeValue] = React.useState(() =>
    formatTimeDisplay(editEnd),
  );
  const endTimeRef = React.useRef<HTMLInputElement>(null);
  const endTimeEscapePressedRef = React.useRef(false);
  const endTimeOnFocusRef = React.useRef(formatTimeDisplay(editEnd));

  React.useEffect(() => {
    setEndTimeValue(formatTimeDisplay(editEnd));
  }, [editEnd]);

  const handleEndTimeChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setEndTimeValue(e.target.value);
    },
    [],
  );

  const handleEndTimeFocus = React.useCallback(() => {
    endTimeOnFocusRef.current = formatTimeDisplay(editEnd);
    requestAnimationFrame(() => {
      endTimeRef.current?.select();
    });
  }, [editEnd]);

  const commitEndTime = React.useCallback(() => {
    if (endTimeEscapePressedRef.current) {
      endTimeEscapePressedRef.current = false;
      return;
    }
    const parsed = parseTimeInput(endTimeValue);
    if (!parsed) {
      setEndTimeValue(endTimeOnFocusRef.current);
      return;
    }
    const newEnd = applyZonedTime(
      event.end,
      parsed.hours,
      parsed.minutes,
      zone,
    );
    if (!newEnd) {
      setTimeError(
        "This time does not exist in the event’s time zone because the clocks move forward.",
      );
      return;
    }
    if (newEnd.getTime() <= event.start.getTime()) {
      setEndTimeValue(endTimeOnFocusRef.current);
      return;
    }
    setTimeError(null);
    setEndTimeValue(formatTimeDisplay(inTimeZone(newEnd, zone)));
    onEventChange?.({ ...event, end: newEnd });
  }, [endTimeValue, event, onEventChange, zone]);

  const handleEndTimeKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        endTimeRef.current?.blur();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        endTimeEscapePressedRef.current = true;
        setTimeError(null);
        setEndTimeValue(endTimeOnFocusRef.current);
        endTimeRef.current?.blur();
      }
    },
    [],
  );

  // --- Date input state & handlers ---
  const [dateValue, setDateValue] = React.useState(() =>
    formatDateDisplay(editStart),
  );
  const dateRef = React.useRef<HTMLInputElement>(null);
  const dateEscapePressedRef = React.useRef(false);
  const dateOnFocusRef = React.useRef(formatDateDisplay(editStart));

  React.useEffect(() => {
    setDateValue(formatDateDisplay(editStart));
  }, [editStart]);

  const handleDateChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setDateValue(e.target.value);
    },
    [],
  );

  const handleDateFocus = React.useCallback(() => {
    dateOnFocusRef.current = formatDateDisplay(editStart);
    requestAnimationFrame(() => {
      dateRef.current?.select();
    });
  }, [editStart]);

  const commitDate = React.useCallback(() => {
    if (dateEscapePressedRef.current) {
      dateEscapePressedRef.current = false;
      return;
    }
    const parsed = parseDateInput(dateValue, editStart);
    if (!parsed) {
      setDateValue(dateOnFocusRef.current);
      return;
    }
    const dayDiff = differenceInCalendarDays(parsed, editStart);
    if (dayDiff === 0) {
      setDateValue(formatDateDisplay(editStart));
      return;
    }
    const newStart = shiftZonedDays(event.start, dayDiff, zone);
    const newEnd = shiftZonedDays(event.end, dayDiff, zone);
    if (!newStart || !newEnd) {
      setTimeError(
        "That date would put the event in a skipped daylight-saving time.",
      );
      return;
    }
    setTimeError(null);
    setDateValue(formatDateDisplay(inTimeZone(newStart, zone)));
    onEventChange?.({ ...event, start: newStart, end: newEnd });
  }, [dateValue, event, onEventChange, zone, editStart]);

  const handleDateKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        dateRef.current?.blur();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        dateEscapePressedRef.current = true;
        setTimeError(null);
        setDateValue(dateOnFocusRef.current);
        dateRef.current?.blur();
      }
    },
    [],
  );

  // --- End date input state & handlers (shown only for all-day events) ---
  const [endDateValue, setEndDateValue] = React.useState(() =>
    formatDateDisplay(editEnd),
  );
  const endDateRef = React.useRef<HTMLInputElement>(null);
  const endDateEscapePressedRef = React.useRef(false);
  const endDateOnFocusRef = React.useRef(formatDateDisplay(editEnd));

  React.useEffect(() => {
    setEndDateValue(formatDateDisplay(editEnd));
  }, [editEnd]);

  const handleEndDateChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setEndDateValue(e.target.value);
    },
    [],
  );

  const handleEndDateFocus = React.useCallback(() => {
    endDateOnFocusRef.current = formatDateDisplay(editEnd);
    requestAnimationFrame(() => {
      endDateRef.current?.select();
    });
  }, [editEnd]);

  const commitEndDate = React.useCallback(() => {
    if (endDateEscapePressedRef.current) {
      endDateEscapePressedRef.current = false;
      return;
    }
    const parsed = parseDateInput(endDateValue, editEnd);
    if (!parsed) {
      setEndDateValue(endDateOnFocusRef.current);
      return;
    }
    const dayDiff = differenceInCalendarDays(parsed, editEnd);
    if (dayDiff === 0) {
      setEndDateValue(formatDateDisplay(editEnd));
      return;
    }
    const newEnd = addDays(event.end, dayDiff);
    if (newEnd.getTime() < event.start.getTime()) {
      setEndDateValue(endDateOnFocusRef.current);
      return;
    }
    setEndDateValue(formatDateDisplay(newEnd));
    onEventChange?.({ ...event, end: newEnd });
  }, [endDateValue, event, onEventChange, editEnd]);

  const handleEndDateKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        endDateRef.current?.blur();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        endDateEscapePressedRef.current = true;
        setTimeError(null);
        setEndDateValue(endDateOnFocusRef.current);
        endDateRef.current?.blur();
      }
    },
    [],
  );

  const handleAllDayToggle = React.useCallback(
    (checked: boolean) => {
      setTimeError(null);
      if (checked) {
        savedTimeOfDayRef.current = {
          startHours: editStart.getHours(),
          startMinutes: editStart.getMinutes(),
          endHours: editEnd.getHours(),
          endMinutes: editEnd.getMinutes(),
        };
        onEventChange?.({
          ...event,
          ...allDayDates(event, true),
          isAllDay: true,
        });
        return;
      }
      const dates = allDayDates(event, false);
      const saved = savedTimeOfDayRef.current;
      if (saved) {
        dates.start =
          applyZonedTime(
            dates.start,
            saved.startHours,
            saved.startMinutes,
            event.timezone ? eventTimeZone({ timezone: event.timezone }) : zone,
          ) ?? dates.start;
        dates.end =
          applyZonedTime(
            dates.end,
            saved.endHours,
            saved.endMinutes,
            event.timezone ? eventTimeZone({ timezone: event.timezone }) : zone,
          ) ?? dates.end;
      }
      if (dates.end.getTime() <= dates.start.getTime())
        dates.end = new Date(dates.start.getTime() + 3600000);
      savedTimeOfDayRef.current = null;
      onEventChange?.({ ...event, ...dates, isAllDay: false });
    },
    [event, onEventChange, editStart, editEnd, zone],
  );

  const otherTypes = EVENT_TYPES.filter((t) => t !== eventType);

  return (
    <div className="flex flex-col gap-3 py-3">
      {/* Header */}
      <div className="flex items-center justify-between px-4">
        <DropdownMenu
          open={eventDropdownOpen}
          onOpenChange={(open) => {
            setEventDropdownOpen(open);
            if (open) setHoveredOther(false);
          }}
        >
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex items-center gap-0.5 text-xs font-medium rounded-sm border border-transparent px-2.5 py-1.5 -ml-2.5 gap-1.5 hover:border-[#E8E8E4] dark:hover:border-[#373737]",
                eventDropdownOpen
                  ? "bg-[#252525] text-white"
                  : "text-foreground",
              )}
            >
              {eventType}
              <ChevronDown
                className={cn(
                  "size-3.5",
                  eventDropdownOpen
                    ? "text-[#595959]"
                    : "text-[#C7C5C1] dark:text-[#595959]",
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
            onMouseLeave={() => setHoveredOther(false)}
          >
            <DropdownMenuItem
              className={cn(
                "group/item text-xs text-white focus:bg-[#303030] focus:text-white",
                !hoveredOther && "bg-[#303030]",
              )}
              onSelect={() => setEventType(eventType)}
              onMouseEnter={() => setHoveredOther(false)}
            >
              <Check className="size-3.5" />
              <span className="flex-1">{eventType}</span>
              <EventTypeHelpIcon tooltip={EVENT_TYPE_TOOLTIPS[eventType]} />
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-[#303030]" />
            {otherTypes.map((type) => (
              <DropdownMenuItem
                key={type}
                className="group/item text-xs text-white focus:bg-[#303030] focus:text-white pl-8"
                onSelect={() => setEventType(type)}
                onMouseEnter={() => setHoveredOther(true)}
              >
                <span className="flex-1">{type}</span>
                <EventTypeHelpIcon tooltip={EVENT_TYPE_TOOLTIPS[type]} />
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex items-center gap-0.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 border border-transparent hover:border-[#F5F5F5] hover:bg-[#F5F5F5] dark:hover:border-[#242424] dark:hover:bg-[#242424] text-[#C7C5C1] dark:text-[#595959]"
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              side="left"
              className="min-w-[180px] bg-[#252525] border-[#303030]"
            >
              <DropdownMenuItem className="text-xs text-white focus:!bg-[#303030] focus:!text-white">
                <SquareDashed className="size-3.5" />
                Cut
                <DropdownMenuShortcut className="text-white/40">
                  ⌘X
                </DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem className="text-xs text-white focus:!bg-[#303030] focus:!text-white">
                <TabletSmartphone className="size-3.5" />
                Copy
                <DropdownMenuShortcut className="text-white/40">
                  ⌘C
                </DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem className="text-xs text-white focus:!bg-[#303030] focus:!text-white">
                <Copy className="size-3.5" />
                Duplicate
                <DropdownMenuShortcut className="text-white/40">
                  ⌘D
                </DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-[#303030]" />
              <DropdownMenuItem className="text-xs text-[#E56458] focus:!bg-[#DE5551] focus:!text-white focus:[&>svg]:!text-white focus:[&>[data-slot=dropdown-menu-shortcut]]:!text-white">
                <Trash2 className="size-3.5 text-[#E56458]" />
                Delete
                <DropdownMenuShortcut className="text-white/40 tracking-normal">
                  delete
                </DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {headerActions}
        </div>
      </div>

      {/* Title */}
      <input
        ref={titleRef}
        type="text"
        value={titleValue}
        onChange={handleTitleChange}
        onFocus={handleTitleFocus}
        onBlur={commitTitle}
        onKeyDown={handleTitleKeyDown}
        placeholder="Title"
        className={cn(eventInlineTextClass, "mx-2")}
      />

      {/* Divider */}
      <div className="border-border border-t" />

      {/* Time — muted and non-interactive for all-day events */}
      {!event.isAllDay && (
        <div className="flex min-w-0 items-start gap-1 px-2 text-xs">
          {/* Start time group — Clock icon + input in one bordered container */}
          <div
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-sm border border-transparent px-2 py-1.5",
              event.isAllDay
                ? "cursor-default"
                : "cursor-text hover:border-[#E8E8E4] dark:hover:border-[#373737] has-[:focus]:border-[#F5F5F5] has-[:focus]:bg-[#F5F5F5] dark:has-[:focus]:border-[#242424] dark:has-[:focus]:bg-[#242424]",
            )}
            onClick={
              event.isAllDay ? undefined : () => startTimeRef.current?.focus()
            }
          >
            <Clock className="size-4 shrink-0 text-[#C7C5C1] dark:text-[#595959]" />
            <input
              ref={startTimeRef}
              aria-label="Start time"
              type="text"
              value={startTimeValue}
              onChange={handleStartTimeChange}
              onFocus={handleStartTimeFocus}
              onBlur={commitStartTime}
              onKeyDown={handleStartTimeKeyDown}
              readOnly={event.isAllDay}
              tabIndex={event.isAllDay ? -1 : undefined}
              className={cn(
                "w-[8ch] font-medium text-xs bg-transparent outline-none border-none p-0",
                event.isAllDay
                  ? "text-[#C7C5C1] dark:text-[#595959] pointer-events-none"
                  : "text-foreground",
              )}
            />
          </div>
          {/* End time group — arrow + input + duration in one bordered container */}
          <div
            className={cn(
              "flex min-w-0 flex-1 flex-wrap items-center gap-y-1 rounded-sm border border-transparent px-2 py-1.5",
              event.isAllDay
                ? "cursor-default"
                : "cursor-text hover:border-[#E8E8E4] dark:hover:border-[#373737] has-[:focus]:border-[#F5F5F5] has-[:focus]:bg-[#F5F5F5] dark:has-[:focus]:border-[#242424] dark:has-[:focus]:bg-[#242424]",
            )}
            onClick={
              event.isAllDay ? undefined : () => endTimeRef.current?.focus()
            }
          >
            <span className="mr-2 shrink-0 text-base leading-4 text-[#C7C5C1] dark:text-[#595959]">
              →
            </span>
            <input
              ref={endTimeRef}
              aria-label="End time"
              type="text"
              value={endTimeValue}
              onChange={handleEndTimeChange}
              onFocus={handleEndTimeFocus}
              onBlur={commitEndTime}
              onKeyDown={handleEndTimeKeyDown}
              readOnly={event.isAllDay}
              tabIndex={event.isAllDay ? -1 : undefined}
              className={cn(
                "w-[8ch] shrink-0 font-medium text-xs bg-transparent outline-none border-none p-0",
                event.isAllDay
                  ? "text-[#C7C5C1] dark:text-[#595959] pointer-events-none"
                  : "text-foreground",
              )}
            />
            <span className="ml-auto shrink-0 whitespace-nowrap pl-1 text-[#C7C5C1] dark:text-[#595959]">
              {formatDuration(event.start, event.end)}
            </span>
          </div>
        </div>
      )}

      {timeError && (
        <p role="alert" className="px-4 text-xs text-destructive">
          {timeError}
        </p>
      )}

      {/* Date — editable inline input(s), indented to align with time text */}
      <div
        className={cn(
          "flex items-center gap-2 -mt-2",
          !event.isAllDay ? "ml-8" : "ml-4",
        )}
      >
        {/* Start date */}
        <div
          className="mr-0 flex min-w-[6.5rem] self-start cursor-text items-center rounded-sm border border-transparent px-2 py-1.5 hover:border-[#E8E8E4] dark:hover:border-[#373737] has-[:focus]:border-[#F5F5F5] has-[:focus]:bg-[#F5F5F5] dark:has-[:focus]:border-[#242424] dark:has-[:focus]:bg-[#242424]"
          onClick={() => dateRef.current?.focus()}
        >
          <input
            ref={dateRef}
            aria-label="Start date"
            type="text"
            value={dateValue}
            onChange={handleDateChange}
            onFocus={handleDateFocus}
            onBlur={commitDate}
            onKeyDown={handleDateKeyDown}
            className="text-foreground text-xs bg-transparent outline-none border-none p-0"
            size={dateValue.length}
          />
        </div>
        {/* End date — only visible for all-day events */}
        {event.isAllDay && (
          <div
            className="flex min-w-[6.5rem] self-start cursor-text items-center rounded-sm border border-transparent px-2 py-1.5 hover:border-[#E8E8E4] dark:hover:border-[#373737] has-[:focus]:border-[#F5F5F5] has-[:focus]:bg-[#F5F5F5] dark:has-[:focus]:border-[#242424] dark:has-[:focus]:bg-[#242424]"
            onClick={() => endDateRef.current?.focus()}
          >
            <input
              ref={endDateRef}
              aria-label="End date"
              type="text"
              value={endDateValue}
              onChange={handleEndDateChange}
              onFocus={handleEndDateFocus}
              onBlur={commitEndDate}
              onKeyDown={handleEndDateKeyDown}
              className="text-foreground text-xs bg-transparent outline-none border-none p-0"
              size={endDateValue.length}
            />
          </div>
        )}
      </div>

      {optionsExpanded || event.isAllDay ? (
        <>
          {/* All-day toggle row — clicking label or row triggers toggle */}
          <div
            className="flex cursor-default items-center gap-3 px-4"
            onClick={() => handleAllDayToggle(!(event.isAllDay ?? false))}
          >
            <Switch
              aria-label="All-day event"
              size="xs"
              checked={event.isAllDay ?? false}
              onCheckedChange={handleAllDayToggle}
              onClick={(e) => e.stopPropagation()}
              className="data-[state=unchecked]:!bg-[#C7C5C1] dark:data-[state=unchecked]:!bg-[#595959] data-[state=checked]:!bg-[#3A85D3]"
            />
            <span className="text-foreground text-xs">All-day</span>
          </div>

          {!event.isAllDay && (
            <div className="px-4">
              <EventTimezoneField
                key={event.id}
                event={event}
                context={editorContext}
                onEventChange={onEventChange}
              />
            </div>
          )}
          <div className="px-4">
            <EventRecurrenceField
              key={event.id}
              event={event}
              context={editorContext}
              onEventChange={onEventChange}
              onPrevWeek={onPrevWeek}
              onNextWeek={onNextWeek}
            />
          </div>
        </>
      ) : (
        <div
          className={cn(
            "-mt-2 gap-1 pl-8 pr-4",
            editorContext === "sidebar"
              ? "grid grid-cols-[auto_auto_minmax(0,1fr)] items-center"
              : "flex items-center",
          )}
        >
          <button
            type="button"
            aria-label="Make event all-day"
            className="row-start-1 min-h-8 rounded-sm px-2 py-1.5 text-xs text-muted-foreground outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/30"
            onClick={() => {
              setOptionsExpanded(true);
              handleAllDayToggle(true);
            }}
          >
            All-day
          </button>
          <EventTimezoneField
            key={`zone-${event.id}`}
            compact
            event={event}
            context={editorContext}
            onEventChange={onEventChange}
          />
          <EventRecurrenceField
            key={`repeat-${event.id}`}
            compact
            event={event}
            context={editorContext}
            onEventChange={onEventChange}
          />
        </div>
      )}

      {/* Divider */}
      <div className="border-border border-t" />

      {/* Field sections */}
      <div className="flex flex-col px-4">
        <EventLocationField
          key={event.id}
          event={event}
          context={editorContext}
          onEventChange={onEventChange}
        />
      </div>

      {/* Divider */}
      <div className="border-border border-t" />

      {/* Description */}
      <EventDescriptionField
        key={event.id}
        event={event}
        onEventChange={onEventChange}
      />

      {/* Divider */}
      <div className="border-border border-t" />

      {/* Calendar */}
      <div className="flex items-center gap-2 px-4">
        <div className={cn("size-3 rounded-xs", colorDotClass[color])} />
        <span className="text-foreground text-xs">
          {event.calendarEmail ?? event.calendarId ?? "Calendar"}
        </span>
      </div>

      {/* Status */}
      <div className="mt-1 grid grid-cols-2 pl-9">
        <span className="text-foreground text-xs font-medium capitalize">
          {event.status ?? "Busy"}
        </span>
        <span className="text-foreground text-xs font-medium">
          {formatVisibility(event.visibility)}
        </span>
      </div>

      {/* Reminders */}
      <div className="mt-1 flex flex-col gap-3 px-4">
        <div className="flex items-center gap-2">
          <Bell className="size-4 text-[#C7C5C1] dark:text-[#595959]" />
          <span className="text-xs text-[#C7C5C1] dark:text-[#595959]">
            Reminders
          </span>
        </div>
        {event.reminders &&
          event.reminders.length > 0 &&
          event.reminders.map((reminder) => (
            <span
              key={`${reminder.amount}-${reminder.unit}`}
              className="text-foreground pl-6 text-xs"
            >
              <span className="font-medium">
                {reminder.amount}
                {reminder.unit.replace(/s$/, "")}
              </span>{" "}
              before
            </span>
          ))}
      </div>
    </div>
  );
}
