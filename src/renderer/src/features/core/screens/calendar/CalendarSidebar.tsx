import { useEffect, useMemo, useState } from "react";
import type { SmartRescheduleResponse } from "@shared/ipc/contracts";
import { CalendarPlus, Check, Copy, Eye, EyeOff, MapPin, Minus, Sparkles, X } from "lucide-react";
import { Badge, Button, IconButton, Input, Panel, cx } from "../../../../components/primitives";
import { EmptyState, ErrorState } from "../../../../components/states";
import type { CalendarEventViewModel } from "../../coreViewModels";
import type { CalendarSourceViewModel } from "../../coreScreenShared";
import { MarkdownPreview, hasRenderableMixedMarkup } from "../../MarkdownPreview";
import { CalendarSourceSwatch } from "./CalendarEventChips";
import {
  calendarAvailabilitySnippet,
  calendarTimeBlockLabel,
  sortedCalendarTimeBlocks
} from "./calendarGrid";
import type { CalendarTimeBlock } from "./types";

function minutesToTimeInput(value: number): string {
  const minutes = Math.max(0, Math.min(24 * 60 - 1, Math.round(value)));
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function timeInputToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return Math.max(0, Math.min(24 * 60 - 1, hours * 60 + minutes));
}

function smartSuggestionTimeLabel(startsAt: string, endsAt: string, timeZone: string): string {
  return `${new Date(startsAt).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone
  })}–${new Date(endsAt).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone
  })}`;
}

function smartDueLabel(dueDate: string, scheduleDate: string): string {
  const due = new Date(`${dueDate}T00:00:00.000Z`);
  const scheduled = new Date(`${scheduleDate}T00:00:00.000Z`);
  const dayDistance = Math.round((due.getTime() - scheduled.getTime()) / 86_400_000);
  if (dayDistance === 0) return "today";
  if (dayDistance === 1) return "tomorrow";
  if (dayDistance === -1) return "yesterday";
  return Number.isFinite(due.getTime())
    ? new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", timeZone: "UTC" }).format(due)
    : dueDate;
}

export interface SmartSchedulePreview {
  stale: boolean;
  suggestions: SmartRescheduleResponse["suggestions"];
}

function CalendarSourceRow({
  calendar,
  defaultTimeZone,
  onToggle,
  visible
}: {
  calendar: CalendarSourceViewModel;
  defaultTimeZone: string;
  onToggle: (calendarId: string, visible: boolean) => void;
  visible: boolean;
}): JSX.Element {
  const VisibilityIcon = visible ? Eye : EyeOff;

  return (
    <label
      className={cx(
        "grid min-h-10 grid-cols-[18px_14px_minmax(0,1fr)_auto] items-center gap-2 rounded-hcbMd border px-2.5 text-[var(--text-sm)] transition-colors duration-fast ease-hcb",
        visible
          ? "border-border bg-bg-tertiary text-text-secondary"
          : "border-dashed border-border bg-transparent text-text-muted"
      )}
    >
      <input
        aria-label={`${visible ? "Hide" : "Show"} ${calendar.title}`}
        checked={visible}
        className="accent-[var(--color-accent)]"
        onChange={(event) => onToggle(calendar.id, event.target.checked)}
        type="checkbox"
      />
      <CalendarSourceSwatch
        calendarId={calendar.id}
        className={visible ? undefined : "opacity-50"}
        color={calendar.backgroundColor}
      />
      <span className="min-w-0 truncate">{calendar.title}</span>
      <span className="flex shrink-0 items-center gap-1">
        <VisibilityIcon aria-hidden="true" className="text-text-muted" size={13} />
        <Badge tone="neutral">{calendar.timeZone ?? defaultTimeZone}</Badge>
      </span>
    </label>
  );
}

export function CalendarSourceVisibilityList({
  calendars,
  defaultTimeZone,
  onToggle,
  visibleCalendarIds
}: {
  calendars: CalendarSourceViewModel[];
  defaultTimeZone: string;
  onToggle: (calendarId: string, visible: boolean) => void;
  visibleCalendarIds: ReadonlySet<string>;
}): JSX.Element {
  const shownCalendars = calendars.filter((calendar) => visibleCalendarIds.has(calendar.id));
  const hiddenCalendars = calendars.filter((calendar) => !visibleCalendarIds.has(calendar.id));

  return (
    <div className="grid gap-3 p-3" role="group" aria-label="Calendar visibility">
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2 text-[var(--text-xs)] font-medium text-text-muted">
          <span>Shown</span>
          <span>{shownCalendars.length}</span>
        </div>
        {shownCalendars.map((calendar) => (
          <CalendarSourceRow
            calendar={calendar}
            defaultTimeZone={defaultTimeZone}
            key={calendar.id}
            onToggle={onToggle}
            visible
          />
        ))}
      </div>
      {hiddenCalendars.length > 0 ? (
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-2 text-[var(--text-xs)] font-medium text-text-muted">
            <span>Hidden</span>
            <span>{hiddenCalendars.length}</span>
          </div>
          {hiddenCalendars.map((calendar) => (
            <CalendarSourceRow
              calendar={calendar}
              defaultTimeZone={defaultTimeZone}
              key={calendar.id}
              onToggle={onToggle}
              visible={false}
            />
          ))}
        </div>
      ) : null}
      {calendars.length === 0 ? (
        <EmptyState
          description="No calendars are available yet."
          title="No calendars"
        />
      ) : null}
    </div>
  );
}

export function CalendarContextPanel({
  defaultTimeZone,
  event,
  onOpen
}: {
  defaultTimeZone: string;
  event: CalendarEventViewModel | null;
  onOpen: (event: CalendarEventViewModel) => void;
}): JSX.Element {
  return (
    <Panel
      title="Context"
      description={event ? event.rangeLabel : "No visible event"}
    >
      <div className="p-3" role="region" aria-label="Calendar context">
        {event ? (
          <div className="overflow-hidden rounded-hcbMd border border-border bg-bg-tertiary">
          <button
            className="grid w-full gap-2 p-3 text-left transition-colors duration-fast ease-hcb hover:bg-surface-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onClick={() => onOpen(event)}
            type="button"
          >
            <span className="flex min-w-0 items-center gap-2">
              <CalendarSourceSwatch calendarId={event.calendarId} color={event.calendarBackgroundColor} />
              <span className="min-w-0 flex-1 truncate text-[var(--text-sm)] font-semibold text-text-primary">
                {event.title}
              </span>
            </span>
            <span className="flex min-w-0 flex-wrap items-center gap-2 text-[var(--text-xs)] text-text-muted">
              <Badge tone="neutral">{event.allDay ? "All day" : event.rangeLabel}</Badge>
              <Badge tone="neutral">{event.calendar}</Badge>
              {event.timeZone && event.timeZone !== defaultTimeZone ? (
                <Badge tone="neutral">{event.timeZone}</Badge>
              ) : null}
            </span>
            {event.location ? (
              <span className="inline-flex min-w-0 items-center gap-1 text-[var(--text-xs)] text-text-muted">
                <MapPin aria-hidden="true" size={13} />
                <span className="truncate">{event.location}</span>
              </span>
            ) : null}
          </button>
          {hasRenderableMixedMarkup(event.notes) ? (
            <div className="border-t border-border px-3 py-3">
              <MarkdownPreview
                ariaLabel="Event description"
                body={event.notes}
                className="gap-1.5 text-[var(--text-sm)] leading-relaxed"
                variant="plain"
              />
            </div>
          ) : null}
          </div>
        ) : (
          <EmptyState description="No events match the visible calendar sources." title="No context" />
        )}
      </div>
    </Panel>
  );
}

export function ShareAvailabilityPanel({
  calendarId,
  calendars,
  durationMinutes,
  endDate,
  error,
  exportBusyBlockCount,
  exportPending,
  exportText,
  onCalendarChange,
  onClose,
  onCreateHolds,
  onDurationChange,
  onEndDateChange,
  onExportAvailability,
  onRemoveSlot,
  onStartDateChange,
  onTitleChange,
  pending,
  slots,
  startDate,
  timeZone,
  initialTitle
}: {
  calendarId: string;
  calendars: CalendarSourceViewModel[];
  durationMinutes: number;
  endDate: string;
  error?: string;
  exportBusyBlockCount: number | null;
  exportPending: boolean;
  exportText: string;
  onCalendarChange: (calendarId: string) => void;
  onClose: () => void;
  onCreateHolds: () => void;
  onDurationChange: (duration: number) => void;
  onEndDateChange: (date: string) => void;
  onExportAvailability: () => void;
  onRemoveSlot: (slotId: string) => void;
  onStartDateChange: (date: string) => void;
  onTitleChange: (title: string) => void;
  pending: boolean;
  slots: CalendarTimeBlock[];
  startDate: string;
  timeZone: string;
  initialTitle: string;
}): JSX.Element {
  const [title, setTitle] = useState(initialTitle);
  const sortedSlots = useMemo(() => sortedCalendarTimeBlocks(slots), [slots]);
  const snippet = useMemo(
    () =>
      calendarAvailabilitySnippet({
        durationMinutes,
        slots,
        timeZone,
        title
      }),
    [durationMinutes, slots, timeZone, title]
  );
  const selectClass =
    "h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

  useEffect(() => {
    setTitle(initialTitle);
  }, [initialTitle]);

  function updateTitle(nextTitle: string): void {
    setTitle(nextTitle);
    onTitleChange(nextTitle);
  }

  function copySnippet(): void {
    if (sortedSlots.length === 0) {
      return;
    }

    void navigator.clipboard?.writeText(snippet);
  }

  return (
    <Panel className="flex flex-col overflow-hidden self-start">
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="inline-flex min-w-0 items-center gap-2">
          <CalendarPlus aria-hidden="true" className="text-accent" size={16} />
          <h2 className="truncate text-[var(--text-md)] font-semibold text-text-primary">Share Availability</h2>
        </div>
        <IconButton icon={X} label="Close share availability" onClick={onClose} size="sm" variant="ghost" />
      </div>
      <div className="grid auto-rows-max content-start gap-3 p-3">
        <Input
          aria-label="Availability title"
          onChange={(event) => updateTitle(event.target.value)}
          value={title}
        />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="grid gap-1 text-[var(--text-sm)] font-semibold text-text-secondary">
            <span>Duration</span>
            <select
              aria-label="Availability duration"
              className={selectClass}
              onChange={(event) => onDurationChange(Number(event.target.value))}
              value={durationMinutes}
            >
              {[15, 30, 45, 60, 90, 120].map((duration) => (
                <option key={duration} value={duration}>
                  {duration}m
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-[var(--text-sm)] font-semibold text-text-secondary">
            <span>Calendar</span>
            <select
              aria-label="Availability calendar"
              className={selectClass}
              onChange={(event) => onCalendarChange(event.target.value)}
              value={calendarId}
            >
              {calendars.map((calendar) => (
                <option key={calendar.id} value={calendar.id}>
                  {calendar.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="grid gap-1 text-[var(--text-sm)] font-semibold text-text-secondary">
          <span>Timezone</span>
          <select aria-label="Availability timezone" className={selectClass} disabled value={timeZone}>
            <option value={timeZone}>{timeZone}</option>
          </select>
        </label>
        <div className="grid gap-3 border-t border-border pt-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-[var(--text-sm)] font-semibold text-text-secondary">
              <span>Start</span>
              <input
                aria-label="Availability start"
                className={selectClass}
                onChange={(event) => onStartDateChange(event.target.value)}
                type="date"
                value={startDate}
              />
            </label>
            <label className="grid gap-1 text-[var(--text-sm)] font-semibold text-text-secondary">
              <span>End</span>
              <input
                aria-label="Availability end"
                className={selectClass}
                onChange={(event) => onEndDateChange(event.target.value)}
                type="date"
                value={endDate}
              />
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Button disabled={exportPending} onClick={onExportAvailability} size="sm" variant="secondary">
              <CalendarPlus aria-hidden="true" size={14} />
              {exportPending ? "Generating" : "Generate"}
            </Button>
            {exportBusyBlockCount !== null ? (
              <Badge tone="info">
                {exportBusyBlockCount} busy block{exportBusyBlockCount === 1 ? "" : "s"}
              </Badge>
            ) : null}
          </div>
          <textarea
            aria-label="Availability export"
            className="min-h-24 rounded-hcbMd border border-border bg-surface-0 px-3 py-2 font-mono text-[var(--text-xs)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            readOnly
            value={exportText}
          />
        </div>
        {error ? <ErrorState description={error} title="Availability not saved" /> : null}
        <div className="border-t border-border pt-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-[var(--text-sm)] font-semibold text-text-primary">Selected Slots</h3>
            <span className="text-[var(--text-xs)] font-semibold text-text-muted">
              {sortedSlots.length} selected
            </span>
          </div>
          <div className="grid gap-1.5">
            {sortedSlots.length > 0 ? (
              sortedSlots.map((slot) => (
                <div
                  className="grid min-h-9 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-sm)] text-text-secondary"
                  key={slot.id}
                >
                  <span className="truncate">{calendarTimeBlockLabel(slot, timeZone)}</span>
                  <IconButton
                    icon={Minus}
                    label={`Remove ${calendarTimeBlockLabel(slot, timeZone)}`}
                    onClick={() => onRemoveSlot(slot.id)}
                    size="sm"
                    variant="ghost"
                  />
                </div>
              ))
            ) : (
              <div className="rounded-hcbMd border border-dashed border-border px-3 py-4 text-[var(--text-sm)] text-text-muted">
                No slots selected.
              </div>
            )}
          </div>
          <Button
            className="mt-3"
            disabled={pending || sortedSlots.length === 0 || !calendarId}
            onClick={onCreateHolds}
            size="sm"
            variant="primary"
          >
            <CalendarPlus aria-hidden="true" size={14} />
            {pending ? "Creating holds" : "Create Holds"}
          </Button>
        </div>
        <div className="border-t border-border pt-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-[var(--text-sm)] font-semibold text-text-primary">Snippet</h3>
            <Button disabled={sortedSlots.length === 0} onClick={copySnippet} size="sm" variant="secondary">
              <Copy aria-hidden="true" size={14} />
              Copy
            </Button>
          </div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-hcbMd border border-border bg-surface-0 p-3 font-mono text-[var(--text-xs)] text-text-secondary">
            {snippet}
          </pre>
        </div>
      </div>
    </Panel>
  );
}

export function SmartReschedulePanel({
  calendars,
  defaultTimeZone,
  initialDate,
  onApplied,
  onClose,
  onPreviewChange
}: {
  calendars: CalendarSourceViewModel[];
  defaultTimeZone: string;
  initialDate: string;
  onApplied: () => void;
  onClose: () => void;
  onPreviewChange: (preview: SmartSchedulePreview | null) => void;
}): JSX.Element {
  const defaultCalendarId = calendars.find((calendar) => calendar.selected)?.id ?? calendars[0]?.id ?? "";
  const [date, setDate] = useState(initialDate);
  const [calendarId, setCalendarId] = useState(defaultCalendarId);
  const [workStartMinutes, setWorkStartMinutes] = useState(9 * 60);
  const [workEndMinutes, setWorkEndMinutes] = useState(17 * 60);
  const [candidateScope, setCandidateScope] = useState<"dueSoon" | "allOpen">("allOpen");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<(SmartRescheduleResponse & { previewKey?: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showUnscheduled, setShowUnscheduled] = useState(false);

  const previewKey = `${date}|${calendarId}|${workStartMinutes}|${workEndMinutes}|${candidateScope}`;
  const previewIsCurrent = Boolean(result?.planId && result.applied === false && result.previewKey === previewKey);
  const invalidWorkingHours = workEndMinutes <= workStartMinutes;

  function setPreview(next: SmartRescheduleResponse | null): void {
    if (next && !next.applied) {
      setResult({ ...next, previewKey });
      setShowUnscheduled(false);
      return;
    }
    setResult(next);
  }

  useEffect(() => {
    if (!result || result.applied) {
      onPreviewChange(null);
      return;
    }

    onPreviewChange({
      stale: !previewIsCurrent,
      suggestions: result.suggestions
    });
  }, [onPreviewChange, previewIsCurrent, result]);

  useEffect(() => () => onPreviewChange(null), [onPreviewChange]);

  async function runSmartReschedule(mode: "preview" | "apply"): Promise<void> {
    if (!window.hcb?.calendar.smartReschedule) {
      setError("Preload bridge is unavailable.");
      return;
    }

    setPending(true);
    setError(null);
    const response = await window.hcb.calendar.smartReschedule(
      mode === "apply"
        ? { apply: true, planId: result?.planId }
        : {
            date,
            calendarId,
            apply: false,
            candidateScope,
            workingHours: { startMinutes: workStartMinutes, endMinutes: workEndMinutes }
          }
    );
    setPending(false);

    if (!response.ok) {
      setError(response.error.message);
      return;
    }

    setPreview(response.data);

    if (mode === "apply") {
      onApplied();
    }
  }

  return (
    <Panel className="flex flex-col overflow-hidden self-start">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <h2 className="truncate text-[var(--text-sm)] font-semibold text-text-primary">Smart schedule</h2>
          <p className="text-[var(--text-xs)] text-text-muted">
            {result ? `${result.candidateCount ?? 0} tasks considered` : "Review a plan before anything changes"}
          </p>
        </div>
        <IconButton icon={X} label="Close smart reschedule" onClick={onClose} size="sm" variant="ghost" />
      </div>
      <div className="grid gap-3 overflow-auto p-3">
        <div className="grid gap-2">
          <p className="text-[var(--text-xs)] leading-relaxed text-text-secondary">
            Build a reviewed plan around blocking Calendar events. Nothing changes until you apply it.
          </p>
          <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
            <span>Date</span>
            <Input aria-label="Smart reschedule date" onChange={(event) => setDate(event.target.value)} type="date" value={date} />
          </label>
          <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
            <span>Tasks to consider</span>
            <select
              aria-label="Smart schedule task scope"
              className="h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              onChange={(event) => setCandidateScope(event.target.value as "dueSoon" | "allOpen")}
              value={candidateScope}
            >
              <option value="allOpen">All open top-level tasks</option>
              <option value="dueSoon">Overdue and due within 14 days</option>
            </select>
          </label>
          <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
            <span>Calendar</span>
            <select
              aria-label="Smart reschedule calendar"
              className="h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary"
              onChange={(event) => setCalendarId(event.target.value)}
              value={calendarId}
            >
              {calendars.map((calendar) => (
                <option key={calendar.id} value={calendar.id}>
                  {calendar.title}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
              <span>From</span>
              <Input aria-label="Working hours start" onChange={(event) => setWorkStartMinutes(timeInputToMinutes(event.target.value))} type="time" value={minutesToTimeInput(workStartMinutes)} />
            </label>
            <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
              <span>To</span>
              <Input aria-label="Working hours end" onChange={(event) => setWorkEndMinutes(timeInputToMinutes(event.target.value))} type="time" value={minutesToTimeInput(workEndMinutes)} />
            </label>
          </div>
          {invalidWorkingHours ? (
            <p className="text-[var(--text-xs)] font-medium text-danger" role="alert">
              End time must be after start time.
            </p>
          ) : null}
          <p className="text-[var(--text-xs)] leading-relaxed text-text-muted">
            Uses all available free time in this window. Free Calendar events remain visible but do not reserve time.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={pending || !calendarId || invalidWorkingHours} onClick={() => void runSmartReschedule("preview")} size="sm" variant="secondary">
              <Sparkles aria-hidden="true" size={14} />
              {pending ? "Checking" : "Preview"}
            </Button>
            <Button disabled={pending || !previewIsCurrent || !result || result.suggestions.length === 0} onClick={() => void runSmartReschedule("apply")} size="sm" variant="primary">
              <Check aria-hidden="true" size={14} />
              Apply {result?.suggestions.length ?? 0} changes
            </Button>
          </div>
        </div>
        {error ? <ErrorState description={error} title="Smart schedule failed" /> : null}
        {result ? (
          <div className={cx("grid gap-2", !previewIsCurrent && !result.applied && "opacity-60")}>
            <div className="grid gap-1 text-[var(--text-xs)] text-text-secondary">
              <p>
                {result.fixedEventCount ?? 0} blocking event{result.fixedEventCount === 1 ? "" : "s"} · {result.nonBlockingEventCount ?? 0} Free event{result.nonBlockingEventCount === 1 ? "" : "s"} ignored
              </p>
              <p>{result.candidateScopeLabel ?? "Open tasks"} · {result.prioritizationLabel ?? "Stable scheduling order"}</p>
              <p>
                {result.suggestions.length} scheduled · {result.scheduledMinutes ?? 0} minutes planned{result.availableMinutes !== undefined ? ` of ${result.availableMinutes} free` : ""}
              </p>
            </div>
            {!previewIsCurrent && !result.applied ? (
              <div className="rounded-hcbMd border border-warning bg-surface-0 px-2 py-1.5 text-[var(--text-xs)] text-text-secondary">
                <span className="font-semibold text-warning">Outdated preview</span>
                <span className="ml-1">Settings changed. Preview again before applying.</span>
              </div>
            ) : null}
            {result.suggestions.map((suggestion) => (
              <div className="grid gap-1 rounded-hcbMd border border-border bg-surface-0 p-2" key={`${suggestion.taskId}-${suggestion.startsAt}`}>
                <span className="tabular-nums text-[var(--text-sm)] font-semibold text-info">{smartSuggestionTimeLabel(suggestion.startsAt, suggestion.endsAt, defaultTimeZone)}</span>
                <span className="truncate text-[var(--text-sm)] font-medium text-text-primary">{suggestion.taskTitle}</span>
                <div className="text-[var(--text-xs)] text-text-secondary">
                  {suggestion.durationMinutes} min{suggestion.usesDefaultDuration ? " · default estimate" : ""}{suggestion.dueDate ? ` · Due ${smartDueLabel(suggestion.dueDate, date)}` : ""}
                </div>
                <div className="text-[var(--text-xs)] text-text-muted">{suggestion.reason}</div>
              </div>
            ))}
            {result.suggestions.length === 0 ? (
              <div className="rounded-hcbMd border border-dashed border-border px-3 py-4 text-[var(--text-sm)] text-text-muted">
                No schedule changes suggested.
              </div>
            ) : null}
            {result.skipped.length > 0 ? (
              <div className="grid gap-1 border-t border-border pt-2">
                <button
                  aria-expanded={showUnscheduled}
                  className="flex min-h-8 items-center justify-between gap-2 rounded-hcbSm px-1 text-left text-[var(--text-sm)] font-medium text-text-primary hover:bg-surface-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  onClick={() => setShowUnscheduled((shown) => !shown)}
                  type="button"
                >
                  <span>Couldn’t schedule {result.skipped.length} task{result.skipped.length === 1 ? "" : "s"}</span>
                  <span aria-hidden="true" className="text-text-muted">{showUnscheduled ? "⌄" : "›"}</span>
                </button>
                {showUnscheduled ? (
                  <div className="grid max-h-64 gap-1 overflow-auto pr-1">
                    {result.skipped.map((item) => (
                      <div className="grid gap-0.5 rounded-hcbSm px-1 py-1 text-[var(--text-xs)]" key={item.taskId}>
                        <span className="truncate text-text-secondary">{item.taskTitle} · {item.durationMinutes} min{item.usesDefaultDuration ? " estimate" : ""}{item.dueDate ? ` · Due ${smartDueLabel(item.dueDate, date)}` : ""}</span>
                        <span className="text-text-muted">{item.reason}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
