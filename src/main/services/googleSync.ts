import { CoreStore, CoreStoreError, type PendingSyncMutation } from "./coreStore";
import { GoogleOAuthController } from "./googleOAuth";
import { EventEmitter } from "node:events";

type JsonRecord = Record<string, any>;

interface GooglePage {
  items?: JsonRecord[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }

  get retryable(): boolean {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

/**
 * Owns every Google API call. CoreStore remains a local, transactional cache;
 * this service makes its durable outbox meaningful by pulling remote state and
 * delivering local writes in order. It intentionally uses raw REST instead of
 * an opaque SDK so request headers, pagination, ETags, and errors are visible
 * in one small boundary.
 */
export class GoogleSyncService {
  private inFlight: Promise<JsonRecord> | null = null;
  private readonly events = new EventEmitter();
  private interval: NodeJS.Timeout | null = null;
  private writeDebounce: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: CoreStore,
    private readonly oauth: GoogleOAuthController
  ) {
    oauth.onConnectionChange(() => {
      void this.runNow({ reason: "connection-change" }).catch(() => undefined);
    });
  }

  runNow(input: JsonRecord = {}): Promise<JsonRecord> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.sync(input).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  onStatus(listener: (status: JsonRecord) => void): () => void {
    this.events.on("status", listener);
    return () => this.events.off("status", listener);
  }

  startBackgroundSync(intervalMs = 5 * 60_000): void {
    if (this.interval) return;
    this.interval = setInterval(() => void this.runNow({ reason: "interval" }).catch(() => undefined), intervalMs);
    this.interval.unref?.();
  }

  stopBackgroundSync(): void {
    if (this.interval) clearInterval(this.interval);
    if (this.writeDebounce) clearTimeout(this.writeDebounce);
    this.interval = null;
    this.writeDebounce = null;
  }

  scheduleAfterLocalMutation(): void {
    if (this.writeDebounce) clearTimeout(this.writeDebounce);
    this.writeDebounce = setTimeout(() => {
      this.writeDebounce = null;
      void this.runNow({ reason: "local-mutation" }).catch(() => undefined);
    }, 500);
  }

  async forceFullResync(input: JsonRecord = {}): Promise<JsonRecord> {
    const accountId = typeof input.accountId === "string" ? input.accountId : undefined;
    this.store.resetGoogleSyncTokens(accountId);
    return this.runNow({ reason: "force-full", ...(accountId ? { accountId } : {}) });
  }

  private async sync(_input: JsonRecord): Promise<JsonRecord> {
    const requestedAccountId = typeof _input.accountId === "string" ? _input.accountId : undefined;
    const accounts = this.store.googleAccounts().filter((account) =>
      account.accountId !== "local" && account.connectionState === "connected" && (!requestedAccountId || account.accountId === requestedAccountId)
    );
    if (accounts.length === 0) {
      const status = {
        state: "idle",
        pendingMutationCount: this.store.pendingSyncMutations().length,
        offline: false,
        stale: false,
        message: "Connect Google before syncing."
      };
      this.publishStatus(status);
      return status;
    }

    this.publishStatus({ state: "syncing", pendingMutationCount: this.store.pendingSyncMutations().length, offline: false, stale: false });
    try {
      const failures: Error[] = [];
      for (const account of accounts) {
        try {
          await this.pullGoogleTasks(account.accountId);
          await this.pullGoogleCalendars(account.accountId);
          await this.deliverOutbox(account.accountId);
          // Pull once more so remote canonical values, including generated ids
          // and server-normalised recurrence, are reflected after a write batch.
          await this.pullGoogleTasks(account.accountId);
          await this.pullGoogleCalendars(account.accountId);
        } catch (error: unknown) {
          failures.push(error instanceof Error ? error : new Error("Google sync failed."));
        }
      }
      if (failures.length) throw failures[0];
      const status = {
        state: "idle",
        pendingMutationCount: this.store.pendingSyncMutations().length,
        offline: false,
        stale: false,
        lastCompletedAt: new Date().toISOString(),
        lastErrorCode: null
      };
      this.publishStatus(status);
      return status;
    } catch (error: unknown) {
      const status = {
        state: "error",
        pendingMutationCount: this.store.pendingSyncMutations().length,
        offline: error instanceof GoogleApiError && error.status === 0,
        stale: true,
        message: safeError(error),
        lastErrorCode: error instanceof GoogleApiError ? String(error.status) : "LOCAL_ERROR"
      };
      this.publishStatus(status);
      throw error;
    }
  }

  private async pullGoogleTasks(accountId: string): Promise<void> {
    const taskLists = await this.allPages(accountId, "https://tasks.googleapis.com/tasks/v1/users/@me/lists", { maxResults: "100" });
    for (const remoteList of taskLists) {
      const localList = this.store.upsertGoogleTaskList(remoteList, accountId);
      if (!this.store.isSelectedTaskList(localList.id)) continue;
      const remoteTasks = await this.allPages(accountId,
        `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(remoteList.id)}/tasks`,
        { maxResults: "100", showCompleted: "true", showHidden: "true", showDeleted: "true" }
      );
      // Insert parents before children where possible. A second pass assigns a
      // parent that appeared after its child in a provider page.
      for (const remoteTask of remoteTasks) this.store.upsertGoogleTask(remoteTask, localList.id);
      for (const remoteTask of remoteTasks) {
        if (remoteTask.parent) this.store.upsertGoogleTask(remoteTask, localList.id);
      }
    }
  }

  private publishStatus(status: JsonRecord): void {
    this.store.setSyncRuntime(status);
    this.events.emit("status", { ...status, pendingMutationCount: this.store.pendingSyncMutations().length });
  }

  private async pullGoogleCalendars(accountId: string): Promise<void> {
    const remoteCalendars = await this.allPages(accountId, "https://www.googleapis.com/calendar/v3/users/me/calendarList", {
      maxResults: "250", showDeleted: "true"
    });
    for (const remoteCalendar of remoteCalendars) {
      if (remoteCalendar.deleted) continue;
      const localCalendar = this.store.upsertGoogleCalendar(remoteCalendar, accountId);
      if (this.store.isSelectedCalendar(localCalendar.id)) await this.pullGoogleEvents(accountId, localCalendar);
    }
  }

  private async pullGoogleEvents(accountId: string, localCalendar: JsonRecord, retriedAfterReset = false): Promise<void> {
    const googleId = localCalendar.googleId;
    if (!googleId) return;
    const tokenKey = `events:${googleId}`;
    const syncToken = this.store.googleSyncToken(accountId, tokenKey);
    const query: Record<string, string> = {
      maxResults: "2500",
      showDeleted: "true",
      singleEvents: "false"
    };
    if (syncToken) query.syncToken = syncToken;

    try {
      const page = await this.allPagesWithSyncToken(accountId,
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(googleId)}/events`,
        query
      );
      for (const event of page.items) this.store.upsertGoogleEvent(event, localCalendar.id);
      if (page.nextSyncToken) this.store.setGoogleSyncToken(accountId, tokenKey, page.nextSyncToken);
    } catch (error: unknown) {
      if (error instanceof GoogleApiError && error.status === 410 && !retriedAfterReset) {
        this.store.setGoogleSyncToken(accountId, tokenKey, null);
        await this.pullGoogleEvents(accountId, localCalendar, true);
        return;
      }
      throw error;
    }
  }

  private async deliverOutbox(accountId: string): Promise<void> {
    for (const mutation of this.store.pendingSyncMutations(100, accountId)) {
      try {
        await this.deliverMutation(accountId, mutation);
        this.store.completeSyncMutation(mutation.id);
      } catch (error: unknown) {
        // Tasks does not accept client-generated ids. Retrying a create after a
        // lost response can duplicate a user task, so preserve it as an
        // explicit conflict instead of guessing. Calendar creates are
        // idempotent below through a deterministic event id.
        const ambiguousTaskCreate = mutation.kind === "task.create" && error instanceof GoogleApiError && error.status === 0;
        const retryable = !ambiguousTaskCreate && (error instanceof GoogleApiError ? error.retryable : !(error instanceof CoreStoreError));
        this.store.deferSyncMutation(mutation.id, safeError(error), retryable);
        // Preserve causal order: later writes may depend on this one.
        break;
      }
    }
  }

  private async deliverMutation(accountId: string, mutation: PendingSyncMutation): Promise<void> {
    switch (mutation.kind) {
      case "taskList.create":
      case "taskList.update":
        await this.pushTaskList(accountId, mutation.entityId);
        return;
      case "taskList.delete":
        await this.deleteTaskList(accountId, mutation.payload);
        return;
      case "task.create":
      case "task.update":
        await this.pushTask(accountId, mutation.entityId, mutation.payload);
        return;
      case "event.create":
      case "event.update":
        await this.pushEvent(accountId, mutation.entityId);
        return;
      case "event.move":
        await this.moveEvent(accountId, mutation.entityId, mutation.payload);
        return;
      case "event.delete":
        await this.deleteEvent(accountId, mutation.payload);
        return;
      default:
        // Notes/tags are intentionally local features, not silently exported
        // into unrelated Google resources.
        return;
    }
  }

  private async pushTaskList(accountId: string, localId: string): Promise<void> {
    const list = this.store.googleTaskListForSync(localId);
    if (!list) return;
    const remote = list.googleId
      ? await this.requestJson<JsonRecord>(accountId,
          `https://tasks.googleapis.com/tasks/v1/users/@me/lists/${encodeURIComponent(list.googleId)}`,
          { method: "PATCH", body: json({ title: list.title }), headers: conditionalHeaders(list.googleEtag) }
        )
      : await this.requestJson<JsonRecord>(accountId, "https://tasks.googleapis.com/tasks/v1/users/@me/lists", {
          method: "POST", body: json({ title: list.title })
        });
    this.store.bindGoogleTaskList(localId, remote);
  }

  private async deleteTaskList(accountId: string, list: JsonRecord): Promise<void> {
    if (!list.googleId) return;
    await this.requestJson<void>(accountId,
      `https://tasks.googleapis.com/tasks/v1/users/@me/lists/${encodeURIComponent(list.googleId)}`,
      { method: "DELETE", headers: conditionalHeaders(list.googleEtag) }
    );
  }

  private async pushTask(accountId: string, localId: string, mutationPayload: JsonRecord): Promise<void> {
    let task = this.store.googleTaskForSync(localId);
    if (!task) return;
    if (!task.listGoogleId) throw new CoreStoreError("This task list has not been created in Google yet.");
    if (task.status === "deleted") {
      if (task.googleId) {
        await this.requestJson<void>(accountId, taskUrl(task.googleListId ?? task.listGoogleId, task.googleId), {
          method: "DELETE", headers: conditionalHeaders(task.googleEtag)
        });
      }
      return;
    }
    const parent = task.parentId ? await this.remoteParentId(task.parentId) : undefined;
    const body = googleTaskBody(task);
    if (!task.googleId) {
      const remote = await this.requestJson<JsonRecord>(accountId, taskCollectionUrl(task.listGoogleId), {
        method: "POST", body: json(body),
        ...(parent ? { query: { parent } } : {})
      });
      this.store.bindGoogleTask(localId, remote);
      return;
    }
    if (task.googleListId && task.googleListId !== task.listGoogleId) {
      const previous = typeof mutationPayload.previousTaskId === "string"
        ? await this.remoteParentId(mutationPayload.previousTaskId)
        : undefined;
      const remote = await this.requestJson<JsonRecord>(accountId, `${taskUrl(task.googleListId, task.googleId)}/move`, {
        method: "POST", query: { destinationTasklist: task.listGoogleId, ...(parent ? { parent } : {}), ...(previous ? { previous } : {}) }
      });
      this.store.bindGoogleTask(localId, remote);
      return;
    }
    if ((task.googleParentId ?? undefined) !== parent) {
      const previous = typeof mutationPayload.previousTaskId === "string"
        ? await this.remoteParentId(mutationPayload.previousTaskId)
        : undefined;
      const moved = await this.requestJson<JsonRecord>(accountId, `${taskUrl(task.listGoogleId, task.googleId)}/move`, {
        method: "POST", ...(parent || previous ? { query: { ...(parent ? { parent } : {}), ...(previous ? { previous } : {}) } } : {})
      });
      this.store.bindGoogleTask(localId, moved);
      task = this.store.googleTaskForSync(localId);
      if (!task) throw new CoreStoreError("Task no longer exists");
    }
    const remote = await this.requestJson<JsonRecord>(accountId, taskUrl(task.listGoogleId, task.googleId), {
      method: "PATCH", body: json(body), headers: conditionalHeaders(task.googleEtag)
    });
    this.store.bindGoogleTask(localId, remote);
  }

  private async remoteParentId(localParentId: string): Promise<string | undefined> {
    return this.store.googleTaskForSync(localParentId)?.googleId ?? undefined;
  }

  private async pushEvent(accountId: string, localId: string): Promise<void> {
    const event = this.store.googleEventForSync(localId);
    if (!event) return;
    if (!event.calendarGoogleId) throw new CoreStoreError("This calendar has not been discovered in Google yet.");
    const body = googleEventBody(event, event.googleId ? undefined : deterministicGoogleEventId(event.id));
    const collection = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(event.calendarGoogleId)}/events`;
    let remote: JsonRecord;
    if (event.googleId) {
      remote = await this.requestJson<JsonRecord>(accountId, `${collection}/${encodeURIComponent(event.googleId)}`, {
        method: "PATCH", body: json(body), headers: conditionalHeaders(event.googleEtag)
      });
    } else {
      try {
        remote = await this.requestJson<JsonRecord>(accountId, collection, { method: "POST", body: json(body) });
      } catch (error: unknown) {
        if (!(error instanceof GoogleApiError) || error.status !== 409) throw error;
        // A previous POST reached Google but HCB stopped before persisting the
        // response. Fetching the deterministic id makes the retry safe.
        remote = await this.requestJson<JsonRecord>(accountId, `${collection}/${deterministicGoogleEventId(event.id)}`);
      }
    }
    this.store.bindGoogleEvent(localId, remote);
  }

  private async moveEvent(accountId: string, localId: string, payload: JsonRecord): Promise<void> {
    const event = this.store.googleEventForSync(localId);
    if (!event?.googleId) return;
    const sourceCalendarId = typeof payload.sourceCalendarId === "string" ? payload.sourceCalendarId : null;
    const destinationCalendarId = typeof payload.destinationCalendarId === "string" ? payload.destinationCalendarId : null;
    if (!sourceCalendarId || !destinationCalendarId) {
      throw new CoreStoreError("Calendar move is missing its source or destination.");
    }
    const source = this.store.googleCalendarForSync(sourceCalendarId);
    const destination = this.store.googleCalendarForSync(destinationCalendarId);
    if (!source?.googleId || !destination?.googleId) {
      throw new CoreStoreError("The source or destination calendar has not been discovered in Google yet.");
    }
    if (source.accountId !== accountId || destination.accountId !== accountId) {
      throw new CoreStoreError("Calendar events can only move within the same connected Google account.");
    }

    let remote = await this.requestJson<JsonRecord>(accountId,
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(source.googleId)}/events/${encodeURIComponent(event.googleId)}/move`,
      { method: "POST", query: { destination: destination.googleId }, headers: conditionalHeaders(event.googleEtag) }
    );
    this.store.bindGoogleEvent(localId, remote);

    // An edit can be queued after more than one local calendar move. Apply the
    // current event body only at its final destination; an intermediate move
    // merely preserves causal order for Google's single-source move endpoint.
    if (event.calendarId !== destinationCalendarId) return;
    remote = await this.requestJson<JsonRecord>(accountId,
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(destination.googleId)}/events/${encodeURIComponent(remote.id)}`,
      { method: "PATCH", body: json(googleEventBody(event)), headers: conditionalHeaders(remote.etag) }
    );
    this.store.bindGoogleEvent(localId, remote);
  }

  private async deleteEvent(accountId: string, event: JsonRecord): Promise<void> {
    if (!event.googleId || !event.calendarGoogleId) return;
    await this.requestJson<void>(accountId,
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(event.calendarGoogleId)}/events/${encodeURIComponent(event.googleId)}`,
      { method: "DELETE", headers: conditionalHeaders(event.googleEtag) }
    );
  }

  private async allPages(accountId: string, url: string, query: Record<string, string>): Promise<JsonRecord[]> {
    return (await this.allPagesWithSyncToken(accountId, url, query)).items;
  }

  private async allPagesWithSyncToken(accountId: string, url: string, query: Record<string, string>): Promise<{ items: JsonRecord[]; nextSyncToken?: string }> {
    const items: JsonRecord[] = [];
    let pageToken: string | undefined;
    let nextSyncToken: string | undefined;
    do {
      const page = await this.requestJson<GooglePage>(accountId, url, { query: { ...query, ...(pageToken ? { pageToken } : {}) } });
      items.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
      nextSyncToken = page.nextSyncToken ?? nextSyncToken;
    } while (pageToken);
    return { items, ...(nextSyncToken ? { nextSyncToken } : {}) };
  }

  private async requestJson<T>(accountId: string, url: string, init: RequestInit & { query?: Record<string, string> } = {}): Promise<T> {
    const target = new URL(url);
    for (const [key, value] of Object.entries(init.query ?? {})) target.searchParams.set(key, value);
    const { query: _query, ...requestInit } = init;
    let response: Response;
    try {
      response = await this.oauth.googleFetch(accountId, target, requestInit);
    } catch (error: unknown) {
      throw new GoogleApiError(0, error instanceof Error ? error.message : "Google request failed.");
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new GoogleApiError(response.status, googleErrorMessage(response.status, detail));
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  }
}

function taskCollectionUrl(taskListId: string): string {
  return `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks`;
}

function taskUrl(taskListId: string, taskId: string): string {
  return `${taskCollectionUrl(taskListId)}/${encodeURIComponent(taskId)}`;
}

function googleTaskBody(task: JsonRecord): JsonRecord {
  return {
    title: task.title,
    notes: task.notes || undefined,
    due: task.dueAt || null,
    status: task.status === "completed" ? "completed" : "needsAction"
  };
}

function googleEventBody(event: JsonRecord, createId?: string): JsonRecord {
  const recurrence = googleRecurrence(event.recurrence);
  return {
    ...(createId ? { id: createId, extendedProperties: { private: { hcbLocalEventId: event.id } } } : {}),
    summary: event.title,
    description: event.description || undefined,
    location: event.location || undefined,
    colorId: event.colorId || undefined,
    start: googleEventTime(event.startsAt, Boolean(event.allDay), event.timeZone),
    end: googleEventTime(event.endsAt, Boolean(event.allDay), event.timeZone),
    recurrence: recurrence ?? [],
    attendees: normalizeAttendees(event.attendees),
    reminders: {
      useDefault: Boolean(event.remindersUseDefault),
      ...(event.remindersUseDefault ? {} : { overrides: safeArray(event.reminders) })
    },
    transparency: event.transparency || "opaque",
    visibility: event.visibility || "default"
  };
}

function deterministicGoogleEventId(localId: string): string {
  // Google Calendar event ids use lower-case base32hex. UUID hex is a valid
  // subset; the prefix makes app-created ids recognisable without exposing
  // credentials or account identity.
  return `hcb${String(localId).replace(/[^a-f0-9]/gi, "").toLowerCase()}`.slice(0, 1024);
}

function googleEventTime(value: string, allDay: boolean, timeZone: unknown): JsonRecord {
  if (!allDay) return { dateTime: value, ...(typeof timeZone === "string" && timeZone ? { timeZone } : {}) };
  return { date: value.slice(0, 10) };
}

function googleRecurrence(value: unknown): string[] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as JsonRecord;
  const frequency = String(record.frequency ?? "").toUpperCase();
  if (!new Set(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]).has(frequency)) return undefined;
  const fields = [`FREQ=${frequency}`, `INTERVAL=${Math.max(1, Number(record.interval) || 1)}`];
  if (Array.isArray(record.byDay) && record.byDay.length) fields.push(`BYDAY=${record.byDay.join(",")}`);
  if (record.byMonthDay) fields.push(`BYMONTHDAY=${record.byMonthDay}`);
  if (record.bySetPos) fields.push(`BYSETPOS=${record.bySetPos}`);
  if (record.endsOn) fields.push(`UNTIL=${String(record.endsOn).replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`);
  if (record.count) fields.push(`COUNT=${record.count}`);
  return [`RRULE:${fields.join(";")}`];
}

function normalizeAttendees(value: unknown): JsonRecord[] | undefined {
  const entries = safeArray(value)
    .map((entry) => typeof entry === "string" ? { email: entry } : entry)
    .filter((entry): entry is JsonRecord => Boolean(entry) && typeof entry === "object" && typeof entry.email === "string");
  return entries.length ? entries : undefined;
}

function conditionalHeaders(etag: unknown): HeadersInit {
  return etag ? { "if-match": String(etag), "content-type": "application/json" } : { "content-type": "application/json" };
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function safeArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter((entry): entry is JsonRecord => Boolean(entry) && typeof entry === "object") : [];
}

function googleErrorMessage(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    if (parsed.error?.message) return `Google request failed (${status}): ${parsed.error.message}`;
  } catch {
    // Use a generic, token-safe error below.
  }
  return `Google request failed (${status}).`;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Google sync failed.";
  return message.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]").slice(0, 500);
}
