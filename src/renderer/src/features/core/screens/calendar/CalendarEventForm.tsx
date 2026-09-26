import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  type AutoTagRule,
  googleCalendarEventColor,
  googleCalendarEventColors,
  type SettingsSnapshot
} from "@shared/ipc/contracts";
import { Bell, BriefcaseBusiness, CalendarPlus, Check, Clock3, ExternalLink, FileText, Gift, ListPlus, MapPin, Paperclip, Phone, Plus, RotateCcw, Search, Tag, Trash2, Users, Video, X, type LucideIcon } from "lucide-react";
import { EmojiInput, EmojiTextarea } from "../../../../components/EmojiTextField";
import { Badge, Button, Input, cx } from "../../../../components/primitives";
import { ErrorState } from "../../../../components/states";
import type { useCoreViewModelSource } from "../../coreViewModelSource";
import { MarkdownPreview } from "../../MarkdownPreview";
import { TagBadges, TagInput } from "../../TagInput";
import { AutoTagAudit } from "../../AutoTagAudit";
import { EntityLinksPanel } from "../../EntityLinksPanel";
import { plannerLinkTargets } from "../../plannerLinkTargets";
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
  calendarSimpleRecurrenceLines,
  calendarRecurrenceRulePreview,
  calendarRecurrenceSummary,
  normalizeGoogleRecurrenceLines
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

function formatReminderMinutes(minutes: number): string {
  const safeMinutes = Math.max(0, Math.round(minutes));
  const days = Math.floor(safeMinutes / 1440);
  const hours = Math.floor((safeMinutes % 1440) / 60);
  const mins = safeMinutes % 60;
  const parts: string[] = [];

  if (days > 0) {
    parts.push(`${days} day${days === 1 ? "" : "s"}`);
  }

  if (hours > 0) {
    parts.push(`${hours} hr${hours === 1 ? "" : "s"}`);
  }

  if (mins > 0 || parts.length === 0) {
    parts.push(`${mins} min${mins === 1 ? "" : "s"}`);
  }

  return parts.join(" ");
}

function parseReminderMinutes(value: string): number | null {
  const trimmed = value.trim().toLowerCase();

  if (!trimmed) {
    return null;
  }

  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }

  let total = 0;
  let matched = false;
  const pattern = /(\d+)\s*(d|day|days|h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(trimmed)) !== null) {
    const amount = Number.parseInt(match[1] ?? "0", 10);
    const unit = match[2] ?? "min";
    matched = true;

    if (unit.startsWith("d")) {
      total += amount * 1440;
    } else if (unit.startsWith("h")) {
      total += amount * 60;
    } else {
      total += amount;
    }
  }

  return matched ? total : null;
}

function ReminderOffsetInput({
  label,
  minutes,
  onChange
}: {
  label: string;
  minutes: number;
  onChange: (minutes: number) => void;
}): JSX.Element {
  const [text, setText] = useState(() => formatReminderMinutes(minutes));

  useEffect(() => {
    setText(formatReminderMinutes(minutes));
  }, [minutes]);

  function commit(value: string): void {
    const parsed = parseReminderMinutes(value);

    if (parsed === null) {
      setText(formatReminderMinutes(minutes));
      return;
    }

    const nextMinutes = Math.min(40320, Math.max(0, parsed));
    onChange(nextMinutes);
    setText(formatReminderMinutes(nextMinutes));
  }

  return (
    <Input
      aria-label={label}
      onBlur={(event) => commit(event.currentTarget.value)}
      onChange={(event) => {
        const nextText = event.currentTarget.value;
        setText(nextText);
        const parsed = parseReminderMinutes(nextText);

        if (parsed !== null) {
          onChange(Math.min(40320, Math.max(0, parsed)));
        }
      }}
      onFocus={(event) => event.currentTarget.select()}
      value={text}
    />
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

function reminderSummary(method: "popup" | "email", minutes: number): string {
  const prefix = method === "email" ? "Email" : "Popup";
  return `${prefix} ${calendarReminderSummary(String(minutes)).toLocaleLowerCase()}`;
}

function calendarRemindersSummary(draft: CalendarEventDraft): string | null {
  if (draft.remindersUseDefault) {
    return "Calendar default reminders";
  }

  if (draft.reminders.length === 0) {
    return null;
  }

  return draft.reminders.map((reminder) => reminderSummary(reminder.method, reminder.minutes)).join(", ");
}

function attendeeStatusLabel(value: string | undefined): string {
  return value === "accepted"
    ? "accepted"
    : value === "declined"
      ? "declined"
      : value === "tentative"
        ? "tentative"
        : "needs action";
}

function eventDurationVisible(draft: CalendarEventDraft): boolean {
  if (draft.allDay) {
    return Date.parse(draft.endsAt) - Date.parse(draft.startsAt) > 24 * 60 * 60 * 1000;
  }

  return true;
}

function eventCrossesDate(draft: CalendarEventDraft, timeZone: string): boolean {
  return draft.allDay
    ? Date.parse(draft.endsAt) - Date.parse(draft.startsAt) > 24 * 60 * 60 * 1000
    : calendarDateTimeLocalInputValue(draft.startsAt, timeZone).slice(0, 10) !==
      calendarDateTimeLocalInputValue(draft.endsAt, timeZone).slice(0, 10);
}

function calendarDetailRangeLabel(draft: CalendarEventDraft, timeZone: string): string {
  if (!eventCrossesDate(draft, timeZone)) {
    return calendarDraftRangeLabel(draft, timeZone);
  }

  if (draft.allDay) {
    return `${dateInputValue(draft.startsAt)}-${allDayEndInputValue(draft.endsAt)} · All day`;
  }

  return calendarDraftRangeLabel(draft, timeZone);
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
  const googleColor = draft.colorId ? googleCalendarEventColor(draft.colorId) : undefined;
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
          {googleCalendarEventColors.filter((color) => color.id !== "default").map((color) => (
            <option key={color.id} value={color.id}>
              {eventColorOverrides[color.id] ? `${color.label} (custom)` : color.label}
            </option>
          ))}
        </select>
      </div>
    </label>
  );
}

function ReminderControls({
  draft,
  setDraft
}: {
  draft: CalendarEventDraft;
  setDraft: (draft: CalendarEventDraft) => void;
}): JSX.Element {
  const mode = draft.remindersUseDefault ? "default" : draft.reminders.length > 0 ? "custom" : "none";

  function setMode(value: string): void {
    if (value === "default") {
      setDraft({ ...draft, remindersUseDefault: true, reminders: [], reminderMinutes: "" });
      return;
    }

    if (value === "custom") {
      setDraft({
        ...draft,
        remindersUseDefault: false,
        reminders: draft.reminders.length > 0 ? draft.reminders : [{ method: "popup", minutes: 10 }],
        reminderMinutes: ""
      });
      return;
    }

    setDraft({ ...draft, remindersUseDefault: false, reminders: [], reminderMinutes: "" });
  }

  function setReminder(index: number, patch: Partial<CalendarEventDraft["reminders"][number]>): void {
    setDraft({
      ...draft,
      reminders: draft.reminders.map((reminder, reminderIndex) =>
        reminderIndex === index ? { ...reminder, ...patch } : reminder
      )
    });
  }

  return (
    <div className="grid gap-2">
      <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
        <span className="inline-flex items-center gap-1">
          <Bell aria-hidden="true" size={13} />
          Reminders
        </span>
        <select
          aria-label="Event reminder mode"
          className="h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onChange={(event) => setMode(event.target.value)}
          value={mode}
        >
          <option value="default">Calendar default</option>
          <option value="none">None</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      {mode === "custom" ? (
        <div className="grid gap-2">
          {draft.reminders.map((reminder, index) => (
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(9rem,0.55fr)_32px] gap-2" key={`${reminder.method}-${index}`}>
              <select
                aria-label={`Reminder ${index + 1} method`}
                className="h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary"
                onChange={(event) => setReminder(index, { method: event.target.value as "popup" | "email" })}
                value={reminder.method}
              >
                <option value="popup">Popup</option>
                <option value="email">Email</option>
              </select>
              <ReminderOffsetInput
                label={`Reminder ${index + 1} offset`}
                minutes={reminder.minutes}
                onChange={(minutes) => setReminder(index, { minutes })}
              />
              <button
                aria-label={`Remove reminder ${index + 1}`}
                className="grid size-8 place-items-center rounded-hcbMd border border-border bg-surface-0 text-text-muted hover:bg-danger/10 hover:text-danger"
                onClick={() => setDraft({ ...draft, reminders: draft.reminders.filter((_, reminderIndex) => reminderIndex !== index) })}
                type="button"
              >
                <Trash2 aria-hidden="true" size={14} />
              </button>
            </div>
          ))}
          <button
            className="inline-flex h-8 items-center justify-center gap-2 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-sm)] font-medium text-text-secondary hover:bg-surface-1"
            onClick={() => setDraft({ ...draft, reminders: [...draft.reminders, { method: "popup" as const, minutes: 10 }].slice(0, 10) })}
            type="button"
          >
            <Plus aria-hidden="true" size={14} />
            Add reminder
          </button>
        </div>
      ) : null}
    </div>
  );
}

function PrivacyControls({
  draft,
  setDraft
}: {
  draft: CalendarEventDraft;
  setDraft: (draft: CalendarEventDraft) => void;
}): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
        <span>Show as</span>
        <select
          aria-label="Event transparency"
          className="h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary"
          onChange={(event) => setDraft({ ...draft, transparency: event.target.value as CalendarEventDraft["transparency"] })}
          value={draft.transparency ?? "opaque"}
        >
          <option value="opaque">Busy</option>
          <option value="transparent">Free</option>
        </select>
      </label>
      <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
        <span>Visibility</span>
        <select
          aria-label="Event visibility"
          className="h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary"
          onChange={(event) => setDraft({ ...draft, visibility: event.target.value as CalendarEventDraft["visibility"] })}
          value={draft.visibility ?? "default"}
        >
          <option value="default">Default</option>
          <option value="public">Public</option>
          <option value="private">Private</option>
        </select>
      </label>
    </div>
  );
}

function MeetControl({
  draft,
  setDraft
}: {
  draft: CalendarEventDraft;
  setDraft: (draft: CalendarEventDraft) => void;
}): JSX.Element {
  if (draft.conference?.videoUri) {
    return <CalendarConferenceDetails conference={draft.conference} />;
  }

  return (
    <label className="flex min-h-8 items-center gap-2 text-[var(--text-sm)] text-text-secondary">
      <input
        checked={draft.addMeet}
        className="accent-[var(--color-accent)]"
        onChange={(event) => setDraft({ ...draft, addMeet: event.target.checked })}
        type="checkbox"
      />
      <span className="inline-flex items-center gap-1">
        <Video aria-hidden="true" size={13} />
        Add Google Meet
      </span>
    </label>
  );
}

function AttendeeStatusPreview({ draft }: { draft: CalendarEventDraft }): JSX.Element | null {
  if (draft.attendees.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {draft.attendees.map((attendee) => (
        <Badge key={attendee.email} tone="neutral">
          {attendee.email} · {attendeeStatusLabel(attendee.responseStatus)}
        </Badge>
      ))}
    </div>
  );
}

function RsvpControl({ draft, setDraft }: { draft: CalendarEventDraft; setDraft: (draft: CalendarEventDraft) => void }): JSX.Element | null {
  const self = draft.attendees.find((attendee) => attendee.self);
  if (!self) return null;
  const value = draft.selfResponseStatus ?? self.responseStatus ?? "needsAction";
  return (
    <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
      <span className="inline-flex items-center gap-1"><Check aria-hidden="true" size={13} />Your RSVP</span>
      <select
        aria-label="Your RSVP"
        className="h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onChange={(event) => {
          const responseStatus = event.target.value as NonNullable<CalendarEventDraft["selfResponseStatus"]>;
          setDraft({
            ...draft,
            selfResponseStatus: responseStatus,
            attendees: draft.attendees.map((attendee) => attendee.self ? { ...attendee, responseStatus } : attendee)
          });
        }}
        value={value}
      >
        <option value="needsAction">Needs action</option>
        <option value="accepted">Accept</option>
        <option value="tentative">Tentative</option>
        <option value="declined">Decline</option>
      </select>
    </label>
  );
}

function EventTypeControl({ draft, setDraft }: { draft: CalendarEventDraft; setDraft: (draft: CalendarEventDraft) => void }): JSX.Element {
  function setEventType(eventType: CalendarEventDraft["eventType"]): void {
    if (eventType === "focusTime") {
      setDraft({ ...draft, eventType, transparency: "opaque", visibility: "private", focusTimeProperties: draft.focusTimeProperties ?? { autoDeclineMode: "declineNone", chatStatus: "available" } });
      return;
    }
    if (eventType === "outOfOffice") {
      setDraft({ ...draft, eventType, transparency: "opaque", visibility: "public", outOfOfficeProperties: draft.outOfOfficeProperties ?? { autoDeclineMode: "declineNone" } });
      return;
    }
    if (eventType === "workingLocation") {
      setDraft({ ...draft, eventType, allDay: true, transparency: "transparent", visibility: "public", workingLocationProperties: draft.workingLocationProperties ?? { type: "homeOffice" } });
      return;
    }
    setDraft({ ...draft, eventType });
  }

  const focus = draft.focusTimeProperties ?? { autoDeclineMode: "declineNone", chatStatus: "available" };
  const outOfOffice = draft.outOfOfficeProperties ?? { autoDeclineMode: "declineNone" };
  const workingLocation = draft.workingLocationProperties ?? { type: "homeOffice" };
  const locationType = workingLocation.type === "officeLocation" || workingLocation.type === "customLocation" ? workingLocation.type : "homeOffice";

  return (
    <fieldset className="grid gap-2 rounded-hcbMd border border-border bg-bg-tertiary p-3">
      <legend className="px-1 text-[var(--text-sm)] font-medium text-text-secondary">Event type</legend>
      <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
        <span>Type</span>
        <select aria-label="Calendar event type" className="h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onChange={(event) => setEventType(event.target.value as CalendarEventDraft["eventType"])} value={draft.eventType}>
          <option value="default">Event</option>
          <option value="focusTime">Focus time</option>
          <option value="outOfOffice">Out of office</option>
          <option value="workingLocation">Working location</option>
        </select>
      </label>
      {draft.eventType !== "default" ? <p className="text-[var(--text-xs)] text-text-muted">Google supports status events only on a connected primary calendar. Their availability and visibility rules are applied automatically.</p> : null}
      {draft.eventType === "focusTime" ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary"><span>Decline conflicts</span><select aria-label="Focus time decline mode" className="h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary" value={focus.autoDeclineMode ?? "declineNone"} onChange={(event) => setDraft({ ...draft, focusTimeProperties: { ...focus, autoDeclineMode: event.target.value } })}><option value="declineNone">Do not decline</option><option value="declineAllConflictingInvitations">All conflicts</option><option value="declineOnlyNewConflictingInvitations">New conflicts</option></select></label>
          <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary"><span>Google Chat</span><select aria-label="Focus time chat status" className="h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary" value={focus.chatStatus ?? "available"} onChange={(event) => setDraft({ ...draft, focusTimeProperties: { ...focus, chatStatus: event.target.value } })}><option value="available">Available</option><option value="doNotDisturb">Do not disturb</option></select></label>
        </div>
      ) : null}
      {draft.eventType === "outOfOffice" ? <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary"><span>Decline conflicts</span><select aria-label="Out of office decline mode" className="h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary" value={outOfOffice.autoDeclineMode ?? "declineNone"} onChange={(event) => setDraft({ ...draft, outOfOfficeProperties: { ...outOfOffice, autoDeclineMode: event.target.value } })}><option value="declineNone">Do not decline</option><option value="declineAllConflictingInvitations">All conflicts</option><option value="declineOnlyNewConflictingInvitations">New conflicts</option></select></label> : null}
      {draft.eventType === "workingLocation" ? (
        <div className="grid gap-2">
          <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary"><span>Location</span><select aria-label="Working location type" className="h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary" value={locationType} onChange={(event) => setDraft({ ...draft, workingLocationProperties: { type: event.target.value } })}><option value="homeOffice">Home</option><option value="officeLocation">Office</option><option value="customLocation">Custom</option></select></label>
          {locationType === "customLocation" ? <Input aria-label="Custom working location" onChange={(event) => setDraft({ ...draft, workingLocationProperties: { type: "customLocation", customLocation: { label: event.target.value } } })} placeholder="Custom location" value={workingLocation.customLocation?.label ?? ""} /> : null}
        </div>
      ) : null}
    </fieldset>
  );
}

function AvailabilityControl({ accountId, draft }: { accountId?: string; draft: CalendarEventDraft }): JSX.Element | null {
  const [message, setMessage] = useState<string | null>(null);
  const guests = draft.guests.split(",").map((guest) => guest.trim()).filter(Boolean);
  if (guests.length === 0) return null;
  async function check(): Promise<void> {
    setMessage("Checking Google availability…");
    const result = await window.hcb?.calendar.freeBusy({ accountId, calendarIds: guests, start: draft.startsAt, end: draft.endsAt });
    if (!result?.ok) {
      setMessage(result?.error.message ?? "Availability lookup failed.");
      return;
    }
    const summaries = Object.entries(result.data.calendars as Record<string, { busy?: unknown[]; errors?: unknown[] }>)
      .map(([email, calendar]) => calendar.errors?.length ? `${email}: unavailable` : `${email}: ${calendar.busy?.length ?? 0} busy`);
    setMessage(summaries.join(" · "));
  }
  return <div className="grid gap-1"><Button onClick={() => void check()} size="sm" type="button" variant="secondary"><Users aria-hidden="true" size={14} />Check Google availability</Button>{message ? <p className="text-[var(--text-xs)] text-text-muted" role="status">{message}</p> : null}</div>;
}

function DriveAttachmentControl({ accountId, draft, setDraft }: { accountId?: string; draft: CalendarEventDraft; setDraft: (draft: CalendarEventDraft) => void }): JSX.Element | null {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Array<{ fileId?: string; fileUrl: string; title: string; mimeType?: string; iconLink?: string }>>([]);
  const [message, setMessage] = useState<string | null>(null);
  if (!accountId || accountId === "local") return null;
  async function search(): Promise<void> {
    setMessage("Searching Drive…");
    const result = await window.hcb?.google.searchDriveFiles({ accountId, query });
    if (!result?.ok) {
      setItems([]);
      setMessage(result?.error.message ?? "Drive search failed. Reconnect with Drive attachment browsing enabled.");
      return;
    }
    setItems(result.data.items ?? []);
    setMessage(result.data.items?.length ? null : "No matching Drive files.");
  }
  function add(item: typeof items[number]): void {
    if (draft.attachments.some((attachment) => attachment.fileUrl === item.fileUrl)) return;
    setDraft({ ...draft, attachments: [...draft.attachments, item] });
  }
  return (
    <div className="grid gap-2 border-t border-border pt-3">
      <div className="flex items-center gap-2 text-[var(--text-sm)] font-medium text-text-secondary"><Paperclip aria-hidden="true" size={13} />Drive attachments</div>
      <div className="flex gap-2"><Input aria-label="Search Drive files" onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} placeholder="Search files you can access" value={query} /><Button aria-label="Search Drive" onClick={() => void search()} size="sm" type="button" variant="secondary"><Search aria-hidden="true" size={14} /></Button></div>
      {items.length ? <div className="grid gap-1 rounded-hcbMd border border-border bg-surface-0 p-1">{items.map((item) => <button className="flex min-w-0 items-center gap-2 rounded-hcbSm px-2 py-1.5 text-left text-[var(--text-sm)] text-text-secondary hover:bg-bg-tertiary hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent" key={item.fileUrl} onClick={() => add(item)} type="button"><BriefcaseBusiness aria-hidden="true" size={14} /><span className="min-w-0 flex-1 truncate">{item.title}</span><Plus aria-hidden="true" size={14} /></button>)}</div> : null}
      {draft.attachments.length ? <div className="flex flex-wrap gap-1">{draft.attachments.map((attachment) => <Badge key={attachment.fileUrl} tone="neutral"><span className="max-w-40 truncate">{attachment.title}</span><button aria-label={`Remove ${attachment.title}`} className="ml-1 rounded text-text-muted hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" onClick={() => setDraft({ ...draft, attachments: draft.attachments.filter((item) => item.fileUrl !== attachment.fileUrl) })} type="button"><X aria-hidden="true" size={12} /></button></Badge>)}</div> : null}
      {message ? <p className="text-[var(--text-xs)] text-text-muted" role="status">{message}</p> : null}
    </div>
  );
}

export function CalendarEventDetails({
  calendars,
  defaultTimeZone,
  draft,
  eventColorOverrides,
  rules,
  source
}: {
  calendars: ReturnType<typeof useCoreViewModelSource>["calendarSources"];
  defaultTimeZone: string;
  draft: CalendarEventDraft;
  eventColorOverrides: CalendarEventColorOverrides;
  rules: readonly AutoTagRule[];
  source: ReturnType<typeof useCoreViewModelSource>;
}): JSX.Element {
  const selectedCalendar = calendars.find((calendar) => calendar.id === draft.calendarId);
  const displayColor = draftDisplayColor(draft, selectedCalendar, eventColorOverrides);
  const sourceTimeZone = draft.timeZone ?? selectedCalendar?.timeZone ?? defaultTimeZone;
  const guests = draft.guests
    .split(",")
    .map((guest) => guest.trim())
    .filter(Boolean);
  const reminderLabel = calendarRemindersSummary(draft) ??
    (draft.reminderMinutes.trim() ? calendarReminderSummary(draft.reminderMinutes) : null);
  const repeats = draft.repeatFrequency !== "none";
  const showSourceTimeZone = sourceTimeZone !== defaultTimeZone;
  const location = draft.location.trim();
  const notes = draft.notes.trim();
  const showReminder = reminderLabel !== null && reminderLabel !== "None";
  const completed = draft.completedAt !== null && draft.completedAt !== undefined;

  return (
    <div className={cx("grid gap-5 py-1", completed && "text-text-muted")}>
      <div className="grid grid-cols-[24px_minmax(0,1fr)] gap-4">
        <CalendarSourceSwatch
          calendarId={draft.calendarId}
          className="mt-2 size-3.5 rounded-hcbSm"
          color={displayColor.background}
        />
        <div className="min-w-0">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <h3 className={cx(
              "min-w-0 break-words text-[var(--text-2xl)] font-semibold leading-tight text-text-primary",
              completed && "text-text-muted line-through"
            )}>
              {draft.title || "Untitled event"}
            </h3>
          </div>
          <div className={cx(
            "mt-2 flex min-w-0 flex-wrap items-center gap-2 text-[var(--text-base)] text-text-secondary",
            completed && "line-through"
          )}>
            <span>{calendarDetailRangeLabel(draft, sourceTimeZone)}</span>
            {eventDurationVisible(draft) ? <Badge tone="neutral">{calendarDraftDurationLabel(draft)}</Badge> : null}
            {selectedCalendar?.title ? <Badge tone="neutral">{selectedCalendar.title}</Badge> : null}
            {showSourceTimeZone ? <Badge tone="neutral">{sourceTimeZone}</Badge> : null}
            {draft.eventType !== "default" ? <Badge tone="neutral">{draft.eventType === "focusTime" ? "Focus time" : draft.eventType === "outOfOffice" ? "Out of office" : "Working location"}</Badge> : null}
            <Badge tone="neutral">{draft.transparency === "transparent" ? "Free" : "Busy"}</Badge>
            <Badge tone="neutral">{draft.visibility === "private" ? "Private" : draft.visibility === "public" ? "Public" : "Default visibility"}</Badge>
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
            plannerLinkTargets={plannerLinkTargets(source)}
            variant="plain"
          />
        </DetailLine>
      ) : null}

      {showReminder ? (
        <DetailLine icon={Bell}>
          {reminderLabel}
        </DetailLine>
      ) : null}

      {draft.tags.length > 0 ? (
        <DetailLine icon={Tag}>
          <TagBadges tags={draft.tags} />
        </DetailLine>
      ) : null}

      <CalendarConferenceDetails conference={draft.conference} />

      {draft.attachments.length ? (
        <DetailLine icon={Paperclip} label="Drive attachments">
          <div className="grid gap-1">{draft.attachments.map((attachment) => <a className="inline-flex min-w-0 items-center gap-1 text-accent hover:underline" href={attachment.fileUrl} key={attachment.fileUrl} rel="noreferrer" target="_blank"><span className="truncate">{attachment.title}</span><ExternalLink aria-hidden="true" size={13} /></a>)}</div>
        </DetailLine>
      ) : null}

      {location ? (
        <DetailLine icon={MapPin}>
          {location}
        </DetailLine>
      ) : null}

      {guests.length > 0 ? (
        <DetailLine icon={Users}>
          <div className="flex flex-wrap gap-2">
            {(draft.attendees.length > 0 ? draft.attendees : guests.map((email) => ({ email, responseStatus: undefined }))).map((guest) => (
              <Badge key={guest.email} tone="neutral">
                {guest.email}{guest.responseStatus ? ` · ${attendeeStatusLabel(guest.responseStatus)}` : ""}
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

      <AutoTagAudit
        input={{
          kind: "event",
          title: draft.title,
          body: draft.notes,
          existingTags: draft.tags,
          existingEventColorId: draft.colorId || undefined,
          hcbKind: draft.hcbKind
        }}
        rules={rules}
      />

      {draft.id ? <EntityLinksPanel entityId={draft.id} entityKind="event" /> : null}
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
              active ? "bg-accent text-[var(--color-accent-foreground)]" : "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
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
  rules,
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
  rules: readonly AutoTagRule[];
  setDraft: (draft: CalendarEventDraft) => void;
  setTaskListId: (listId: string) => void;
  taskListId: string;
  taskLists: ReturnType<typeof useCoreViewModelSource>["taskLists"];
}): JSX.Element {
  const selectedCalendar = calendars.find((calendar) => calendar.id === draft.calendarId);
  const displayColor = draftDisplayColor(draft, selectedCalendar, eventColorOverrides);
  const sourceTimeZone = draft.timeZone ?? selectedCalendar?.timeZone ?? defaultTimeZone;
  const showSourceTimeZone = sourceTimeZone !== defaultTimeZone;
  const isBirthdayDraft = draft.hcbKind === "birthday" || (draft.mode === "create" && createMode === "birthday");

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
      repeatFrequency: isBirthdayDraft ? "yearly" : draft.repeatFrequency,
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
        <TagInput onChange={(tags) => setDraft({ ...draft, tags })} value={draft.tags} />
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

  if (isBirthdayDraft) {
    return (
      <div className="grid gap-3">
        {draft.mode === "create" ? (
          <CalendarCreateModeTabs mode={createMode} onChange={onCreateModeChange} />
        ) : null}
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
          <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
            <span className="inline-flex items-center gap-1">
              <Bell aria-hidden="true" size={13} />
              Reminder
            </span>
            <select
              aria-label="Birthday reminder"
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
            <span className="truncate">{calendarDraftRangeLabel(draft, sourceTimeZone)}</span>
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
        <PrivacyControls draft={draft} setDraft={setDraft} />
      </fieldset>
      <EventTypeControl draft={draft} setDraft={setDraft} />
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
        <AttendeeStatusPreview draft={draft} />
        <RsvpControl draft={draft} setDraft={setDraft} />
        <AvailabilityControl accountId={selectedCalendar?.accountId} draft={draft} />
        <ReminderControls draft={draft} setDraft={setDraft} />
        <MeetControl draft={draft} setDraft={setDraft} />
        <DriveAttachmentControl accountId={selectedCalendar?.accountId} draft={draft} setDraft={setDraft} />
        <TagInput onChange={(tags) => setDraft({ ...draft, tags })} value={draft.tags} />
        <AutoTagAudit
          input={{
            kind: "event",
            title: draft.title,
            body: draft.notes,
            existingTags: draft.tags,
            existingEventColorId: draft.colorId || undefined,
            requestedEventColorId: draft.colorId || undefined,
            hcbKind: draft.hcbKind
          }}
          rules={rules}
        />
      </fieldset>
      <fieldset className="grid gap-2 rounded-hcbMd border border-border bg-bg-tertiary p-3">
        <legend className="px-1 text-[var(--text-sm)] font-medium text-text-secondary">
          <span className="inline-flex items-center gap-1">
            <RotateCcw aria-hidden="true" size={13} />
            Repeat
          </span>
        </legend>
        {draft.recurrenceEditor === "simple" ? (
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
        ) : null}
        {draft.recurrenceEditor === "simple" && draft.repeatFrequency === "custom" ? (
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
                          selected ? "bg-accent text-[var(--color-accent-foreground)]" : "bg-bg-tertiary text-text-secondary hover:bg-surface-1"
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
            {draft.repeatCustomFrequency === "monthly" ? (
              <div className="grid gap-2">
                <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
                  <span>Monthly rule</span>
                  <select
                    aria-label="Monthly repeat rule"
                    className="h-8 rounded-hcbMd border border-border bg-bg-tertiary px-2 text-[var(--text-base)] text-text-primary"
                    onChange={(event) => setDraft({ ...draft, repeatMonthlyMode: event.target.value as CalendarEventDraft["repeatMonthlyMode"] })}
                    value={draft.repeatMonthlyMode}
                  >
                    <option value="dayOfMonth">Day of month</option>
                    <option value="weekday">Weekday position</option>
                  </select>
                </label>
                {draft.repeatMonthlyMode === "dayOfMonth" ? (
                  <Input
                    aria-label="Repeat month day"
                    min={1}
                    max={31}
                    onChange={(event) => setDraft({ ...draft, repeatMonthDay: event.target.value })}
                    type="number"
                    value={draft.repeatMonthDay}
                  />
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      aria-label="Repeat weekday position"
                      className="h-8 rounded-hcbMd border border-border bg-bg-tertiary px-2 text-[var(--text-base)] text-text-primary"
                      onChange={(event) => setDraft({ ...draft, repeatSetPos: event.target.value })}
                      value={draft.repeatSetPos}
                    >
                      <option value="1">First</option>
                      <option value="2">Second</option>
                      <option value="3">Third</option>
                      <option value="4">Fourth</option>
                      <option value="-1">Last</option>
                    </select>
                    <select
                      aria-label="Repeat weekday"
                      className="h-8 rounded-hcbMd border border-border bg-bg-tertiary px-2 text-[var(--text-base)] text-text-primary"
                      onChange={(event) => setDraft({ ...draft, repeatWeekdays: [event.target.value as CalendarRepeatWeekday] })}
                      value={draft.repeatWeekdays[0] ?? repeatWeekdayForIso(draft.startsAt)}
                    >
                      {repeatWeekdays.map((weekday) => (
                        <option key={weekday.id} value={weekday.id}>
                          {weekday.id}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
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
            {calendarRecurrenceRulePreview(draft) ? (
              <code className="overflow-auto rounded-hcbMd border border-border bg-bg-tertiary px-2 py-1 text-[var(--text-xs)] text-text-muted">
                {calendarRecurrenceRulePreview(draft)}
              </code>
            ) : null}
          </div>
        ) : null}
        {draft.recurrenceEditor === "simple" ? (
          <>
            <div className="text-[var(--text-xs)] text-text-muted">{calendarRecurrenceSummary(draft)}</div>
            <button
              className="w-fit text-[var(--text-xs)] text-accent underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              onClick={() => setDraft({
                ...draft,
                recurrenceEditor: "google",
                recurrenceLines: calendarSimpleRecurrenceLines(draft)
              })}
              type="button"
            >
              Edit exact Google recurrence rules
            </button>
          </>
        ) : (
          <div className="grid gap-2 rounded-hcbMd border border-border bg-surface-0 p-3">
            <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
              <span>Google recurrence rules</span>
              <textarea
                aria-label="Google recurrence rules"
                className="min-h-28 w-full resize-y rounded-hcbMd border border-border bg-bg-tertiary px-3 py-2 font-mono text-[var(--text-sm)] text-text-primary placeholder:text-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                onChange={(event) => setDraft({
                  ...draft,
                  recurrenceLines: normalizeGoogleRecurrenceLines(event.currentTarget.value.split("\n"))
                })}
                placeholder={"RRULE:FREQ=WEEKLY;BYDAY=MO,WE\nEXDATE;TZID=Asia/Singapore:20261012T090000\nRDATE;TZID=Asia/Singapore:20261013T090000"}
                spellCheck={false}
                value={draft.recurrenceLines.join("\n")}
              />
            </label>
            <p className="text-[var(--text-xs)] text-text-muted">
              Exact Google Calendar RFC 5545 lines. Use RRULE, EXRULE, RDATE, and EXDATE; start/end and timezone stay in the Time section.
            </p>
            <button
              className="w-fit text-[var(--text-xs)] text-accent underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              onClick={() => setDraft({ ...draft, recurrenceEditor: "simple" })}
              type="button"
            >
              Use simple repeat controls instead
            </button>
            <p className="text-[var(--text-xs)] text-warning">
              Switching to simple controls replaces the exact Google rule set when you save.
            </p>
          </div>
        )}
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
