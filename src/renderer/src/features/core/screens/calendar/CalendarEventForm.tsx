import type { ReactNode } from "react";
import {
  googleCalendarEventColor,
  googleCalendarEventColors,
  type SettingsSnapshot
} from "@shared/ipc/contracts";
import { Bell, CalendarPlus, Clock3, ExternalLink, FileText, Gift, ListPlus, MapPin, Phone, RotateCcw, Users, Video, type LucideIcon } from "lucide-react";
import { EmojiInput, EmojiTextarea } from "../../../../components/EmojiTextField";
import { Badge, Input, cx } from "../../../../components/primitives";
import { ErrorState } from "../../../../components/states";
import type { useCoreViewModelSource } from "../../coreViewModelSource";
import { MarkdownPreview } from "../../MarkdownPreview";
import {
  addUtcDaysIso,
  dateInputToIso,
  dateInputValue,
  startOfUtcDayIso
} from "../../coreScreenShared";
import { CalendarSourceSwatch } from "./CalendarEventChips";
import {
  calendarDateTimeLocalInputToIso,
  calendarDateTimeLocalInputValue
} from "./calendarDateUtils";
import {
  allDayEndInputValue,
  calendarDraftDurationLabel,
  calendarDraftRangeLabel,
  calendarRecurrenceSummary
} from "./drafts";
import type { CalendarCreateMode, CalendarEventDraft, CalendarRepeatFrequency, CalendarRepeatWeekday } from "./types";

const repeatWeekdays: Array<{ id: CalendarRepeatWeekday; label: string }> = [
  { id: "SU", label: "S" },
  { id: "MO", label: "M" },
  { id: "TU", label: "T" },
  { id: "WE", label: "W" },
  { id: "TH", label: "T" },
  { id: "FR", label: "F" },
  { id: "SA", label: "S" }
];

type CalendarSource = ReturnType<typeof useCoreViewModelSource>["calendarSources"][number];
type CalendarEventColorOverrides = SettingsSnapshot["calendarEventColorOverrides"];

function repeatWeekdayForIso(value: string): CalendarRepeatWeekday {
  const date = new Date(value);
  return repeatWeekdays[Number.isFinite(date.getTime()) ? date.getUTCDay() : 0]?.id ?? "SU";
}

function DetailLine({
  children,
  icon: Icon,
  label
}: {
  children: ReactNode;
  icon?: LucideIcon;
  label?: string;
}): JSX.Element {
  return (
    <div className="grid grid-cols-[18px_minmax(0,1fr)] gap-3">
      <div className="pt-0.5 text-text-muted">
        {Icon ? <Icon aria-hidden="true" size={16} /> : null}
      </div>
      <div className="min-w-0">
        {label ? (
          <div className="text-[var(--text-xs)] font-semibold uppercase text-text-muted">{label}</div>
        ) : null}
        <div className="min-w-0 text-[var(--text-base)] leading-relaxed text-text-primary">{children}</div>
      </div>
    </div>
  );
}

function calendarReminderSummary(value: string): string {
  const minutes = Number.parseInt(value.trim(), 10);

  if (!Number.isInteger(minutes) || minutes < 0) {
    return "None";
  }

  if (minutes === 0) {
    return "At start";
  }

  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"} before`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return `${hours} hr ${remainingMinutes} min before`;
}

function eventDurationVisible(draft: CalendarEventDraft): boolean {
  if (draft.allDay) {
    return Date.parse(draft.endsAt) - Date.parse(draft.startsAt) > 24 * 60 * 60 * 1000;
  }

  return true;
}

function eventCrossesDate(draft: CalendarEventDraft): boolean {
  return draft.allDay
    ? Date.parse(draft.endsAt) - Date.parse(draft.startsAt) > 24 * 60 * 60 * 1000
    : dateInputValue(draft.startsAt) !== dateInputValue(draft.endsAt);
}

function calendarDetailRangeLabel(draft: CalendarEventDraft): string {
  if (!eventCrossesDate(draft)) {
    return calendarDraftRangeLabel(draft);
  }

  if (draft.allDay) {
    return `${dateInputValue(draft.startsAt)}-${allDayEndInputValue(draft.endsAt)} · All day`;
  }

  return `${dateInputValue(draft.startsAt)} · ${draft.startsAt.slice(11, 16)}-${dateInputValue(draft.endsAt)} · ${draft.endsAt.slice(11, 16)}`;
}

function visibleConferenceLabel(value: string | undefined): string | undefined {
  const label = value?.trim();
  return label ? label.replace(/^https?:\/\//, "") : undefined;
}

function CalendarConferenceDetails({ conference }: { conference: CalendarEventDraft["conference"] }): JSX.Element | null {
  if (!conference) {
    return null;
  }

  const joinLabel = conference.solutionName ? `Join with ${conference.solutionName}` : "Join with Google Meet";
  const videoLabel = visibleConferenceLabel(conference.videoLabel) ?? visibleConferenceLabel(conference.videoUri);
  const phoneLabel = visibleConferenceLabel(conference.phoneLabel) ?? visibleConferenceLabel(conference.phoneUri);
  const moreLabel = visibleConferenceLabel(conference.moreLabel) ?? visibleConferenceLabel(conference.moreUri) ?? "More phone numbers";

  if (!conference.videoUri && !conference.phoneUri && !conference.moreUri) {
    return null;
  }

  return (
    <div className="grid gap-4">
      {conference.videoUri ? (
        <DetailLine icon={Video}>
          <a
            className="inline-flex items-center gap-1 text-accent hover:underline"
            href={conference.videoUri}
            rel="noreferrer"
            target="_blank"
          >
            {joinLabel}
            <ExternalLink aria-hidden="true" size={14} />
          </a>
          {videoLabel ? <div className="text-[var(--text-sm)] text-text-muted">{videoLabel}</div> : null}
        </DetailLine>
      ) : null}
      {conference.phoneUri || phoneLabel ? (
        <DetailLine icon={Phone}>
          {conference.phoneUri ? (
            <a className="text-accent hover:underline" href={conference.phoneUri}>
              Join by phone
            </a>
          ) : (
            <span>Join by phone</span>
          )}
          <div className="text-[var(--text-sm)] text-text-muted">
            {[phoneLabel, conference.phonePin ? `PIN: ${conference.phonePin}` : null]
              .filter(Boolean)
              .join(" ")}
          </div>
        </DetailLine>
      ) : null}
      {conference.moreUri ? (
        <DetailLine icon={ExternalLink}>
          <a className="text-accent hover:underline" href={conference.moreUri} rel="noreferrer" target="_blank">
            {moreLabel}
          </a>
        </DetailLine>
      ) : null}
    </div>
  );
}

function draftDisplayColor(
  draft: CalendarEventDraft,
  selectedCalendar: CalendarSource | undefined,
  eventColorOverrides: CalendarEventColorOverrides
): { background: string | null; foreground: string | null } {
  const googleColor = googleCalendarEventColor(draft.colorId || null);
  const override = googleColor ? eventColorOverrides[googleColor.id] : undefined;

  if (override) {
    return override;
  }

  if (googleColor) {
    return { background: googleColor.background, foreground: googleColor.foreground };
  }

  return {
    background: selectedCalendar?.backgroundColor ?? null,
    foreground: selectedCalendar?.foregroundColor ?? null
  };
}

function EventColorSelect({
  draft,
  eventColorOverrides,
  selectedCalendar,
  setDraft
}: {
  draft: CalendarEventDraft;
  eventColorOverrides: CalendarEventColorOverrides;
  selectedCalendar: CalendarSource | undefined;
  setDraft: (draft: CalendarEventDraft) => void;
}): JSX.Element {
  const displayColor = draftDisplayColor(draft, selectedCalendar, eventColorOverrides);

  return (
    <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
      <span>Color</span>
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="h-5 w-5 shrink-0 rounded-hcbSm border border-border"
          style={{
            backgroundColor: displayColor.background ?? undefined,
            borderColor: displayColor.background ?? undefined
          }}
        />
        <select
          aria-label="Event color"
          className="h-8 min-w-0 flex-1 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onChange={(event) => setDraft({ ...draft, colorId: event.target.value })}
          value={draft.colorId}
        >
          <option value="">Calendar default</option>
          {googleCalendarEventColors.map((color) => (
            <option key={color.id} value={color.id}>
              {eventColorOverrides[color.id] ? `${color.label} (custom)` : color.label}
            </option>
          ))}
        </select>
      </div>
    </label>
  );
}

export function CalendarEventDetails({
  calendars,
  defaultTimeZone,
  draft,
  eventColorOverrides
}: {
  calendars: ReturnType<typeof useCoreViewModelSource>["calendarSources"];
  defaultTimeZone: string;
  draft: CalendarEventDraft;
  eventColorOverrides: CalendarEventColorOverrides;
}): JSX.Element {
  const selectedCalendar = calendars.find((calendar) => calendar.id === draft.calendarId);
  const displayColor = draftDisplayColor(draft, selectedCalendar, eventColorOverrides);
  const sourceTimeZone = selectedCalendar?.timeZone ?? defaultTimeZone;
  const guests = draft.guests
    .split(",")
    .map((guest) => guest.trim())
    .filter(Boolean);
  const reminderLabel = draft.reminderMinutes.trim()
    ? calendarReminderSummary(draft.reminderMinutes)
    : null;
  const repeats = draft.repeatFrequency !== "none";
  const showSourceTimeZone = sourceTimeZone !== defaultTimeZone;
  const location = draft.location.trim();
  const notes = draft.notes.trim();
  const showReminder = reminderLabel !== null && reminderLabel !== "None";

  return (
    <div className="grid gap-5 py-1">
      <div className="grid grid-cols-[24px_minmax(0,1fr)] gap-4">
        <CalendarSourceSwatch
          calendarId={draft.calendarId}
          className="mt-2 size-3.5 rounded-hcbSm"
          color={displayColor.background}
        />
        <div className="min-w-0">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <h3 className="min-w-0 break-words text-[var(--text-2xl)] font-semibold leading-tight text-text-primary">
              {draft.title || "Untitled event"}
            </h3>
          </div>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-[var(--text-base)] text-text-secondary">
            <span>{calendarDetailRangeLabel(draft)}</span>
            {eventDurationVisible(draft) ? <Badge tone="neutral">{calendarDraftDurationLabel(draft)}</Badge> : null}
            {selectedCalendar?.title ? <Badge tone="neutral">{selectedCalendar.title}</Badge> : null}
            {showSourceTimeZone ? <Badge tone="neutral">{sourceTimeZone}</Badge> : null}
          </div>
        </div>
      </div>

      {notes ? (
        <DetailLine icon={FileText}>
          <MarkdownPreview
            ariaLabel="Event notes preview"
            body={notes}
            emptyDescription="No notes"
            emptyTitle="No notes"
            variant="plain"
          />
        </DetailLine>
      ) : null}

      {showReminder ? (
        <DetailLine icon={Bell}>
          {reminderLabel}
        </DetailLine>
      ) : null}

      <CalendarConferenceDetails conference={draft.conference} />

      {location ? (
        <DetailLine icon={MapPin}>
          {location}
        </DetailLine>
      ) : null}

      {guests.length > 0 ? (
        <DetailLine icon={Users}>
          <div className="flex flex-wrap gap-2">
            {guests.map((guest) => (
              <Badge key={guest} tone="neutral">
                {guest}
              </Badge>
            ))}
          </div>
        </DetailLine>
      ) : null}

      {repeats ? (
        <DetailLine icon={RotateCcw}>
          {calendarRecurrenceSummary(draft)}
        </DetailLine>
      ) : null}
    </div>
  );
}

function CalendarCreateModeTabs({
  mode,
  onChange
}: {
  mode: CalendarCreateMode;
  onChange: (mode: CalendarCreateMode) => void;
}): JSX.Element {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-hcbMd bg-surface-0 p-1" role="tablist" aria-label="Create item type">
      {([
        { id: "event" as const, label: "Event", icon: CalendarPlus },
        { id: "task" as const, label: "Task", icon: ListPlus },
        { id: "birthday" as const, label: "Birthday", icon: Gift }
      ]).map((item) => {
        const Icon = item.icon;
        const active = item.id === mode;

        return (
          <button
            aria-selected={active}
            className={cx(
              "inline-flex min-h-8 items-center justify-center gap-2 rounded-hcbSm px-2 text-[var(--text-sm)] font-medium transition-colors duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              active ? "bg-accent text-bg-tertiary" : "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
            )}
            key={item.id}
            onClick={() => onChange(item.id)}
            role="tab"
            type="button"
          >
            <Icon aria-hidden="true" size={14} />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export function CalendarEventForm({
  calendars,
  createMode,
  defaultTimeZone,
  draft,
  error,
  eventColorOverrides,
  onCreateModeChange,
  setDraft,
  setTaskListId,
  taskListId,
  taskLists
}: {
  calendars: ReturnType<typeof useCoreViewModelSource>["calendarSources"];
  createMode: CalendarCreateMode;
  defaultTimeZone: string;
  draft: CalendarEventDraft;
  error?: string;
  eventColorOverrides: CalendarEventColorOverrides;
  onCreateModeChange: (mode: CalendarCreateMode) => void;
  setDraft: (draft: CalendarEventDraft) => void;
  setTaskListId: (listId: string) => void;
  taskListId: string;
  taskLists: ReturnType<typeof useCoreViewModelSource>["taskLists"];
}): JSX.Element {
  const selectedCalendar = calendars.find((calendar) => calendar.id === draft.calendarId);
  const displayColor = draftDisplayColor(draft, selectedCalendar, eventColorOverrides);
  const sourceTimeZone = selectedCalendar?.timeZone ?? defaultTimeZone;
  const showSourceTimeZone = sourceTimeZone !== defaultTimeZone;

  function setAllDay(allDay: boolean): void {
    if (allDay) {
      const startsAt = startOfUtcDayIso(draft.startsAt);
      setDraft({
        ...draft,
        allDay,
        startsAt,
        endsAt: addUtcDaysIso(startsAt, 1)
      });
      return;
    }

    const startsAt = `${dateInputValue(draft.startsAt)}T09:00:00.000Z`;
    setDraft({
      ...draft,
      allDay,
      startsAt,
      endsAt: new Date(Date.parse(startsAt) + 60 * 60 * 1000).toISOString()
    });
  }

  function setAllDayStart(value: string): void {
    const startsAt = dateInputToIso(value);
    const currentEnd = Date.parse(draft.endsAt);
    const minimumEnd = Date.parse(addUtcDaysIso(startsAt, 1));
    setDraft({
      ...draft,
      startsAt,
      endsAt: currentEnd <= Date.parse(startsAt) ? new Date(minimumEnd).toISOString() : draft.endsAt,
      repeatWeekdays: [repeatWeekdayForIso(startsAt)]
    });
  }

  function setAllDayEnd(value: string): void {
    setDraft({
      ...draft,
      endsAt: addUtcDaysIso(dateInputToIso(value), 1)
    });
  }

  function setCreateDate(value: string): void {
    const startsAt = dateInputToIso(value);
    setDraft({
      ...draft,
      allDay: true,
      startsAt,
      endsAt: addUtcDaysIso(startsAt, 1),
      repeatFrequency: createMode === "birthday" ? "yearly" : draft.repeatFrequency,
      repeatWeekdays: [repeatWeekdayForIso(startsAt)]
    });
  }

  function setRepeatFrequency(value: CalendarRepeatFrequency): void {
    if (value === "none") {
      setDraft({
        ...draft,
        repeatFrequency: "none",
        repeatEndMode: "never",
        repeatEndsOn: "",
        repeatCount: ""
      });
      return;
    }

    if (value === "custom") {
      setDraft({
        ...draft,
        repeatFrequency: "custom",
        repeatCustomFrequency: draft.repeatFrequency !== "none" && draft.repeatFrequency !== "custom"
          ? draft.repeatFrequency
          : draft.repeatCustomFrequency,
        repeatWeekdays: draft.repeatWeekdays.length > 0 ? draft.repeatWeekdays : [repeatWeekdayForIso(draft.startsAt)]
      });
      return;
    }

    setDraft({
      ...draft,
      repeatFrequency: value,
      repeatCustomFrequency: value,
      repeatEndMode: "never",
      repeatInterval: "1",
      repeatEndsOn: "",
      repeatCount: "",
      repeatWeekdays: value === "weekly" ? [repeatWeekdayForIso(draft.startsAt)] : draft.repeatWeekdays
    });
  }

  function toggleRepeatWeekday(day: CalendarRepeatWeekday): void {
    const current = new Set(draft.repeatWeekdays);

    if (current.has(day)) {
      if (current.size === 1) {
        return;
      }

      current.delete(day);
    } else {
      current.add(day);
    }

    setDraft({
      ...draft,
      repeatWeekdays: repeatWeekdays.map((weekday) => weekday.id).filter((weekday) => current.has(weekday))
    });
  }

  if (draft.mode === "create" && createMode === "task") {
    return (
      <div className="grid gap-3">
        <CalendarCreateModeTabs mode={createMode} onChange={onCreateModeChange} />
        {error ? <ErrorState description={error} title="Task not saved" /> : null}
        <EmojiInput
          aria-label="Task title"
          autoFocus
          onValueChange={(title) => setDraft({ ...draft, title })}
          placeholder="New task"
          value={draft.title}
        />
        <EmojiTextarea
          aria-label="Task notes"
          className="min-h-32 w-full resize-none rounded-hcbMd border border-border bg-surface-0 px-3 py-2 text-[var(--text-base)] text-text-primary placeholder:text-text-muted transition-colors duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onValueChange={(notes) => setDraft({ ...draft, notes })}
          placeholder="Notes"
          value={draft.notes}
        />
        <fieldset className="grid gap-2 rounded-hcbMd border border-border bg-bg-tertiary p-3">
          <legend className="px-1 text-[var(--text-sm)] font-medium text-text-secondary">Date & list</legend>
          <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
            <span>Date</span>
            <Input
              aria-label="Task date"
              onChange={(event) => setCreateDate(event.target.value)}
              type="date"
              value={dateInputValue(draft.startsAt)}
            />
          </label>
          <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
            <span>List</span>
            <select
              aria-label="Task list"
              className="h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              onChange={(event) => setTaskListId(event.target.value)}
              value={taskListId}
            >
              {taskLists.map((taskList) => (
                <option key={taskList.id} value={taskList.id}>
                  {taskList.title}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
      </div>
    );
  }

  if (draft.mode === "create" && createMode === "birthday") {
    return (
      <div className="grid gap-3">
        <CalendarCreateModeTabs mode={createMode} onChange={onCreateModeChange} />
        {error ? <ErrorState description={error} title="Birthday not saved" /> : null}
        <EmojiInput
          aria-label="Birthday title"
          autoFocus
          onValueChange={(title) => setDraft({ ...draft, title })}
          placeholder="Whose birthday?"
          value={draft.title}
        />
        <fieldset className="grid gap-2 rounded-hcbMd border border-border bg-bg-tertiary p-3">
          <legend className="px-1 text-[var(--text-sm)] font-medium text-text-secondary">Birthday</legend>
          <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
            <span>Date</span>
            <Input
              aria-label="Birthday date"
              onChange={(event) => setCreateDate(event.target.value)}
              type="date"
              value={dateInputValue(draft.startsAt)}
            />
          </label>
          <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
            <span>Calendar</span>
            <select
              aria-label="Birthday calendar"
              className="h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              onChange={(event) => setDraft({ ...draft, calendarId: event.target.value })}
              value={draft.calendarId}
            >
              {calendars.map((calendar) => (
                <option key={calendar.id} value={calendar.id}>
                  {calendar.title}
                </option>
              ))}
            </select>
          </label>
          <EventColorSelect
            draft={draft}
            eventColorOverrides={eventColorOverrides}
            selectedCalendar={selectedCalendar}
            setDraft={setDraft}
          />
          <p className="text-[var(--text-xs)] text-text-muted">
            Repeats yearly as an all-day calendar event.
          </p>
        </fieldset>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {draft.mode === "create" ? (
        <CalendarCreateModeTabs mode={createMode} onChange={onCreateModeChange} />
      ) : null}
      {error ? <ErrorState description={error} title="Event not saved" /> : null}
      <div
        aria-label="Event context"
        className="grid gap-2 rounded-hcbMd border border-border bg-bg-tertiary p-3"
        role="group"
      >
        <div className="flex min-w-0 items-center gap-2">
          <CalendarSourceSwatch calendarId={draft.calendarId} color={displayColor.background} />
          <span className="min-w-0 flex-1 truncate text-[var(--text-sm)] font-semibold text-text-primary">
            {selectedCalendar?.title ?? "Calendar"}
          </span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-[var(--text-xs)] text-text-muted">
          <span className="inline-flex min-w-0 items-center gap-1">
            <Clock3 aria-hidden="true" size={13} />
            <span className="truncate">{calendarDraftRangeLabel(draft)}</span>
          </span>
          <Badge tone="neutral">{calendarDraftDurationLabel(draft)}</Badge>
          {showSourceTimeZone ? <Badge tone="neutral">{sourceTimeZone}</Badge> : null}
        </div>
      </div>
      <EmojiInput
        aria-label="Event title"
        onValueChange={(title) => setDraft({ ...draft, title })}
        placeholder="Title"
        value={draft.title}
      />
      <fieldset className="grid gap-2 rounded-hcbMd border border-border bg-bg-tertiary p-3">
        <legend className="px-1 text-[var(--text-sm)] font-medium text-text-secondary">Calendar</legend>
        <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
          <span>Source</span>
          <select
            aria-label="Event calendar"
            className="h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onChange={(event) => setDraft({ ...draft, calendarId: event.target.value })}
            value={draft.calendarId}
          >
            {calendars.map((calendar) => (
              <option key={calendar.id} value={calendar.id}>
                {calendar.title}
              </option>
            ))}
          </select>
        </label>
        <EventColorSelect
          draft={draft}
          eventColorOverrides={eventColorOverrides}
          selectedCalendar={selectedCalendar}
          setDraft={setDraft}
        />
      </fieldset>
      <fieldset className="grid gap-2 rounded-hcbMd border border-border bg-bg-tertiary p-3">
        <legend className="px-1 text-[var(--text-sm)] font-medium text-text-secondary">Time</legend>
        <label className="flex min-h-8 items-center gap-2 text-[var(--text-sm)] text-text-secondary">
          <input
            checked={draft.allDay}
            className="accent-[var(--color-accent)]"
            onChange={(event) => setAllDay(event.target.checked)}
            type="checkbox"
          />
          All day
        </label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Input
            aria-label="Event starts"
            onChange={(event) =>
              draft.allDay
                ? setAllDayStart(event.target.value)
                : setDraft({ ...draft, startsAt: calendarDateTimeLocalInputToIso(event.target.value, sourceTimeZone) })
            }
            type={draft.allDay ? "date" : "datetime-local"}
            value={draft.allDay ? dateInputValue(draft.startsAt) : calendarDateTimeLocalInputValue(draft.startsAt, sourceTimeZone)}
          />
          <Input
            aria-label="Event ends"
            min={draft.allDay ? dateInputValue(draft.startsAt) : undefined}
            onChange={(event) =>
              draft.allDay
                ? setAllDayEnd(event.target.value)
                : setDraft({ ...draft, endsAt: calendarDateTimeLocalInputToIso(event.target.value, sourceTimeZone) })
            }
            type={draft.allDay ? "date" : "datetime-local"}
            value={draft.allDay ? allDayEndInputValue(draft.endsAt) : calendarDateTimeLocalInputValue(draft.endsAt, sourceTimeZone)}
          />
        </div>
      </fieldset>
      <fieldset className="grid gap-2 rounded-hcbMd border border-border bg-bg-tertiary p-3">
        <legend className="px-1 text-[var(--text-sm)] font-medium text-text-secondary">Details</legend>
        <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
          <span className="inline-flex items-center gap-1">
            <MapPin aria-hidden="true" size={13} />
            Location
          </span>
          <Input
            aria-label="Event location"
            onChange={(event) => setDraft({ ...draft, location: event.target.value })}
            placeholder="Location"
            value={draft.location}
          />
        </label>
        <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
          <span className="inline-flex items-center gap-1">
            <Users aria-hidden="true" size={13} />
            Guests
          </span>
          <Input
            aria-label="Event guests"
            onChange={(event) => setDraft({ ...draft, guests: event.target.value })}
            placeholder="guest@example.com, team@example.com"
            value={draft.guests}
          />
        </label>
        <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
          <span className="inline-flex items-center gap-1">
            <Bell aria-hidden="true" size={13} />
            Reminder
          </span>
          <select
            aria-label="Event reminder"
            className="h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onChange={(event) => setDraft({ ...draft, reminderMinutes: event.target.value })}
            value={draft.reminderMinutes}
          >
            <option value="">None</option>
            <option value="0">At start</option>
            <option value="5">5 minutes before</option>
            <option value="10">10 minutes before</option>
            <option value="15">15 minutes before</option>
            <option value="30">30 minutes before</option>
            <option value="60">1 hour before</option>
            <option value="1440">1 day before</option>
          </select>
        </label>
      </fieldset>
      <fieldset className="grid gap-2 rounded-hcbMd border border-border bg-bg-tertiary p-3">
        <legend className="px-1 text-[var(--text-sm)] font-medium text-text-secondary">
          <span className="inline-flex items-center gap-1">
            <RotateCcw aria-hidden="true" size={13} />
            Repeat
          </span>
        </legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
            <span>Frequency</span>
            <select
              aria-label="Event repeat frequency"
              className="h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              onChange={(event) =>
                setRepeatFrequency(event.target.value as CalendarRepeatFrequency)
              }
              value={draft.repeatFrequency}
            >
              <option value="none">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
              <option value="custom">Custom</option>
            </select>
          </label>
        </div>
        {draft.repeatFrequency === "custom" ? (
          <div className="grid gap-3 rounded-hcbMd border border-border bg-surface-0 p-3">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 sm:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)] sm:items-end">
              <span className="hidden pb-2 text-[var(--text-sm)] text-text-secondary sm:block">Repeat every</span>
              <Input
                aria-label="Repeat interval"
                min={1}
                max={366}
                onChange={(event) => setDraft({ ...draft, repeatInterval: event.target.value })}
                type="number"
                value={draft.repeatInterval}
              />
              <select
                aria-label="Repeat unit"
                className="h-8 rounded-hcbMd border border-border bg-bg-tertiary px-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    repeatCustomFrequency: event.target.value as CalendarEventDraft["repeatCustomFrequency"]
                  })
                }
                value={draft.repeatCustomFrequency}
              >
                <option value="daily">day</option>
                <option value="weekly">week</option>
                <option value="monthly">month</option>
                <option value="yearly">year</option>
              </select>
            </div>
            {draft.repeatCustomFrequency === "weekly" ? (
              <div className="grid gap-2">
                <span className="text-[var(--text-sm)] text-text-secondary">Repeat on</span>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Repeat weekdays">
                  {repeatWeekdays.map((weekday) => {
                    const selected = draft.repeatWeekdays.includes(weekday.id);

                    return (
                      <button
                        aria-pressed={selected}
                        className={cx(
                          "flex size-8 items-center justify-center rounded-full text-[var(--text-sm)] font-semibold transition-colors duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                          selected ? "bg-accent text-bg-tertiary" : "bg-bg-tertiary text-text-secondary hover:bg-surface-1"
                        )}
                        key={weekday.id}
                        onClick={() => toggleRepeatWeekday(weekday.id)}
                        type="button"
                      >
                        {weekday.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
            <fieldset className="grid gap-2">
              <legend className="text-[var(--text-sm)] text-text-secondary">Ends</legend>
              <label className="grid min-h-8 grid-cols-[24px_72px_minmax(0,1fr)] items-center gap-2 text-[var(--text-sm)] text-text-secondary">
                <input
                  aria-label="Repeat never"
                  checked={draft.repeatEndMode === "never"}
                  className="accent-[var(--color-accent)]"
                  onChange={() => setDraft({ ...draft, repeatEndMode: "never", repeatEndsOn: "", repeatCount: "" })}
                  type="radio"
                />
                <span>Never</span>
              </label>
              <label className="grid min-h-8 grid-cols-[24px_72px_minmax(0,1fr)] items-center gap-2 text-[var(--text-sm)] text-text-secondary">
                <input
                  aria-label="Repeat on date"
                  checked={draft.repeatEndMode === "on"}
                  className="accent-[var(--color-accent)]"
                  onChange={() => setDraft({ ...draft, repeatEndMode: "on", repeatCount: "" })}
                  type="radio"
                />
                <span>On</span>
                <Input
                  aria-label="Repeat end date"
                  disabled={draft.repeatEndMode !== "on"}
                  onChange={(event) => setDraft({ ...draft, repeatEndsOn: event.target.value })}
                  type="date"
                  value={draft.repeatEndsOn}
                />
              </label>
              <label className="grid min-h-8 grid-cols-[24px_72px_minmax(0,1fr)] items-center gap-2 text-[var(--text-sm)] text-text-secondary">
                <input
                  aria-label="Repeat after count"
                  checked={draft.repeatEndMode === "after"}
                  className="accent-[var(--color-accent)]"
                  onChange={() => setDraft({ ...draft, repeatEndMode: "after", repeatEndsOn: "" })}
                  type="radio"
                />
                <span>After</span>
                <Input
                  aria-label="Repeat count"
                  disabled={draft.repeatEndMode !== "after"}
                  min={1}
                  max={366}
                  onChange={(event) => setDraft({ ...draft, repeatCount: event.target.value })}
                  placeholder="Occurrences"
                  type="number"
                  value={draft.repeatCount}
                />
              </label>
            </fieldset>
          </div>
        ) : null}
        <div className="text-[var(--text-xs)] text-text-muted">{calendarRecurrenceSummary(draft)}</div>
      </fieldset>
      <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
        <span className="inline-flex items-center gap-1">
          <FileText aria-hidden="true" size={13} />
          Notes
        </span>
        <EmojiTextarea
          aria-label="Event notes"
          className="min-h-24 w-full resize-none rounded-hcbMd border border-border bg-surface-0 px-3 py-2 text-[var(--text-base)] text-text-primary placeholder:text-text-muted transition-colors duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onValueChange={(notes) => setDraft({ ...draft, notes })}
          placeholder="Notes"
          value={draft.notes}
        />
      </label>
    </div>
  );
}
