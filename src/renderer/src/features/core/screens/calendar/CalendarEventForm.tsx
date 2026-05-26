import type { ReactNode } from "react";
import { Bell, CalendarPlus, Clock3, FileText, Gift, ListPlus, MapPin, RotateCcw, Users, type LucideIcon } from "lucide-react";
import { Badge, Input, cx } from "../../../../components/primitives";
import { ErrorState } from "../../../../components/states";
import type { useCoreViewModelSource } from "../../coreViewModelSource";
import { MarkdownPreview } from "../../MarkdownPreview";
import {
  addUtcDaysIso,
  dateInputToIso,
  dateInputValue,
  dateTimeLocalInputToIso,
  dateTimeLocalInputValue,
  startOfUtcDayIso
} from "../../coreScreenShared";
import { CalendarSourceSwatch } from "./CalendarEventChips";
import {
  allDayEndInputValue,
  calendarDraftDurationLabel,
  calendarDraftRangeLabel,
  calendarRecurrenceSummary
} from "./drafts";
import type { CalendarCreateMode, CalendarEventDraft, CalendarRepeatFrequency } from "./types";

function DetailItem({
  children,
  icon: Icon,
  label
}: {
  children: ReactNode;
  icon?: LucideIcon;
  label: string;
}): JSX.Element {
  return (
    <div className="grid gap-1 rounded-hcbMd border border-border bg-bg-tertiary p-3">
      <div className="inline-flex items-center gap-1 text-[var(--text-xs)] font-semibold uppercase text-text-muted">
        {Icon ? <Icon aria-hidden="true" size={13} /> : null}
        {label}
      </div>
      <div className="min-w-0 text-[var(--text-base)] text-text-primary">{children}</div>
    </div>
  );
}

export function CalendarEventDetails({
  calendars,
  defaultTimeZone,
  draft
}: {
  calendars: ReturnType<typeof useCoreViewModelSource>["calendarSources"];
  defaultTimeZone: string;
  draft: CalendarEventDraft;
}): JSX.Element {
  const selectedCalendar = calendars.find((calendar) => calendar.id === draft.calendarId);
  const sourceTimeZone = selectedCalendar?.timeZone ?? defaultTimeZone;
  const guests = draft.guests
    .split(",")
    .map((guest) => guest.trim())
    .filter(Boolean);
  const reminderLabel = draft.reminderMinutes.trim()
    ? `${draft.reminderMinutes.trim()} minutes before`
    : "None";

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 rounded-hcbLg border border-border bg-bg-tertiary p-4">
        <div className="flex min-w-0 items-center gap-2">
          <CalendarSourceSwatch calendarId={draft.calendarId} color={selectedCalendar?.backgroundColor} />
          <span className="min-w-0 flex-1 truncate text-[var(--text-sm)] font-semibold text-text-secondary">
            {selectedCalendar?.title ?? "Calendar"}
          </span>
          {draft.mutationState && draft.mutationState !== "synced" ? (
            <Badge tone={draft.mutationState === "failed" ? "danger" : "warning"}>
              {draft.mutationState === "failed" ? "Failed" : "Queued"}
            </Badge>
          ) : (
            <Badge tone="success">Synced</Badge>
          )}
        </div>
        <h3 className="text-[var(--text-xl)] font-semibold leading-snug text-text-primary">
          {draft.title || "Untitled event"}
        </h3>
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-[var(--text-xs)] text-text-muted">
          <span className="inline-flex min-w-0 items-center gap-1">
            <Clock3 aria-hidden="true" size={13} />
            <span className="truncate">{calendarDraftRangeLabel(draft)}</span>
          </span>
          <Badge tone="neutral">{calendarDraftDurationLabel(draft)}</Badge>
          <Badge tone="neutral">{sourceTimeZone}</Badge>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <DetailItem icon={Clock3} label="Time">
          <div className="grid gap-1">
            <span>{calendarDraftRangeLabel(draft)}</span>
            <span className="text-[var(--text-sm)] text-text-muted">{sourceTimeZone}</span>
          </div>
        </DetailItem>
        <DetailItem icon={RotateCcw} label="Repeat">
          {calendarRecurrenceSummary(draft)}
        </DetailItem>
        <DetailItem icon={MapPin} label="Location">
          {draft.location.trim() || <span className="text-text-muted">No location</span>}
        </DetailItem>
        <DetailItem icon={Bell} label="Reminder">
          {reminderLabel}
        </DetailItem>
      </div>

      <DetailItem icon={Users} label="Guests">
        {guests.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {guests.map((guest) => (
              <Badge key={guest} tone="neutral">
                {guest}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-text-muted">No guests</span>
        )}
      </DetailItem>

      <DetailItem icon={FileText} label="Notes">
        {draft.notes.trim() ? (
          <MarkdownPreview
            ariaLabel="Event notes preview"
            body={draft.notes}
            emptyDescription="No notes"
            emptyTitle="No notes"
            variant="plain"
          />
        ) : (
          <span className="text-text-muted">No notes</span>
        )}
      </DetailItem>
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
  onCreateModeChange: (mode: CalendarCreateMode) => void;
  setDraft: (draft: CalendarEventDraft) => void;
  setTaskListId: (listId: string) => void;
  taskListId: string;
  taskLists: ReturnType<typeof useCoreViewModelSource>["taskLists"];
}): JSX.Element {
  const selectedCalendar = calendars.find((calendar) => calendar.id === draft.calendarId);
  const sourceTimeZone = selectedCalendar?.timeZone ?? defaultTimeZone;

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
      endsAt: currentEnd <= Date.parse(startsAt) ? new Date(minimumEnd).toISOString() : draft.endsAt
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
      repeatFrequency: createMode === "birthday" ? "yearly" : draft.repeatFrequency
    });
  }

  if (draft.mode === "create" && createMode === "task") {
    return (
      <div className="grid gap-3">
        <CalendarCreateModeTabs mode={createMode} onChange={onCreateModeChange} />
        {error ? <ErrorState description={error} title="Task not saved" /> : null}
        <Input
          aria-label="Task title"
          autoFocus
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          placeholder="New task"
          value={draft.title}
        />
        <textarea
          aria-label="Task notes"
          className="min-h-32 w-full resize-none rounded-hcbMd border border-border bg-surface-0 px-3 py-2 text-[var(--text-base)] text-text-primary placeholder:text-text-muted transition-colors duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
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
        <Input
          aria-label="Birthday title"
          autoFocus
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
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
          <CalendarSourceSwatch calendarId={draft.calendarId} color={selectedCalendar?.backgroundColor} />
          <span className="min-w-0 flex-1 truncate text-[var(--text-sm)] font-semibold text-text-primary">
            {selectedCalendar?.title ?? "Calendar"}
          </span>
          {draft.mutationState && draft.mutationState !== "synced" ? (
            <Badge tone={draft.mutationState === "failed" ? "danger" : "warning"}>
              {draft.mutationState === "failed" ? "Failed" : "Queued"}
            </Badge>
          ) : (
            <Badge tone="success">Synced</Badge>
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-[var(--text-xs)] text-text-muted">
          <span className="inline-flex min-w-0 items-center gap-1">
            <Clock3 aria-hidden="true" size={13} />
            <span className="truncate">{calendarDraftRangeLabel(draft)}</span>
          </span>
          <Badge tone="neutral">{calendarDraftDurationLabel(draft)}</Badge>
          <Badge tone="neutral">{sourceTimeZone}</Badge>
        </div>
      </div>
      <Input
        aria-label="Event title"
        onChange={(event) => setDraft({ ...draft, title: event.target.value })}
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
                : setDraft({ ...draft, startsAt: dateTimeLocalInputToIso(event.target.value) })
            }
            type={draft.allDay ? "date" : "datetime-local"}
            value={draft.allDay ? dateInputValue(draft.startsAt) : dateTimeLocalInputValue(draft.startsAt)}
          />
          <Input
            aria-label="Event ends"
            min={draft.allDay ? dateInputValue(draft.startsAt) : undefined}
            onChange={(event) =>
              draft.allDay
                ? setAllDayEnd(event.target.value)
                : setDraft({ ...draft, endsAt: dateTimeLocalInputToIso(event.target.value) })
            }
            type={draft.allDay ? "date" : "datetime-local"}
            value={draft.allDay ? allDayEndInputValue(draft.endsAt) : dateTimeLocalInputValue(draft.endsAt)}
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
                setDraft({ ...draft, repeatFrequency: event.target.value as CalendarRepeatFrequency })
              }
              value={draft.repeatFrequency}
            >
              <option value="none">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </label>
          <Input
            aria-label="Repeat interval"
            disabled={draft.repeatFrequency === "none"}
            min={1}
            max={366}
            onChange={(event) => setDraft({ ...draft, repeatInterval: event.target.value })}
            type="number"
            value={draft.repeatInterval}
          />
          <Input
            aria-label="Repeat end date"
            disabled={draft.repeatFrequency === "none"}
            onChange={(event) => setDraft({ ...draft, repeatEndsOn: event.target.value })}
            type="date"
            value={draft.repeatEndsOn}
          />
          <Input
            aria-label="Repeat count"
            disabled={draft.repeatFrequency === "none"}
            min={1}
            max={366}
            onChange={(event) => setDraft({ ...draft, repeatCount: event.target.value })}
            placeholder="Occurrences"
            type="number"
            value={draft.repeatCount}
          />
        </div>
        <div className="text-[var(--text-xs)] text-text-muted">{calendarRecurrenceSummary(draft)}</div>
      </fieldset>
      <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
        <span className="inline-flex items-center gap-1">
          <FileText aria-hidden="true" size={13} />
          Notes
        </span>
        <textarea
          aria-label="Event notes"
          className="min-h-24 w-full resize-none rounded-hcbMd border border-border bg-surface-0 px-3 py-2 text-[var(--text-base)] text-text-primary placeholder:text-text-muted transition-colors duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
          placeholder="Notes"
          value={draft.notes}
        />
      </label>
    </div>
  );
}
