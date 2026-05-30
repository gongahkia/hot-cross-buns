import { useMemo } from "react";
import { CalendarPlus, Copy, Eye, EyeOff, MapPin, Minus, X } from "lucide-react";
import { Badge, Button, IconButton, Input, Panel, cx } from "../../../../components/primitives";
import { EmptyState, ErrorState } from "../../../../components/states";
import type { useCoreViewModelSource } from "../../coreViewModelSource";
import type { CalendarEventViewModel } from "../../coreViewModels";
import type { CalendarSourceViewModel, CompactTone } from "../../coreScreenShared";
import { CalendarSourceSwatch } from "./CalendarEventChips";
import { calendarTimeBlockLabel, sortedCalendarTimeBlocks } from "./calendarGrid";
import type { CalendarTimeBlock } from "./types";

export function calendarStatusSummary(source: ReturnType<typeof useCoreViewModelSource>): {
  detail: string;
  label: string;
  tone: CompactTone;
} {
  if (source.isOffline) {
    return {
      detail: source.errorMessage ?? "Local cache only",
      label: "Offline",
      tone: "warning"
    };
  }

  if (source.dataState === "error") {
    return {
      detail: source.errorMessage ?? "Refresh failed",
      label: "Cache error",
      tone: "danger"
    };
  }

  if (source.isStale || source.dataState === "stale" || source.syncStatus.stale) {
    return {
      detail: "Cached rows visible",
      label: "Refreshing",
      tone: "info"
    };
  }

  if (source.syncStatus.state === "running") {
    return {
      detail: "Sync in progress",
      label: "Syncing",
      tone: "info"
    };
  }

  if (source.syncStatus.pendingMutationCount > 0) {
    return {
      detail: `${source.syncStatus.pendingMutationCount} pending write${source.syncStatus.pendingMutationCount === 1 ? "" : "s"}`,
      label: "Pending",
      tone: "warning"
    };
  }

  return {
    detail: source.syncStatus.lastCompletedAt ? "Fresh local cache" : "Local cache",
    label: "Ready",
    tone: "success"
  };
}

export function CalendarStatusStrip({
  source,
  visibleCalendarCount
}: {
  source: ReturnType<typeof useCoreViewModelSource>;
  visibleCalendarCount: number;
}): JSX.Element {
  const status = calendarStatusSummary(source);

  return (
    <div
      aria-label="Calendar status"
      className="flex min-w-0 flex-wrap items-center justify-end gap-2"
      role="status"
    >
      <Badge title={status.detail} tone={status.tone}>{status.label}</Badge>
      <Badge tone="accent">Visible calendars: {visibleCalendarCount}</Badge>
    </div>
  );
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
          description="No calendars have been cached yet."
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
          <button
            className="grid w-full gap-2 rounded-hcbMd border border-border bg-bg-tertiary p-3 text-left transition-colors duration-fast ease-hcb hover:bg-surface-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
  onCopySnippet,
  onCreateHolds,
  onDurationChange,
  onEndDateChange,
  onExportAvailability,
  onRemoveSlot,
  onStartDateChange,
  onTitleChange,
  pending,
  pendingHoldCount,
  slots,
  snippet,
  startDate,
  timeZone,
  title
}: {
  calendarId: string;
  calendars: ReturnType<typeof useCoreViewModelSource>["calendarSources"];
  durationMinutes: number;
  endDate: string;
  error?: string;
  exportBusyBlockCount: number | null;
  exportPending: boolean;
  exportText: string;
  onCalendarChange: (calendarId: string) => void;
  onClose: () => void;
  onCopySnippet: () => void;
  onCreateHolds: () => void;
  onDurationChange: (duration: number) => void;
  onEndDateChange: (date: string) => void;
  onExportAvailability: () => void;
  onRemoveSlot: (slotId: string) => void;
  onStartDateChange: (date: string) => void;
  onTitleChange: (title: string) => void;
  pending: boolean;
  pendingHoldCount: number;
  slots: CalendarTimeBlock[];
  snippet: string;
  startDate: string;
  timeZone: string;
  title: string;
}): JSX.Element {
  const sortedSlots = useMemo(() => sortedCalendarTimeBlocks(slots), [slots]);
  const selectClass =
    "h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

  return (
    <Panel className="flex h-full min-h-[680px] flex-col overflow-hidden">
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="inline-flex min-w-0 items-center gap-2">
          <CalendarPlus aria-hidden="true" className="text-accent" size={16} />
          <h2 className="truncate text-[var(--text-md)] font-semibold text-text-primary">Share Availability</h2>
        </div>
        <IconButton icon={X} label="Close share availability" onClick={onClose} size="sm" variant="ghost" />
      </div>
      <div className="grid min-h-0 flex-1 auto-rows-max content-start gap-3 overflow-auto p-3">
        <Input
          aria-label="Availability title"
          onChange={(event) => onTitleChange(event.target.value)}
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
                  <span className="truncate">{calendarTimeBlockLabel(slot)}</span>
                  <IconButton
                    icon={Minus}
                    label={`Remove ${calendarTimeBlockLabel(slot)}`}
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
            <Button disabled={sortedSlots.length === 0} onClick={onCopySnippet} size="sm" variant="secondary">
              <Copy aria-hidden="true" size={14} />
              Copy
            </Button>
          </div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-hcbMd border border-border bg-surface-0 p-3 font-mono text-[var(--text-xs)] text-text-secondary">
            {snippet}
          </pre>
        </div>
        <div className="border-t border-border pt-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[var(--text-sm)] font-semibold text-text-primary">Pending Holds</h3>
            <Badge tone={pendingHoldCount > 0 ? "warning" : "neutral"}>{pendingHoldCount}</Badge>
          </div>
          <p className="mt-2 text-[var(--text-sm)] text-text-muted">
            {pendingHoldCount > 0 ? "Calendar writes are queued locally." : "No pending holds."}
          </p>
        </div>
      </div>
    </Panel>
  );
}
