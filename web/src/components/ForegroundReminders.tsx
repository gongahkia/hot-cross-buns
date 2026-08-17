import { useEffect, useMemo, useState } from "react";

import { localStore } from "@/data/localStore";
import type { GoogleCalendar, GoogleCalendarEvent, ReminderState } from "@/types";

interface DueReminder {
  readonly id: string;
  readonly event: GoogleCalendarEvent;
  readonly triggerAt: string;
}

function eventPath(event: GoogleCalendarEvent): string {
  return `/event/${encodeURIComponent(event.calendarId)}/${encodeURIComponent(event.id)}`;
}

function dueReminders(events: readonly GoogleCalendarEvent[], calendars: readonly GoogleCalendar[], states: readonly ReminderState[], now = new Date()): DueReminder[] {
  const state = new Map(states.map((entry) => [entry.id, entry]));
  const calendarsById = new Map(calendars.map((calendar) => [calendar.id, calendar]));
  return events.flatMap((event) => {
    if (!event.start.dateTime) return [];
    const reminders = event.reminders?.useDefault !== false
      ? calendarsById.get(event.calendarId)?.defaultReminders?.filter((reminder) => reminder.method === "popup") ?? []
      : event.reminders.overrides?.filter((reminder) => reminder.method === "popup") ?? [];
    return reminders.flatMap((reminder) => {
      const triggerAt = new Date(new Date(event.start.dateTime!).getTime() - reminder.minutes * 60_000).toISOString();
      const id = `${event.calendarId}:${event.id}:${triggerAt}`;
      const stored = state.get(id);
      if (stored?.state === "dismissed" || stored?.state === "snoozed" && stored.triggerAt > now.toISOString()) return [];
      const trigger = new Date(stored?.state === "snoozed" ? stored.triggerAt : triggerAt);
      return trigger <= now && now.getTime() - trigger.getTime() <= 90_000 ? [{ id, event, triggerAt: trigger.toISOString() }] : [];
    });
  });
}

async function showNotification(reminder: DueReminder): Promise<void> {
  if (Notification.permission !== "granted") return;
  const options = { body: reminder.event.start.dateTime ? new Date(reminder.event.start.dateTime).toLocaleString() : "", data: { href: eventPath(reminder.event) }, tag: reminder.id };
  const registration = await navigator.serviceWorker?.ready.catch(() => undefined);
  if (registration) await registration.showNotification(reminder.event.summary || "Calendar reminder", options);
  else {
    const notification = new Notification(reminder.event.summary || "Calendar reminder", options);
    notification.onclick = () => { window.focus(); window.location.assign(eventPath(reminder.event)); };
  }
}

export async function requestForegroundNotificationPermission(): Promise<NotificationPermission> {
  if (!("Notification" in window)) throw new Error("This browser does not support notifications");
  return Notification.requestPermission();
}

export async function pendingForegroundReminderCount(subject: string, events: readonly GoogleCalendarEvent[], calendars: readonly GoogleCalendar[]): Promise<number> {
  return dueReminders(events, calendars, await localStore.readReminderStates(subject)).length;
}

export function ForegroundReminders({ subject, events, calendars }: { readonly subject: string; readonly events: readonly GoogleCalendarEvent[]; readonly calendars: readonly GoogleCalendar[] }): React.JSX.Element | null {
  const [states, setStates] = useState<readonly ReminderState[]>([]);
  const [now, setNow] = useState(() => new Date());
  const due = useMemo(() => dueReminders(events, calendars, states, now), [calendars, events, now, states]);

  useEffect(() => {
    let active = true;
    void localStore.readReminderStates(subject).then((entries) => { if (active) setStates(entries); });
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [subject]);

  useEffect(() => {
    for (const reminder of due) {
      if (states.some((state) => state.id === reminder.id && state.state === "delivered")) continue;
      const entry: ReminderState = { id: reminder.id, calendarId: reminder.event.calendarId, eventId: reminder.event.id, triggerAt: reminder.triggerAt, state: "delivered", updatedAt: new Date().toISOString() };
      void localStore.saveReminderState(subject, entry).then(() => setStates((current) => [...current.filter((state) => state.id !== entry.id), entry]));
      void showNotification(reminder);
    }
  }, [due, states, subject]);

  async function update(reminder: DueReminder, state: ReminderState["state"]): Promise<void> {
    const triggerAt = state === "snoozed" ? new Date(Date.now() + 10 * 60_000).toISOString() : reminder.triggerAt;
    const entry: ReminderState = { id: reminder.id, calendarId: reminder.event.calendarId, eventId: reminder.event.id, triggerAt, state, updatedAt: new Date().toISOString() };
    await localStore.saveReminderState(subject, entry);
    setStates((current) => [...current.filter((candidate) => candidate.id !== entry.id), entry]);
  }

  if (due.length === 0) return null;
  return <section className="foreground-reminders" aria-live="polite"><strong>Calendar reminder{due.length === 1 ? "" : "s"}</strong>{due.map((reminder) => <div key={reminder.id}><span>{reminder.event.summary || "Untitled event"}</span><div className="button-row"><a href={eventPath(reminder.event)}>Open</a><button type="button" onClick={() => void update(reminder, "snoozed")}>Snooze 10 min</button><button type="button" onClick={() => void update(reminder, "dismissed")}>Dismiss</button></div></div>)}</section>;
}
