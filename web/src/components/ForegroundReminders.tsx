import { useEffect, useMemo, useState } from "react";

import { localStore } from "@/data/localStore";
import { parseTaskRecurrenceNotes } from "@/features/taskRecurrence";
import type { GoogleCalendar, GoogleCalendarEvent, GoogleTask, ReminderState } from "@/types";

interface DueReminder {
  readonly id: string;
  readonly calendarId: string;
  readonly eventId: string;
  readonly title: string;
  readonly body: string;
  readonly href: string;
  readonly triggerAt: string;
}

function eventPath(event: GoogleCalendarEvent): string {
  return `/event/${encodeURIComponent(event.calendarId)}/${encodeURIComponent(event.id)}`;
}

function taskPath(task: GoogleTask): string {
  return `/task/${encodeURIComponent(task.id)}`;
}

function offsetAt(instant: Date, timeZone: string): number | undefined {
  const zoneName = new Intl.DateTimeFormat("en", { timeZone, timeZoneName: "longOffset" }).formatToParts(instant).find((part) => part.type === "timeZoneName")?.value;
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(zoneName ?? "");
  if (!match) return zoneName === "GMT" ? 0 : undefined;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "+" ? minutes : -minutes;
}

/** Resolves an IANA local task reminder time without serializing it through browser-local time. */
function zonedTaskTime(date: string, time: string, timeZone: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return undefined;
  const [hour, minute] = time.split(":").map(Number);
  let utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour!, minute!);
  const initialOffset = offsetAt(new Date(utc), timeZone);
  if (initialOffset === undefined) return undefined;
  utc -= initialOffset * 60_000;
  const correctedOffset = offsetAt(new Date(utc), timeZone);
  if (correctedOffset !== undefined && correctedOffset !== initialOffset) utc += (initialOffset - correctedOffset) * 60_000;
  return new Date(utc);
}

function dueReminders(events: readonly GoogleCalendarEvent[], calendars: readonly GoogleCalendar[], tasks: readonly GoogleTask[], states: readonly ReminderState[], now = new Date()): DueReminder[] {
  const state = new Map(states.map((entry) => [entry.id, entry]));
  const calendarsById = new Map(calendars.map((calendar) => [calendar.id, calendar]));
  const candidates = [
    ...events.flatMap((event) => {
      if (!event.start.dateTime) return [];
      const reminders = event.reminders?.useDefault !== false
        ? calendarsById.get(event.calendarId)?.defaultReminders?.filter((reminder) => reminder.method === "popup") ?? []
        : event.reminders.overrides?.filter((reminder) => reminder.method === "popup") ?? [];
      return reminders.map((reminder) => {
        const triggerAt = new Date(new Date(event.start.dateTime!).getTime() - reminder.minutes * 60_000).toISOString();
        return { id: `calendar:${event.calendarId}:${event.id}:${triggerAt}`, calendarId: event.calendarId, eventId: event.id, title: event.summary || "Calendar reminder", body: new Date(event.start.dateTime!).toLocaleString(), href: eventPath(event), triggerAt };
      });
    }),
    ...tasks.flatMap((task) => {
      if (task.status === "completed" || task.deleted || !task.due) return [];
      const reminder = parseTaskRecurrenceNotes(task.notes).reminder;
      const trigger = reminder ? zonedTaskTime(task.due.slice(0, 10), reminder.time, reminder.timeZone) : undefined;
      if (!trigger) return [];
      const triggerAt = trigger.toISOString();
      return [{ id: `task:${task.listId}:${task.id}:${task.due.slice(0, 10)}:${reminder!.time}:${reminder!.timeZone}`, calendarId: "tasks", eventId: task.id, title: task.title || "Task reminder", body: trigger.toLocaleString(), href: taskPath(task), triggerAt }];
    })
  ];
  return candidates.flatMap((reminder) => {
    const stored = state.get(reminder.id);
    if (stored?.state === "dismissed" || stored?.state === "snoozed" && stored.triggerAt > now.toISOString()) return [];
    const trigger = new Date(stored?.state === "snoozed" ? stored.triggerAt : reminder.triggerAt);
    return trigger <= now && now.getTime() - trigger.getTime() <= 90_000 ? [{ ...reminder, triggerAt: trigger.toISOString() }] : [];
  });
}

async function showNotification(reminder: DueReminder): Promise<void> {
  if (Notification.permission !== "granted") return;
  const options = { body: reminder.body, data: { href: reminder.href }, tag: reminder.id };
  const registration = await navigator.serviceWorker?.ready.catch(() => undefined);
  if (registration) await registration.showNotification(reminder.title, options);
  else {
    const notification = new Notification(reminder.title, options);
    notification.onclick = () => { window.focus(); window.location.assign(reminder.href); };
  }
}

export async function requestForegroundNotificationPermission(): Promise<NotificationPermission> {
  if (!("Notification" in window)) throw new Error("This browser does not support notifications");
  return Notification.requestPermission();
}

export async function pendingForegroundReminderCount(subject: string, events: readonly GoogleCalendarEvent[], calendars: readonly GoogleCalendar[], tasks: readonly GoogleTask[]): Promise<number> {
  return dueReminders(events, calendars, tasks, await localStore.readReminderStates(subject)).length;
}

export function ForegroundReminders({ subject, events, calendars, tasks }: { readonly subject: string; readonly events: readonly GoogleCalendarEvent[]; readonly calendars: readonly GoogleCalendar[]; readonly tasks: readonly GoogleTask[] }): React.JSX.Element | null {
  const [states, setStates] = useState<readonly ReminderState[]>([]);
  const [now, setNow] = useState(() => new Date());
  const due = useMemo(() => dueReminders(events, calendars, tasks, states, now), [calendars, events, now, states, tasks]);

  useEffect(() => {
    let active = true;
    void localStore.readReminderStates(subject).then((entries) => { if (active) setStates(entries); });
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [subject]);

  useEffect(() => {
    for (const reminder of due) {
      if (states.some((state) => state.id === reminder.id && state.state === "delivered")) continue;
      const entry: ReminderState = { id: reminder.id, calendarId: reminder.calendarId, eventId: reminder.eventId, triggerAt: reminder.triggerAt, state: "delivered", updatedAt: new Date().toISOString() };
      void localStore.saveReminderState(subject, entry).then(() => setStates((current) => [...current.filter((state) => state.id !== entry.id), entry]));
      void showNotification(reminder);
    }
  }, [due, states, subject]);

  async function update(reminder: DueReminder, state: ReminderState["state"]): Promise<void> {
    const triggerAt = state === "snoozed" ? new Date(Date.now() + 10 * 60_000).toISOString() : reminder.triggerAt;
    const entry: ReminderState = { id: reminder.id, calendarId: reminder.calendarId, eventId: reminder.eventId, triggerAt, state, updatedAt: new Date().toISOString() };
    await localStore.saveReminderState(subject, entry);
    setStates((current) => [...current.filter((candidate) => candidate.id !== entry.id), entry]);
  }

  if (due.length === 0) return null;
  return <section className="foreground-reminders" aria-live="polite"><strong>Reminder{due.length === 1 ? "" : "s"}</strong>{due.map((reminder) => <div key={reminder.id}><span>{reminder.title}</span><div className="button-row"><a href={reminder.href}>Open</a><button type="button" onClick={() => void update(reminder, "snoozed")}>Snooze 10 min</button><button type="button" onClick={() => void update(reminder, "dismissed")}>Dismiss</button></div></div>)}</section>;
}
