import { randomBytes, randomUUID } from "node:crypto";

import { DateTime } from "luxon";
import webpush from "web-push";

import type { BackendConfig } from "./config.js";
import type { Database } from "./database.js";
import type { ManagedGoogleService } from "./googleService.js";
import { hashOpaqueValue, type ManagedStore } from "./managedStore.js";

const syncIntervalMilliseconds = 5 * 60_000;
const deliveryGraceMilliseconds = 15 * 60_000;
const watchRefreshMilliseconds = 24 * 60 * 60_000;

type PushContentMode = "details" | "generic";

interface GoogleListResponse {
  readonly items?: readonly Record<string, unknown>[];
  readonly nextPageToken?: string;
  readonly nextSyncToken?: string;
}

interface CalendarRow {
  readonly calendar_id: string;
  readonly payload: Record<string, unknown>;
}

interface EventRow extends CalendarRow {
  readonly event_id: string;
}

interface TaskRow {
  readonly task_list_id: string;
  readonly task_id: string;
  readonly payload: Record<string, unknown>;
}

interface ChannelRow {
  readonly channel_id: string;
  readonly subject: string;
  readonly calendar_id: string | null;
  readonly resource_id: string;
  readonly token_hash: string;
}

interface SubscriptionRow {
  readonly id: string;
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
  readonly content_mode: PushContentMode;
}

interface ReliabilityStateRow {
  readonly last_sync_at: Date | null;
  readonly sync_requested_at: Date | null;
  readonly last_error: string | null;
}

interface PushSubscriptionInput {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
}

export interface ReliabilityStatus {
  readonly enabled: boolean;
  readonly lastSyncAt?: string;
  readonly lastError?: string;
  readonly calendarWebhookConfigured: boolean;
}

interface DueReminder {
  readonly key: string;
  readonly triggerAt: DateTime;
  readonly title: string;
  readonly body: string;
  readonly href: string;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function responsePath(path: string, query: Record<string, string | undefined> = {}): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) if (value) params.set(name, value);
  const queryText = params.toString();
  return queryText ? `${path}?${queryText}` : path;
}

function asGoogleList(value: unknown): GoogleListResponse {
  const body = object(value);
  if (!body) throw new Error("Google returned an invalid list response");
  const items = Array.isArray(body.items) ? body.items.filter((item): item is Record<string, unknown> => Boolean(object(item))) : [];
  return { items, nextPageToken: text(body.nextPageToken), nextSyncToken: text(body.nextSyncToken) };
}

function epoch(value: Date | null | undefined): string | undefined {
  return value?.toISOString();
}

function clearMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "The self-hosted worker failed";
  return message.replace(/[\r\n]+/g, " ").slice(0, 500);
}

function channelToken(): string {
  return randomBytes(32).toString("base64url");
}

function rawHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function triggerForEvent(event: Record<string, unknown>, calendar: Record<string, unknown>): readonly DueReminder[] {
  if (text(event.status) === "cancelled") return [];
  const start = object(event.start);
  const startDateTime = text(start?.dateTime);
  if (!startDateTime) return [];
  const startedAt = DateTime.fromISO(startDateTime, { setZone: true });
  if (!startedAt.isValid) return [];
  const ownReminders = object(event.reminders);
  const useDefault = bool(ownReminders?.useDefault) !== false;
  const calendarReminders = object(calendar.reminders);
  const rawReminders = useDefault ? calendarReminders?.defaultReminders : ownReminders?.overrides;
  if (!Array.isArray(rawReminders)) return [];
  const calendarId = text(event.calendarId) ?? text(calendar.id);
  const eventId = text(event.id);
  if (!calendarId || !eventId) return [];
  const title = text(event.summary) ?? "Calendar reminder";
  return rawReminders.flatMap((candidate) => {
    const reminder = object(candidate);
    const minutes = reminder && typeof reminder.minutes === "number" && Number.isInteger(reminder.minutes) && reminder.minutes >= 0 ? reminder.minutes : undefined;
    if (!reminder || reminder.method !== "popup" || minutes === undefined) return [];
    const triggerAt = startedAt.minus({ minutes }).toUTC();
    return [{
      key: `calendar:${calendarId}:${eventId}:${triggerAt.toMillis()}`,
      triggerAt,
      title,
      body: startedAt.toLocaleString(DateTime.DATETIME_MED),
      href: `/event/${encodeURIComponent(calendarId)}/${encodeURIComponent(eventId)}`
    }];
  });
}

/** Extracts only the portable, explicit task reminder payload from the terminal HCB envelope. */
export function taskReminderFromNotes(notes: string | undefined): { readonly time: string; readonly timeZone: string } | undefined {
  if (!notes) return undefined;
  const prefix = "[HCB-TASK v1]\n";
  const suffix = "\n[/HCB-TASK]";
  const start = notes.lastIndexOf(prefix);
  if (start < 2 || notes.slice(start - 2, start) !== "\n\n" || notes.indexOf(prefix, start + prefix.length) >= 0) return undefined;
  const end = notes.indexOf(suffix, start + prefix.length);
  if (end < 0 || end + suffix.length !== notes.length) return undefined;
  try {
    const payload = object(JSON.parse(notes.slice(start + prefix.length, end)));
    const reminder = object(payload?.m);
    const time = text(reminder?.t);
    const timeZone = text(reminder?.z);
    if (!time || !timeZone || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return undefined;
    return DateTime.now().setZone(timeZone).isValid ? { time, timeZone } : undefined;
  } catch {
    return undefined;
  }
}

function triggerForTask(task: Record<string, unknown>, listId: string): DueReminder | undefined {
  if (text(task.status) === "completed" || bool(task.deleted)) return undefined;
  const reminder = taskReminderFromNotes(text(task.notes));
  const rawDue = text(task.due);
  const taskId = text(task.id);
  if (!reminder || !rawDue || !taskId) return undefined;
  const date = rawDue.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const triggerAt = DateTime.fromISO(`${date}T${reminder.time}`, { zone: reminder.timeZone });
  if (!triggerAt.isValid) return undefined;
  return {
    key: `task:${listId}:${taskId}:${date}:${reminder.time}:${reminder.timeZone}`,
    triggerAt: triggerAt.toUTC(),
    title: text(task.title) ?? "Task reminder",
    body: triggerAt.toLocaleString(DateTime.DATETIME_MED),
    href: `/task/${encodeURIComponent(taskId)}`
  };
}

export function validatePushSubscription(value: unknown): PushSubscriptionInput | undefined {
  const subscription = object(value);
  const endpoint = text(subscription?.endpoint);
  const keys = object(subscription?.keys);
  const p256dh = text(keys?.p256dh);
  const auth = text(keys?.auth);
  if (!endpoint || !p256dh || !auth || endpoint.length > 4096 || p256dh.length > 1024 || auth.length > 1024) return undefined;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:") return undefined;
  } catch {
    return undefined;
  }
  return { endpoint, keys: { p256dh, auth } };
}

export class ReliableSyncService {
  constructor(
    private readonly config: BackendConfig,
    private readonly database: Database,
    private readonly store: ManagedStore,
    private readonly google: ManagedGoogleService
  ) {
    if (config.vapid) webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);
  }

  async requestSync(subject: string): Promise<void> {
    if (!this.config.reliableSyncEnabled) return;
    await this.database.query(
      `INSERT INTO managed_reliability_state (subject, sync_requested_at)
       VALUES ($1, now())
       ON CONFLICT (subject) DO UPDATE SET sync_requested_at = now(), updated_at = now()`,
      [subject]
    );
  }

  async status(subject: string): Promise<ReliabilityStatus> {
    if (!this.config.reliableSyncEnabled) return { enabled: false, calendarWebhookConfigured: false };
    const result = await this.database.query<ReliabilityStateRow>("SELECT last_sync_at, sync_requested_at, last_error FROM managed_reliability_state WHERE subject = $1", [subject]);
    const state = result.rows[0];
    return { enabled: true, lastSyncAt: epoch(state?.last_sync_at), lastError: state?.last_error ?? undefined, calendarWebhookConfigured: Boolean(this.config.googleCalendarWebhookUrl) };
  }

  publicKey(): string | undefined {
    return this.config.reliableSyncEnabled ? this.config.vapid?.publicKey : undefined;
  }

  async savePushSubscription(subject: string, subscription: PushSubscriptionInput, contentMode: PushContentMode): Promise<void> {
    if (!this.config.reliableSyncEnabled) throw new Error("Reliable sync is not enabled on this self-hosted deployment");
    await this.database.query(
      `INSERT INTO managed_push_subscriptions (id, subject, endpoint, p256dh, auth, content_mode)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (endpoint) DO UPDATE SET subject = EXCLUDED.subject, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, content_mode = EXCLUDED.content_mode, updated_at = now()`,
      [randomUUID(), subject, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, contentMode]
    );
  }

  async deletePushSubscription(subject: string, endpoint: string): Promise<void> {
    await this.database.query("DELETE FROM managed_push_subscriptions WHERE subject = $1 AND endpoint = $2", [subject, endpoint]);
  }

  async handleCalendarWebhook(headers: Record<string, string | string[] | undefined>): Promise<boolean> {
    if (!this.config.reliableSyncEnabled || !this.config.googleCalendarWebhookUrl) return false;
    const channelId = rawHeader(headers["x-goog-channel-id"]);
    const resourceId = rawHeader(headers["x-goog-resource-id"]);
    const token = rawHeader(headers["x-goog-channel-token"]);
    if (!channelId || !resourceId || !token) return false;
    const result = await this.database.query<ChannelRow>(
      "SELECT channel_id, subject, calendar_id, resource_id, token_hash FROM managed_calendar_channels WHERE channel_id = $1 AND expires_at > now()",
      [channelId]
    );
    const channel = result.rows[0];
    if (!channel || channel.resource_id !== resourceId || channel.token_hash !== hashOpaqueValue(token)) return false;
    await this.requestSync(channel.subject);
    return true;
  }

  async runDue(): Promise<void> {
    if (!this.config.reliableSyncEnabled) return;
    await this.database.withAdvisoryLock("hot-cross-buns-reliable-sync-v1", async () => {
      const subjects = await this.store.connectedSubjects();
      for (const subject of subjects) await this.syncIfDue(subject);
      await this.sendDuePushes();
    });
  }

  async disconnect(subject: string): Promise<void> {
    const channels = await this.database.query<ChannelRow>("SELECT channel_id, subject, calendar_id, resource_id, token_hash FROM managed_calendar_channels WHERE subject = $1", [subject]);
    for (const channel of channels.rows) {
      await this.google.proxy(subject, "/calendar/v3/channels/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: channel.channel_id, resourceId: channel.resource_id }) }).catch(() => undefined);
    }
    await this.database.query("DELETE FROM managed_calendar_channels WHERE subject = $1", [subject]);
  }

  private async syncIfDue(subject: string): Promise<void> {
    const result = await this.database.query<ReliabilityStateRow>("SELECT last_sync_at, sync_requested_at, last_error FROM managed_reliability_state WHERE subject = $1", [subject]);
    const state = result.rows[0];
    const latest = Math.max(state?.last_sync_at?.getTime() ?? 0, state?.sync_requested_at?.getTime() ?? 0);
    if (state?.last_sync_at && state.last_sync_at.getTime() >= latest && Date.now() - state.last_sync_at.getTime() < syncIntervalMilliseconds) return;
    try {
      await this.syncSubject(subject, state?.last_sync_at);
      await this.database.query(
        `INSERT INTO managed_reliability_state (subject, last_sync_at, sync_requested_at, last_error)
         VALUES ($1, now(), NULL, NULL)
         ON CONFLICT (subject) DO UPDATE SET last_sync_at = now(), sync_requested_at = NULL, last_error = NULL, updated_at = now()`,
        [subject]
      );
    } catch (error) {
      await this.database.query(
        `INSERT INTO managed_reliability_state (subject, last_error)
         VALUES ($1, $2)
         ON CONFLICT (subject) DO UPDATE SET last_error = EXCLUDED.last_error, updated_at = now()`,
        [subject, clearMessage(error)]
      );
    }
  }

  private async syncSubject(subject: string, previousSync: Date | null | undefined): Promise<void> {
    await this.syncCalendarList(subject);
    const calendars = await this.database.query<CalendarRow>("SELECT calendar_id, payload FROM managed_calendar_lists WHERE subject = $1", [subject]);
    for (const calendar of calendars.rows) await this.syncCalendarEvents(subject, calendar.calendar_id);
    await this.syncTasks(subject, previousSync);
    if (this.config.googleCalendarWebhookUrl) await this.ensureCalendarWatches(subject, calendars.rows.map((calendar) => calendar.calendar_id));
  }

  private async googleList(subject: string, path: string): Promise<GoogleListResponse> {
    const response = await this.google.proxy(subject, path, { method: "GET" });
    if (!response.ok) {
      const error = new Error(`Google mirror request failed with ${response.status}`) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return asGoogleList(await response.json());
  }

  private async cursor(subject: string, resource: string): Promise<string | undefined> {
    const result = await this.database.query<{ readonly sync_token: string | null }>("SELECT sync_token FROM managed_calendar_sync_cursors WHERE subject = $1 AND resource = $2", [subject, resource]);
    return result.rows[0]?.sync_token ?? undefined;
  }

  private async saveCursor(subject: string, resource: string, syncToken: string | undefined): Promise<void> {
    if (!syncToken) return;
    await this.database.query(
      `INSERT INTO managed_calendar_sync_cursors (subject, resource, sync_token)
       VALUES ($1, $2, $3)
       ON CONFLICT (subject, resource) DO UPDATE SET sync_token = EXCLUDED.sync_token, updated_at = now()`,
      [subject, resource, syncToken]
    );
  }

  private async syncCalendarList(subject: string, reset = false): Promise<void> {
    const resource = "calendar-list";
    const syncToken = reset ? undefined : await this.cursor(subject, resource);
    let pageToken: string | undefined;
    let nextSyncToken: string | undefined;
    try {
      do {
        const list = await this.googleList(subject, responsePath("/calendar/v3/users/me/calendarList", { maxResults: "250", pageToken, showDeleted: "true", syncToken }));
        for (const calendar of list.items ?? []) {
          const id = text(calendar.id);
          if (!id) continue;
          if (bool(calendar.deleted)) {
            await Promise.all([
              this.database.query("DELETE FROM managed_calendar_lists WHERE subject = $1 AND calendar_id = $2", [subject, id]),
              this.database.query("DELETE FROM managed_calendar_events WHERE subject = $1 AND calendar_id = $2", [subject, id]),
              this.database.query("DELETE FROM managed_calendar_sync_cursors WHERE subject = $1 AND resource = $2", [subject, `calendar-events:${id}`]),
              this.database.query("DELETE FROM managed_calendar_channels WHERE subject = $1 AND calendar_id = $2", [subject, id])
            ]);
          } else {
            await this.database.query(
              `INSERT INTO managed_calendar_lists (subject, calendar_id, payload) VALUES ($1, $2, $3)
               ON CONFLICT (subject, calendar_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
              [subject, id, JSON.stringify(calendar)]
            );
          }
        }
        pageToken = list.nextPageToken;
        nextSyncToken = list.nextSyncToken ?? nextSyncToken;
      } while (pageToken);
      await this.saveCursor(subject, resource, nextSyncToken);
    } catch (error) {
      if (!reset && (error as { status?: number }).status === 410) {
        await this.database.query("DELETE FROM managed_calendar_sync_cursors WHERE subject = $1 AND resource = $2", [subject, resource]);
        await this.database.query("DELETE FROM managed_calendar_lists WHERE subject = $1", [subject]);
        await this.syncCalendarList(subject, true);
        return;
      }
      throw error;
    }
  }

  private async syncCalendarEvents(subject: string, calendarId: string, reset = false): Promise<void> {
    const resource = `calendar-events:${calendarId}`;
    const syncToken = reset ? undefined : await this.cursor(subject, resource);
    let pageToken: string | undefined;
    let nextSyncToken: string | undefined;
    try {
      do {
        const list = await this.googleList(subject, responsePath(`/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, { maxResults: "2500", pageToken, showDeleted: "true", singleEvents: "true", syncToken }));
        for (const event of list.items ?? []) {
          const id = text(event.id);
          if (!id) continue;
          if (text(event.status) === "cancelled") {
            await this.database.query("DELETE FROM managed_calendar_events WHERE subject = $1 AND calendar_id = $2 AND event_id = $3", [subject, calendarId, id]);
          } else {
            await this.database.query(
              `INSERT INTO managed_calendar_events (subject, calendar_id, event_id, payload) VALUES ($1, $2, $3, $4)
               ON CONFLICT (subject, calendar_id, event_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
              [subject, calendarId, id, JSON.stringify({ ...event, calendarId })]
            );
          }
        }
        pageToken = list.nextPageToken;
        nextSyncToken = list.nextSyncToken ?? nextSyncToken;
      } while (pageToken);
      await this.saveCursor(subject, resource, nextSyncToken);
    } catch (error) {
      if (!reset && (error as { status?: number }).status === 410) {
        await this.database.query("DELETE FROM managed_calendar_sync_cursors WHERE subject = $1 AND resource = $2", [subject, resource]);
        await this.database.query("DELETE FROM managed_calendar_events WHERE subject = $1 AND calendar_id = $2", [subject, calendarId]);
        await this.syncCalendarEvents(subject, calendarId, true);
        return;
      }
      throw error;
    }
  }

  private async syncTasks(subject: string, previousSync: Date | null | undefined): Promise<void> {
    let pageToken: string | undefined;
    const lists: Record<string, unknown>[] = [];
    do {
      const response = await this.googleList(subject, responsePath("/tasks/v1/users/@me/lists", { maxResults: "100", pageToken }));
      lists.push(...(response.items ?? []));
      pageToken = response.nextPageToken;
    } while (pageToken);
    const updatedMin = previousSync ? new Date(previousSync.getTime() - syncIntervalMilliseconds).toISOString() : undefined;
    for (const list of lists) {
      const listId = text(list.id);
      if (!listId) continue;
      await this.database.query(
        `INSERT INTO managed_task_lists (subject, task_list_id, payload) VALUES ($1, $2, $3)
         ON CONFLICT (subject, task_list_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
        [subject, listId, JSON.stringify(list)]
      );
      let taskPage: string | undefined;
      do {
        const response = await this.googleList(subject, responsePath(`/tasks/v1/lists/${encodeURIComponent(listId)}/tasks`, { maxResults: "100", pageToken: taskPage, showCompleted: "true", showDeleted: "true", showHidden: "true", updatedMin }));
        for (const task of response.items ?? []) {
          const taskId = text(task.id);
          if (!taskId) continue;
          if (bool(task.deleted)) await this.database.query("DELETE FROM managed_tasks WHERE subject = $1 AND task_list_id = $2 AND task_id = $3", [subject, listId, taskId]);
          else await this.database.query(
            `INSERT INTO managed_tasks (subject, task_list_id, task_id, payload) VALUES ($1, $2, $3, $4)
             ON CONFLICT (subject, task_list_id, task_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
            [subject, listId, taskId, JSON.stringify(task)]
          );
        }
        taskPage = response.nextPageToken;
      } while (taskPage);
    }
    const listIds = lists.map((list) => text(list.id)).filter((id): id is string => Boolean(id));
    if (listIds.length) {
      await Promise.all([
        this.database.query("DELETE FROM managed_task_lists WHERE subject = $1 AND NOT (task_list_id = ANY($2::text[]))", [subject, listIds]),
        this.database.query("DELETE FROM managed_tasks WHERE subject = $1 AND NOT (task_list_id = ANY($2::text[]))", [subject, listIds])
      ]);
    } else {
      await Promise.all([
        this.database.query("DELETE FROM managed_task_lists WHERE subject = $1", [subject]),
        this.database.query("DELETE FROM managed_tasks WHERE subject = $1", [subject])
      ]);
    }
  }

  private async ensureCalendarWatches(subject: string, calendarIds: readonly string[]): Promise<void> {
    await this.database.query("DELETE FROM managed_calendar_channels WHERE expires_at <= now()");
    const existing = await this.database.query<{ readonly calendar_id: string | null }>("SELECT calendar_id FROM managed_calendar_channels WHERE subject = $1 AND expires_at > $2", [subject, new Date(Date.now() + watchRefreshMilliseconds)]);
    const watched = new Set(existing.rows.map((row) => row.calendar_id).filter((id): id is string => Boolean(id)));
    for (const calendarId of calendarIds) {
      if (watched.has(calendarId)) continue;
      const id = randomUUID();
      const token = channelToken();
      const response = await this.google.proxy(subject, `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/watch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, type: "web_hook", address: this.config.googleCalendarWebhookUrl, token })
      });
      if (!response.ok) throw new Error(`Google Calendar watch request failed with ${response.status}`);
      const watch = object(await response.json());
      const resourceId = text(watch?.resourceId);
      const expirationText = text(watch?.expiration);
      const expiration = expirationText ? Number(expirationText) : Number.NaN;
      if (!resourceId || !Number.isFinite(expiration) || expiration <= Date.now()) throw new Error("Google Calendar returned an invalid watch channel");
      await this.database.query(
        `INSERT INTO managed_calendar_channels (channel_id, subject, calendar_id, resource_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (channel_id) DO NOTHING`,
        [id, subject, calendarId, resourceId, hashOpaqueValue(token), new Date(expiration)]
      );
    }
  }

  private async sendDuePushes(): Promise<void> {
    const calendars = await this.database.query<CalendarRow & { readonly subject: string }>("SELECT subject, calendar_id, payload FROM managed_calendar_lists");
    const calendarsBySubjectAndId = new Map<string, Record<string, unknown>>();
    for (const calendar of calendars.rows) {
      calendarsBySubjectAndId.set(`${calendar.subject}:${calendar.calendar_id}`, calendar.payload);
    }
    const dueBySubject = new Map<string, DueReminder[]>();
    const eventSubjects = await this.database.query<EventRow & { readonly subject: string }>("SELECT subject, calendar_id, event_id, payload FROM managed_calendar_events");
    const taskSubjects = await this.database.query<TaskRow & { readonly subject: string }>("SELECT subject, task_list_id, task_id, payload FROM managed_tasks");
    for (const event of eventSubjects.rows) {
      const calendar = calendarsBySubjectAndId.get(`${event.subject}:${event.calendar_id}`);
      if (!calendar) continue;
      dueBySubject.set(event.subject, [...(dueBySubject.get(event.subject) ?? []), ...triggerForEvent(event.payload, calendar)]);
    }
    for (const task of taskSubjects.rows) {
      const reminder = triggerForTask(task.payload, task.task_list_id);
      if (reminder) dueBySubject.set(task.subject, [...(dueBySubject.get(task.subject) ?? []), reminder]);
    }
    const now = DateTime.utc();
    for (const [subject, reminders] of dueBySubject) {
      const subscriptions = await this.database.query<SubscriptionRow>("SELECT id, endpoint, p256dh, auth, content_mode FROM managed_push_subscriptions WHERE subject = $1", [subject]);
      for (const reminder of reminders) {
        if (reminder.triggerAt > now.plus({ minutes: 1 }) || reminder.triggerAt < now.minus({ milliseconds: deliveryGraceMilliseconds })) continue;
        for (const subscription of subscriptions.rows) await this.sendPush(subscription, reminder);
      }
    }
  }

  private async sendPush(subscription: SubscriptionRow, reminder: DueReminder): Promise<void> {
    const claimed = await this.database.query<{ readonly subscription_id: string }>(
      "INSERT INTO managed_push_deliveries (subscription_id, reminder_key) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING subscription_id",
      [subscription.id, reminder.key]
    );
    if (!claimed.rows[0]) return;
    const generic = subscription.content_mode === "generic";
    const payload = JSON.stringify({ title: generic ? "Upcoming calendar item" : reminder.title, body: generic ? "" : reminder.body, href: reminder.href, tag: reminder.key });
    try {
      await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload, { TTL: 300, urgency: "high" });
    } catch (error) {
      const statusCode = typeof error === "object" && error && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : undefined;
      if (statusCode === 404 || statusCode === 410) await this.database.query("DELETE FROM managed_push_subscriptions WHERE id = $1", [subscription.id]);
      else await this.database.query("DELETE FROM managed_push_deliveries WHERE subscription_id = $1 AND reminder_key = $2", [subscription.id, reminder.key]);
    }
  }
}
