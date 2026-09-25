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

  async forceFullResync(): Promise<JsonRecord> {
    this.store.resetGoogleSyncTokens();
    return this.runNow({ reason: "force-full" });
  }

  private async sync(_input: JsonRecord): Promise<JsonRecord> {
    const google = this.store.dispatch("google", "status") as JsonRecord;
    const connectionState = google.account?.connectionState;
    if (!google.account || connectionState !== "connected") {
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
      await this.pullGoogleTasks();
      await this.pullGoogleCalendars();
      await this.deliverOutbox();
      // Pull once more so remote canonical values, including generated ids and
      // server-normalised recurrence, are reflected after a write batch.
      await this.pullGoogleTasks();
      await this.pullGoogleCalendars();
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

  private async pullGoogleTasks(): Promise<void> {
    const taskLists = await this.allPages("https://tasks.googleapis.com/tasks/v1/users/@me/lists", { maxResults: "100" });
    for (const remoteList of taskLists) {
      const localList = this.store.upsertGoogleTaskList(remoteList);
      const remoteTasks = await this.allPages(
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

  private async pullGoogleCalendars(): Promise<void> {
    const remoteCalendars = await this.allPages("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
      maxResults: "250", showDeleted: "true"
    });
    for (const remoteCalendar of remoteCalendars) {
      if (remoteCalendar.deleted) continue;
      const localCalendar = this.store.upsertGoogleCalendar(remoteCalendar);
      await this.pullGoogleEvents(localCalendar);
    }
  }

  private async pullGoogleEvents(localCalendar: JsonRecord, retriedAfterReset = false): Promise<void> {
    const googleId = localCalendar.googleId;
    if (!googleId) return;
    const tokenKey = `events:${googleId}`;
    const syncToken = this.store.googleSyncToken(tokenKey);
    const query: Record<string, string> = {
      maxResults: "2500",
      showDeleted: "true",
      singleEvents: "false"
    };
    if (syncToken) query.syncToken = syncToken;

    try {
      const page = await this.allPagesWithSyncToken(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(googleId)}/events`,
        query
      );
      for (const event of page.items) this.store.upsertGoogleEvent(event, localCalendar.id);
      if (page.nextSyncToken) this.store.setGoogleSyncToken(tokenKey, page.nextSyncToken);
    } catch (error: unknown) {
      if (error instanceof GoogleApiError && error.status === 410 && !retriedAfterReset) {
        this.store.setGoogleSyncToken(tokenKey, null);
        await this.pullGoogleEvents(localCalendar, true);
        return;
      }
      throw error;
    }
  }

  private async deliverOutbox(): Promise<void> {
    for (const mutation of this.store.pendingSyncMutations()) {
      try {
        await this.deliverMutation(mutation);
        this.store.completeSyncMutation(mutation.id);
      } catch (error: unknown) {
        const retryable = error instanceof GoogleApiError ? error.retryable : !(error instanceof CoreStoreError);
        this.store.deferSyncMutation(mutation.id, safeError(error), retryable);
        // Preserve causal order: later writes may depend on this one.
        break;
      }
    }
  }

  private async deliverMutation(mutation: PendingSyncMutation): Promise<void> {
    switch (mutation.kind) {
      case "taskList.create":
      case "taskList.update":
        await this.pushTaskList(mutation.entityId);
        return;
      case "taskList.delete":
        await this.deleteTaskList(mutation.payload);
        return;
      case "task.create":
      case "task.update":
        await this.pushTask(mutation.entityId);
        return;
      case "event.create":
      case "event.update":
        await this.pushEvent(mutation.entityId);
        return;
      case "event.delete":
        await this.deleteEvent(mutation.payload);
        return;
      default:
        // Notes/tags are intentionally local features, not silently exported
        // into unrelated Google resources.
        return;
    }
  }

  private async pushTaskList(localId: string): Promise<void> {
    const list = this.store.googleTaskListForSync(localId);
    if (!list) return;
    const remote = list.googleId
      ? await this.requestJson<JsonRecord>(
          `https://tasks.googleapis.com/tasks/v1/users/@me/lists/${encodeURIComponent(list.googleId)}`,
          { method: "PATCH", body: json({ title: list.title }), headers: conditionalHeaders(list.googleEtag) }
        )
      : await this.requestJson<JsonRecord>("https://tasks.googleapis.com/tasks/v1/users/@me/lists", {
          method: "POST", body: json({ title: list.title })
        });
    this.store.bindGoogleTaskList(localId, remote);
  }

  private async deleteTaskList(list: JsonRecord): Promise<void> {
    if (!list.googleId) return;
    await this.requestJson<void>(
      `https://tasks.googleapis.com/tasks/v1/users/@me/lists/${encodeURIComponent(list.googleId)}`,
      { method: "DELETE", headers: conditionalHeaders(list.googleEtag) }
    );
  }

  private async pushTask(localId: string): Promise<void> {
    let task = this.store.googleTaskForSync(localId);
    if (!task) return;
    if (!task.listGoogleId) throw new CoreStoreError("This task list has not been created in Google yet.");
    if (task.status === "deleted") {
      if (task.googleId) {
        await this.requestJson<void>(taskUrl(task.googleListId ?? task.listGoogleId, task.googleId), {
          method: "DELETE", headers: conditionalHeaders(task.googleEtag)
        });
      }
      return;
    }
    const parent = task.parentId ? await this.remoteParentId(task.parentId) : undefined;
    const body = googleTaskBody(task);
    if (!task.googleId) {
      const remote = await this.requestJson<JsonRecord>(taskCollectionUrl(task.listGoogleId), {
        method: "POST", body: json(body),
        ...(parent ? { query: { parent } } : {})
      });
      this.store.bindGoogleTask(localId, remote);
      return;
    }
    if (task.googleListId && task.googleListId !== task.listGoogleId) {
      // Google Tasks does not move between task lists. Create the destination
      // copy first, bind the stable local id to it, then delete the source.
      const remote = await this.requestJson<JsonRecord>(taskCollectionUrl(task.listGoogleId), {
        method: "POST", body: json(body)
      });
      await this.requestJson<void>(taskUrl(task.googleListId, task.googleId), {
        method: "DELETE", headers: conditionalHeaders(task.googleEtag)
      });
      this.store.bindGoogleTask(localId, remote);
      return;
    }
    if ((task.googleParentId ?? undefined) !== parent) {
      const moved = await this.requestJson<JsonRecord>(`${taskUrl(task.listGoogleId, task.googleId)}/move`, {
        method: "POST", ...(parent ? { query: { parent } } : {})
      });
      this.store.bindGoogleTask(localId, moved);
      task = this.store.googleTaskForSync(localId);
      if (!task) throw new CoreStoreError("Task no longer exists");
    }
    const remote = await this.requestJson<JsonRecord>(taskUrl(task.listGoogleId, task.googleId), {
      method: "PATCH", body: json(body), headers: conditionalHeaders(task.googleEtag)
    });
    this.store.bindGoogleTask(localId, remote);
  }

  private async remoteParentId(localParentId: string): Promise<string | undefined> {
    return this.store.googleTaskForSync(localParentId)?.googleId ?? undefined;
  }

  private async pushEvent(localId: string): Promise<void> {
    const event = this.store.googleEventForSync(localId);
    if (!event) return;
    if (!event.calendarGoogleId) throw new CoreStoreError("This calendar has not been discovered in Google yet.");
    const body = googleEventBody(event);
    const collection = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(event.calendarGoogleId)}/events`;
    const remote = event.googleId
      ? await this.requestJson<JsonRecord>(`${collection}/${encodeURIComponent(event.googleId)}`, {
          method: "PATCH", body: json(body), headers: conditionalHeaders(event.googleEtag)
        })
      : await this.requestJson<JsonRecord>(collection, { method: "POST", body: json(body) });
    this.store.bindGoogleEvent(localId, remote);
  }

  private async deleteEvent(event: JsonRecord): Promise<void> {
    if (!event.googleId || !event.calendarGoogleId) return;
    await this.requestJson<void>(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(event.calendarGoogleId)}/events/${encodeURIComponent(event.googleId)}`,
      { method: "DELETE", headers: conditionalHeaders(event.googleEtag) }
    );
  }

  private async allPages(url: string, query: Record<string, string>): Promise<JsonRecord[]> {
    return (await this.allPagesWithSyncToken(url, query)).items;
  }

  private async allPagesWithSyncToken(url: string, query: Record<string, string>): Promise<{ items: JsonRecord[]; nextSyncToken?: string }> {
    const items: JsonRecord[] = [];
    let pageToken: string | undefined;
    let nextSyncToken: string | undefined;
    do {
      const page = await this.requestJson<GooglePage>(url, { query: { ...query, ...(pageToken ? { pageToken } : {}) } });
      items.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
      nextSyncToken = page.nextSyncToken ?? nextSyncToken;
    } while (pageToken);
    return { items, ...(nextSyncToken ? { nextSyncToken } : {}) };
  }

  private async requestJson<T>(url: string, init: RequestInit & { query?: Record<string, string> } = {}): Promise<T> {
    const target = new URL(url);
    for (const [key, value] of Object.entries(init.query ?? {})) target.searchParams.set(key, value);
    const { query: _query, ...requestInit } = init;
    let response: Response;
    try {
      response = await this.oauth.googleFetch(target, requestInit);
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

function googleEventBody(event: JsonRecord): JsonRecord {
  const recurrence = googleRecurrence(event.recurrence);
  return {
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
