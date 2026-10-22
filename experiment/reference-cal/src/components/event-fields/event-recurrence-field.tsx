"use client";

import * as React from "react";
import { addMonths, format } from "date-fns";
import { ChevronLeft, ChevronRight, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { eventTimeZone, inTimeZone, zoneDateKey } from "@/lib/event-timezone";
import { legacyRecurrence, recurrenceSummary } from "@/lib/event-recurrence";
import type {
  CalendarEvent,
  EventEditorContext,
  EventRecurrenceRule,
} from "../week-view-types";
import {
  EventFieldActions,
  EventFieldEditor,
  eventFieldInputClass,
} from "./event-field-editor";

const DAYS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 0, label: "Sunday" },
];

function FieldSelect({
  label,
  value,
  onChange,
  choices,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  choices: { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label={label}
        size="sm"
        className="w-full min-w-0 text-xs"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" className="z-[70]">
        {choices.map((choice) => (
          <SelectItem
            key={choice.value}
            value={choice.value}
            className="text-xs"
          >
            {choice.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function EventRecurrenceField({
  event,
  context,
  compact = false,
  onEventChange,
  onPrevWeek,
  onNextWeek,
}: {
  event: CalendarEvent;
  context: EventEditorContext;
  compact?: boolean;
  onEventChange?: (event: CalendarEvent) => void;
  onPrevWeek?: () => void;
  onNextWeek?: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const zone = event.recurrenceAnchor?.timezone ?? eventTimeZone(event),
    anchor = event.recurrenceAnchor?.start ?? event.start,
    start = inTimeZone(anchor, zone);
  const existing = event.recurrenceRule ?? legacyRecurrence(event.recurrence);
  const [frequency, setFrequency] = React.useState<
    EventRecurrenceRule["frequency"] | "none"
  >("none");
  const [interval, setInterval] = React.useState("1");
  const [weekdays, setWeekdays] = React.useState<number[]>([]);
  const [monthlyMode, setMonthlyMode] = React.useState("day");
  const [ends, setEnds] = React.useState("never");
  const [until, setUntil] = React.useState("");
  const [count, setCount] = React.useState("10");
  const intervalId = React.useId(),
    endId = React.useId();
  function changeOpen(next: boolean) {
    if (next) {
      setFrequency(existing?.frequency ?? "none");
      setInterval(String(existing?.interval ?? 1));
      setWeekdays(existing?.weekdays ?? [start.getDay()]);
      setMonthlyMode(existing?.monthlyMode ?? "day");
      setEnds(existing?.until ? "date" : existing?.count ? "count" : "never");
      setUntil(existing?.until ?? format(addMonths(start, 3), "yyyy-MM-dd"));
      setCount(String(existing?.count ?? 10));
    }
    setOpen(next);
  }
  const intervalNumber = Number(interval),
    countNumber = Number(count);
  const invalid =
    frequency !== "none" &&
    (!Number.isInteger(intervalNumber) ||
      intervalNumber < 1 ||
      intervalNumber > 99 ||
      (frequency === "weekly" && weekdays.length === 0) ||
      (ends === "count" &&
        (!Number.isInteger(countNumber) ||
          countNumber < 1 ||
          countNumber > 999)) ||
      (ends === "date" &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(until) ||
          until < zoneDateKey(event.start, zone))));
  const draft: EventRecurrenceRule | undefined =
    frequency === "none"
      ? undefined
      : {
          frequency,
          interval: intervalNumber,
          ...(frequency === "weekly" ? { weekdays } : {}),
          ...(frequency === "monthly"
            ? { monthlyMode: monthlyMode as "day" | "weekday" }
            : {}),
          ...(ends === "date"
            ? { until }
            : ends === "count"
              ? { count: countNumber }
              : {}),
        };
  const summary = existing
    ? recurrenceSummary(existing, anchor, zone)
    : "Repeat";
  return (
    <EventFieldEditor
      context={context}
      compact={compact}
      label="Edit repeat"
      open={open}
      onOpenChange={changeOpen}
      className={compact ? "-ml-2 text-foreground/65" : "-mx-2 flex-1"}
      actions={
        !compact &&
        existing && (
          <div className="ml-auto flex shrink-0 items-center">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 text-foreground/65"
              aria-label="Previous week"
              onClick={onPrevWeek}
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 text-foreground/65"
              aria-label="Next week"
              onClick={onNextWeek}
            >
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        )
      }
      trigger={
        compact ? (
          "Repeat"
        ) : (
          <>
            <RefreshCcw className="size-4 shrink-0 text-foreground/65" />
            <span
              className={cn(
                "min-w-0",
                existing ? "text-foreground" : "text-foreground/65",
              )}
            >
              {summary}
            </span>
          </>
        )
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (invalid) return;
          onEventChange?.({
            ...event,
            timezone: event.timezone ?? zone,
            recurrenceRule: draft,
            recurrence: draft
              ? recurrenceSummary(draft, anchor, zone)
              : undefined,
          });
          setOpen(false);
        }}
        className="space-y-3"
      >
        <h3 className="font-medium">Repeat event</h3>
        <FieldSelect
          label="Repeat frequency"
          value={frequency}
          onChange={(value) => setFrequency(value as typeof frequency)}
          choices={[
            { value: "none", label: "Does not repeat" },
            { value: "daily", label: "Daily" },
            { value: "weekly", label: "Weekly" },
            { value: "monthly", label: "Monthly" },
            { value: "yearly", label: "Yearly" },
          ]}
        />
        {frequency !== "none" && (
          <>
            <div className="flex items-center gap-2">
              <label htmlFor={intervalId}>Every</label>
              <input
                id={intervalId}
                aria-label="Repeat interval"
                type="number"
                min={1}
                max={99}
                value={interval}
                onChange={(e) => setInterval(e.target.value)}
                className={cn(eventFieldInputClass, "w-16")}
              />
              <span className="text-foreground/65">
                {
                  {
                    daily: "day",
                    weekly: "week",
                    monthly: "month",
                    yearly: "year",
                  }[frequency]
                }
                {intervalNumber === 1 ? "" : "s"}
              </span>
            </div>
            {frequency === "weekly" && (
              <fieldset>
                <legend className="mb-2 text-foreground/65">Repeat on</legend>
                <div
                  className="grid grid-cols-7 gap-1 max-md:grid-cols-4"
                  role="group"
                  aria-label="Repeat on"
                >
                  {DAYS.map((day) => (
                    <button
                      key={day.value}
                      type="button"
                      aria-label={day.label}
                      aria-pressed={weekdays.includes(day.value)}
                      className={cn(
                        "h-7 w-full min-w-0 rounded-full border text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40 max-md:h-10",
                        weekdays.includes(day.value)
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border hover:bg-muted",
                      )}
                      onClick={() =>
                        setWeekdays((current) =>
                          current.includes(day.value)
                            ? current.filter((value) => value !== day.value)
                            : [...current, day.value].sort((a, b) => a - b),
                        )
                      }
                    >
                      {day.label.slice(0, 3)}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
            {frequency === "monthly" && (
              <FieldSelect
                label="Monthly pattern"
                value={monthlyMode}
                onChange={setMonthlyMode}
                choices={[
                  { value: "day", label: `On day ${start.getDate()}` },
                  {
                    value: "weekday",
                    label: `On the ${["first", "second", "third", "fourth", "last"][Math.min(Math.floor((start.getDate() - 1) / 7), 4)]} ${format(start, "EEEE")}`,
                  },
                ]}
              />
            )}
            <div className="space-y-2">
              <span className="text-foreground/65">Ends</span>
              <FieldSelect
                label="Repeat ends"
                value={ends}
                onChange={setEnds}
                choices={[
                  { value: "never", label: "Never" },
                  { value: "date", label: "On a date" },
                  { value: "count", label: "After a set number" },
                ]}
              />
              {ends === "date" && (
                <input
                  id={endId}
                  aria-label="Repeat end date"
                  type="date"
                  min={zoneDateKey(event.start, zone)}
                  value={until}
                  onChange={(e) => setUntil(e.target.value)}
                  className={eventFieldInputClass}
                />
              )}
              {ends === "count" && (
                <label className="flex items-center gap-2">
                  <input
                    aria-label="Occurrence count"
                    type="number"
                    min={1}
                    max={999}
                    value={count}
                    onChange={(e) => setCount(e.target.value)}
                    className={cn(eventFieldInputClass, "w-20")}
                  />
                  <span className="text-foreground/65">occurrences</span>
                </label>
              )}
            </div>
          </>
        )}
        {invalid && (
          <p role="alert" className="text-[11px] text-destructive">
            Choose a valid interval, at least one weekday, and an end after this
            event.
          </p>
        )}
        {!invalid && draft && (
          <p className="text-[11px] leading-relaxed text-foreground/65">
            {recurrenceSummary(draft, anchor, zone)}
          </p>
        )}
        <p className="text-[11px] leading-relaxed text-foreground/65">
          Repeat settings apply to the whole series. Other edits change only the
          selected event.
        </p>
        <EventFieldActions onCancel={() => setOpen(false)} disabled={invalid} />
      </form>
    </EventFieldEditor>
  );
}
