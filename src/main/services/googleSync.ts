import { CoreStore, CoreStoreError, type PendingSyncMutation } from "./coreStore";
import { GoogleOAuthController } from "./googleOAuth";
import { EventEmitter } from "node:events";
import { googleCalendarEventColorIdForApi } from "@shared/ipc/contracts";
import { googleTaskNotesMaxLength, googleTaskTitleMaxLength, withHcbTaskMetadata } from "./hcbTaskMetadata";
import { googleOriginalStartQueryValue } from "./googleRecurrence";

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

/** The remote split was compensated successfully, so retrying it would be wrong. */
class SplitSeriesRolledBackError extends Error {}

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

  async queryFreeBusy(input: JsonRecord): Promise<JsonRecord> {
    const accountId = this.workspaceAccountId(input.accountId);
    const start = requiredIso(input.start, "Availability start");
    const end = requiredIso(input.end, "Availability end");
    if (Date.parse(end) <= Date.parse(start)) throw new CoreStoreError("Availability end must be after its start.");
    const calendarIds = Array.isArray(input.calendarIds)
      ? [...new Set(input.calendarIds.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim()))].slice(0, 50)
      : [];
    if (calendarIds.length === 0) throw new CoreStoreError("Add at least one calendar email or id to check availability.");
    const response = await this.requestJson<JsonRecord>(accountId, "https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: json({ timeMin: start, timeMax: end, items: calendarIds.map((id) => ({ id })) })
    });
    const calendars = response.calendars && typeof response.calendars === "object" ? response.calendars as JsonRecord : {};
    return {
      start,
      end,
      calendars: Object.fromEntries(Object.entries(calendars).map(([id, value]) => {
        const calendar = value && typeof value === "object" ? value as JsonRecord : {};
        const busy = Array.isArray(calendar.busy)
          ? calendar.busy.filter((block): block is JsonRecord => Boolean(block) && typeof block === "object" && typeof block.start === "string" && typeof block.end === "string")
          : [];
        return [id, { busy, errors: Array.isArray(calendar.errors) ? calendar.errors : [] }];
      }))
    };
  }

  async searchDriveFiles(input: JsonRecord): Promise<JsonRecord> {
    const accountId = this.workspaceAccountId(input.accountId, "drive");
    const query = String(input.query ?? "").trim().replace(/[\\']/g, "\\$&").slice(0, 200);
    const driveQuery = query ? `trashed = false and name contains '${query}'` : "trashed = false";
    const page = await this.requestJson<GooglePage & { files?: JsonRecord[] }>(accountId, "https://www.googleapis.com/drive/v3/files", {
      query: {
        q: driveQuery,
        pageSize: "20",
        orderBy: "modifiedTime desc",
        fields: "files(id,name,mimeType,webViewLink,iconLink,modifiedTime,size)"
      }
    });
    return {
      items: (page.files ?? []).flatMap((file) => {
        if (typeof file.id !== "string" || typeof file.name !== "string" || typeof file.webViewLink !== "string") return [];
        return [{
          fileId: file.id,
          title: file.name,
          mimeType: typeof file.mimeType === "string" ? file.mimeType : "application/octet-stream",
          fileUrl: file.webViewLink,
          iconLink: typeof file.iconLink === "string" ? file.iconLink : undefined,
          modifiedTime: typeof file.modifiedTime === "string" ? file.modifiedTime : undefined,
          sizeBytes: typeof file.size === "string" && /^\d+$/.test(file.size) ? Number(file.size) : null
        }];
      })
    };
  }

  async searchGmailMessages(input: JsonRecord): Promise<JsonRecord> {
    const accountId = this.workspaceAccountId(input.accountId, "gmail");
    const query = String(input.query ?? "").trim().slice(0, 500);
    const page = await this.requestJson<{ messages?: Array<{ id?: string; threadId?: string }> }>(accountId,
      "https://gmail.googleapis.com/gmail/v1/users/me/messages", {
        query: { ...(query ? { q: query } : {}), maxResults: "10" }
      });
    const messages = await Promise.all((page.messages ?? []).slice(0, 10).map(async (message) => {
      if (!message.id) return null;
      const item = await this.requestJson<JsonRecord>(accountId,
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(message.id)}`, {
          query: { format: "metadata", metadataHeaders: "Subject", fields: "id,threadId,snippet,payload(headers)" }
        });
      const headers = Array.isArray(item.payload?.headers) ? item.payload.headers : [];
      const subject = headers.find((header: JsonRecord) => String(header.name).toLowerCase() === "subject")?.value;
      const from = headers.find((header: JsonRecord) => String(header.name).toLowerCase() === "from")?.value;
      return {
        id: item.id ?? message.id,
        threadId: item.threadId ?? message.threadId ?? null,
        subject: typeof subject === "string" && subject.trim() ? subject.trim() : "Untitled email",
        from: typeof from === "string" ? from : null,
        snippet: typeof item.snippet === "string" ? item.snippet : ""
      };
    }));
    return { items: messages.filter((message) => message !== null) };
  }

  captureGmailMessage(input: JsonRecord): JsonRecord {
    const messageId = typeof input.messageId === "string" ? input.messageId.trim() : "";
    if (!messageId) throw new CoreStoreError("Gmail message id is required.");
    const subject = typeof input.subject === "string" && input.subject.trim() ? input.subject.trim() : "Untitled email";
    const snippet = typeof input.snippet === "string" ? input.snippet.trim() : "";
    const from = typeof input.from === "string" && input.from.trim() ? `From: ${input.from.trim()}` : "";
    const threadId = typeof input.threadId === "string" && input.threadId.trim() ? input.threadId.trim() : messageId;
    const url = `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(threadId)}`;
    return this.store.dispatch("tasks", "create", {
      listId: input.listId,
      title: subject,
      notes: [from, snippet, `[Open in Gmail](${url})`].filter(Boolean).join("\n\n")
    });
  }

  private async sync(_input: JsonRecord): Promise<JsonRecord> {
    const requestedAccountId = typeof _input.accountId === "string" ? _input.accountId : undefined;
    const readOnly = _input.readOnly === true;
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
          if (!readOnly) {
            await this.deliverOutbox(account.accountId);
            // Pull once more so remote canonical values, including generated ids
            // and server-normalised recurrence, are reflected after a write batch.
            await this.pullGoogleTasks(account.accountId);
            await this.pullGoogleCalendars(account.accountId);
          }
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
        if (error instanceof SplitSeriesRolledBackError) {
          this.store.completeSyncMutation(mutation.id);
          throw error;
        }
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
      case "event.updateOccurrence":
        await this.updateGoogleOccurrence(accountId, mutation.entityId, mutation.payload);
        return;
      case "event.move":
        await this.moveEvent(accountId, mutation.entityId, mutation.payload);
        return;
      case "event.splitSeries":
        await this.splitGoogleSeries(accountId, mutation.payload);
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
    // A Google exception is an instance, not a recurrence master. Calendar
    // rejects recurrence data on the instance and the master already owns it.
    if (event.googleRecurringEventId) delete body.recurrence;
    const collection = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(event.calendarGoogleId)}/events`;
    let remote: JsonRecord;
    if (event.googleId) {
      remote = await this.requestJson<JsonRecord>(accountId, `${collection}/${encodeURIComponent(event.googleId)}`, {
        method: "PATCH", body: json(body), headers: conditionalHeaders(event.googleEtag), query: calendarEventWriteQuery(event)
      });
    } else {
      try {
        remote = await this.requestJson<JsonRecord>(accountId, collection, { method: "POST", body: json(body), query: calendarEventWriteQuery(event) });
      } catch (error: unknown) {
        if (!(error instanceof GoogleApiError) || error.status !== 409) throw error;
        // A previous POST reached Google but HCB stopped before persisting the
        // response. Fetching the deterministic id makes the retry safe.
        remote = await this.requestJson<JsonRecord>(accountId, `${collection}/${deterministicGoogleEventId(event.id)}`);
      }
    }
    this.store.bindGoogleEvent(localId, remote);
  }

  /** Materialize a local edit of a generated row as a Google Calendar exception. */
  private async updateGoogleOccurrence(accountId: string, localId: string, payload: JsonRecord): Promise<void> {
    const parentEventId = requiredText(payload.parentEventId, "Recurring occurrence parent event id");
    const originalStartAt = requiredIso(payload.originalStartAt, "Recurring occurrence date");
    const parent = this.store.googleEventForSync(parentEventId);
    const occurrence = this.store.googleEventForSync(localId);
    if (!parent?.googleId || !parent.calendarGoogleId || !occurrence) {
      throw new CoreStoreError("The local state for this recurring occurrence edit is incomplete.");
    }
    if (parent.calendarGoogleId !== occurrence.calendarGoogleId) {
      throw new CoreStoreError("A recurring occurrence cannot be moved to another Google calendar.");
    }
    const collection = calendarEventCollectionUrl(parent.calendarGoogleId);
    const target = await this.successorInstanceAt(accountId, collection, { id: parent.googleId }, originalStartAt, Boolean(occurrence.allDay));
    const body = googleEventBody(occurrence);
    delete body.recurrence;
    if (!target || target.status === "cancelled") {
      // This can occur only when the rule was externally changed between the
      // local projection and the write. Preserve the user edit as a standalone
      // event rather than issuing a destructive guess against the master.
      const remote = await this.requestJson<JsonRecord>(accountId, collection, {
        method: "POST", body: json(body), query: calendarEventWriteQuery(occurrence)
      });
      this.store.bindGoogleEvent(localId, remote);
      return;
    }
    const remote = await this.requestJson<JsonRecord>(accountId, `${collection}/${encodeURIComponent(requiredText(target.id, "Google occurrence id"))}`, {
      method: "PATCH",
      body: json(body),
      headers: conditionalHeaders(target.etag),
      query: calendarEventWriteQuery(occurrence)
    });
    this.store.bindGoogleEvent(localId, remote);
  }

  /**
   * Google Calendar has no public "this and following" endpoint. Recreate its
   * semantics with two masters and exception copies, compensating every
   * completed remote step if a later one fails. The durable outbox gives the
   * operation a single causal position relative to later local edits.
   */
  private async splitGoogleSeries(accountId: string, payload: JsonRecord): Promise<void> {
    const parentEventId = requiredText(payload.parentEventId, "Recurring split parent event id");
    const successorEventId = requiredText(payload.successorEventId, "Recurring split successor event id");
    const splitAt = requiredIso(payload.splitAt, "Recurring split date");
    const originalMaster = payload.originalMaster && typeof payload.originalMaster === "object"
      ? payload.originalMaster as JsonRecord
      : null;
    const parent = this.store.googleEventForSync(parentEventId);
    const successor = this.store.googleEventForSync(successorEventId);
    if (!parent?.googleId || !parent.calendarGoogleId || !successor || !originalMaster) {
      throw new CoreStoreError("The local state for this recurring-series split is incomplete.");
    }
    if (parent.calendarGoogleId !== successor.calendarGoogleId) {
      throw new CoreStoreError("A recurring-series split cannot cross Google calendars.");
    }

    const collection = calendarEventCollectionUrl(parent.calendarGoogleId);
    // Fetch before writing. Besides avoiding writes over an externally edited
    // series, this provides the iCalUID needed to fetch every exception,
    // including cancelled instances that are otherwise intentionally sparse.
    const remoteMaster = await this.requestJson<JsonRecord>(accountId, `${collection}/${encodeURIComponent(parent.googleId)}`);
    if (originalMaster.googleEtag && remoteMaster.etag && originalMaster.googleEtag !== remoteMaster.etag) {
      throw new CoreStoreError("This recurring series changed in Google before HCB could split it. Refresh it, then try again.");
    }
    const remoteExceptions = await this.seriesExceptions(accountId, collection, remoteMaster);

    let updatedParent: JsonRecord | null = null;
    let createdSuccessor: JsonRecord | null = null;
    try {
      updatedParent = await this.requestJson<JsonRecord>(accountId, `${collection}/${encodeURIComponent(parent.googleId)}`, {
        method: "PATCH",
        body: json(googleEventBody(parent)),
        headers: conditionalHeaders(remoteMaster.etag ?? parent.googleEtag),
        query: calendarEventWriteQuery(parent)
      });
      this.store.bindGoogleEvent(parentEventId, updatedParent);

      createdSuccessor = await this.insertSplitSuccessor(accountId, collection, successor);
      this.store.bindGoogleEvent(successorEventId, createdSuccessor);

      for (const exception of remoteExceptions) {
        if (!exceptionIsOnOrAfter(exception, splitAt)) continue;
        await this.copyFutureException({
          accountId,
          calendarLocalId: parent.calendarId,
          collection,
          exception,
          splitAt,
          successor,
          successorRemote: createdSuccessor
        });
      }
    } catch (error: unknown) {
      const compensationError = await this.compensateGoogleSeriesSplit({
        accountId,
        collection,
        originalMaster,
        updatedParent,
        createdSuccessor
      });
      if (!compensationError) {
        this.store.restoreGoogleSplitSeries(payload, typeof createdSuccessor?.id === "string" ? createdSuccessor.id : undefined);
        // Copying an exception replaces its cached old-parent row. The remote
        // compensation leaves those old exceptions untouched, so restore their
        // cache entries as well; otherwise an incremental pull might never
        // re-send an unchanged exception after the failed split.
        for (const exception of remoteExceptions) {
          if (exception.status !== "cancelled") this.store.upsertGoogleEvent(exception, parent.calendarId);
        }
        throw new SplitSeriesRolledBackError(`Google could not complete the recurring-series split, so HCB restored the original series: ${safeError(error)}`);
      }
      throw new CoreStoreError(`Google could not complete the recurring-series split and automatic rollback also failed. No further writes were attempted: ${compensationError}`);
    }
  }

  private async seriesExceptions(accountId: string, collection: string, master: JsonRecord): Promise<JsonRecord[]> {
    if (typeof master.iCalUID !== "string" || !master.iCalUID) {
      throw new CoreStoreError("Google did not return an iCalendar UID for this recurring series, so HCB cannot safely migrate its exceptions.");
    }
    const events = await this.allPages(accountId, collection, {
      iCalUID: master.iCalUID,
      maxResults: "2500",
      showDeleted: "true",
      singleEvents: "false"
    });
    return events.filter((event) => event.recurringEventId === master.id);
  }

  private async insertSplitSuccessor(accountId: string, collection: string, successor: JsonRecord): Promise<JsonRecord> {
    const body = googleEventBody(successor, deterministicGoogleEventId(successor.id));
    try {
      return await this.requestJson<JsonRecord>(accountId, collection, {
        method: "POST",
        body: json(body),
        query: calendarEventWriteQuery(successor)
      });
    } catch (error: unknown) {
      if (!(error instanceof GoogleApiError) || (error.status !== 409 && error.status !== 0)) throw error;
      // A network loss can happen after Google's idempotent POST was accepted.
      // The deterministic ID lets us distinguish that from a failed create
      // without ever inserting a duplicate successor.
      return await this.requestJson<JsonRecord>(accountId, `${collection}/${encodeURIComponent(deterministicGoogleEventId(successor.id))}`);
    }
  }

  private async copyFutureException(input: {
    accountId: string;
    calendarLocalId: string;
    collection: string;
    exception: JsonRecord;
    splitAt: string;
    successor: JsonRecord;
    successorRemote: JsonRecord;
  }): Promise<void> {
    const { accountId, calendarLocalId, collection, exception, splitAt, successor, successorRemote } = input;
    const oldGoogleId = requiredText(exception.id, "Google exception id");
    const oldOriginalStart = googleExceptionOriginalStart(exception);
    const allDay = Boolean(exception.originalStartTime?.date) || Boolean(successor.allDay);
    const mappedOriginalStart = shiftedOriginalStart(oldOriginalStart, splitAt, successor.startsAt, allDay);
    const target = await this.successorInstanceAt(accountId, collection, successorRemote, mappedOriginalStart, allDay);

    if (exception.status === "cancelled") {
      if (target && target.status !== "cancelled") {
        await this.requestJson<void>(accountId, `${collection}/${encodeURIComponent(target.id)}`, {
          method: "DELETE",
          headers: conditionalHeaders(target.etag)
        });
      }
      this.store.replaceGoogleSplitException(calendarLocalId, oldGoogleId, null);
      return;
    }

    let copied: JsonRecord;
    if (target && target.status !== "cancelled") {
      copied = await this.requestJson<JsonRecord>(accountId, `${collection}/${encodeURIComponent(target.id)}`, {
        method: "PATCH",
        body: json(googleExceptionBody(exception)),
        headers: conditionalHeaders(target.etag),
        query: calendarEventWriteQuery(exception)
      });
    } else {
      // A changed rule may legitimately no longer generate this original
      // occurrence. Keep the user's modified exception as a standalone event
      // rather than silently dropping its title, guests, notes, or reminders.
      copied = await this.requestJson<JsonRecord>(accountId, collection, {
        method: "POST",
        body: json(googleExceptionBody(exception)),
        query: calendarEventWriteQuery(exception)
      });
    }
    this.store.replaceGoogleSplitException(calendarLocalId, oldGoogleId, copied);
  }

  private async successorInstanceAt(
    accountId: string,
    collection: string,
    successor: JsonRecord,
    originalStart: string,
    allDay: boolean
  ): Promise<JsonRecord | null> {
    const successorId = requiredText(successor.id, "Google successor event id");
    const response = await this.requestJson<GooglePage>(accountId,
      `${collection}/${encodeURIComponent(successorId)}/instances`,
      {
        query: {
          maxResults: "5",
          originalStart: googleOriginalStartQueryValue(originalStart, allDay),
          showDeleted: "true"
        }
      }
    );
    return response.items?.find((item) => item.status !== "cancelled") ?? null;
  }

  private async compensateGoogleSeriesSplit(input: {
    accountId: string;
    collection: string;
    originalMaster: JsonRecord;
    updatedParent: JsonRecord | null;
    createdSuccessor: JsonRecord | null;
  }): Promise<string | null> {
    const errors: string[] = [];
    const { accountId, collection, originalMaster, updatedParent, createdSuccessor } = input;
    if (createdSuccessor?.id) {
      try {
        await this.requestJson<void>(accountId, `${collection}/${encodeURIComponent(createdSuccessor.id)}`, {
          method: "DELETE",
          headers: conditionalHeaders(createdSuccessor.etag)
        });
      } catch (error) {
        errors.push(`delete successor: ${safeError(error)}`);
      }
    }
    if (updatedParent?.id) {
      try {
        await this.requestJson<JsonRecord>(accountId, `${collection}/${encodeURIComponent(updatedParent.id)}`, {
          method: "PATCH",
          body: json(googleEventBody(originalMaster)),
          headers: conditionalHeaders(updatedParent.etag),
          query: calendarEventWriteQuery(originalMaster)
        });
      } catch (error) {
        errors.push(`restore parent: ${safeError(error)}`);
      }
    }
    return errors.length ? errors.join("; ") : null;
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
      { method: "PATCH", body: json(googleEventBody(event)), headers: conditionalHeaders(remote.etag), query: calendarEventWriteQuery(event) }
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

  private workspaceAccountId(value: unknown, requiredService?: "drive" | "gmail"): string {
    const accountId = typeof value === "string" && value ? value : this.store.googleAccounts().find((account) => account.accountId !== "local" && account.connectionState === "connected")?.accountId;
    if (!accountId) throw new CoreStoreError("Connect a Google account before using this feature.");
    const account = this.store.googleAccount(accountId);
    if (!account || account.connectionState !== "connected") throw new CoreStoreError("The selected Google account is not connected.");
    if (requiredService) {
      const scope = requiredService === "drive" ? "https://www.googleapis.com/auth/drive.metadata.readonly" : "https://www.googleapis.com/auth/gmail.readonly";
      if (!Array.isArray(account.grantedScopes) || !account.grantedScopes.includes(scope)) {
        throw new CoreStoreError(`Reconnect this Google account with ${requiredService === "drive" ? "Drive attachment browsing" : "Gmail capture"} enabled.`);
      }
    }
    return accountId;
  }
}

function requiredIso(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new CoreStoreError(`${label} is invalid.`);
  return new Date(value).toISOString();
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new CoreStoreError(`${label} is required.`);
  return value.trim();
}

function taskCollectionUrl(taskListId: string): string {
  return `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks`;
}

function taskUrl(taskListId: string, taskId: string): string {
  return `${taskCollectionUrl(taskListId)}/${encodeURIComponent(taskId)}`;
}

function calendarEventCollectionUrl(calendarId: string): string {
  return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
}

function googleExceptionBody(exception: JsonRecord): JsonRecord {
  const writable = [
    "summary", "description", "location", "colorId", "start", "end", "attendees", "reminders",
    "transparency", "visibility", "eventType", "focusTimeProperties", "outOfOfficeProperties",
    "workingLocationProperties", "attachments", "conferenceData", "guestsCanInviteOthers",
    "guestsCanModify", "guestsCanSeeOtherGuests", "extendedProperties"
  ];
  const body: JsonRecord = {};
  for (const key of writable) {
    if (Object.prototype.hasOwnProperty.call(exception, key)) body[key] = exception[key];
  }
  if (!body.start || !body.end) {
    throw new CoreStoreError("Google returned an incomplete recurring exception, so HCB cannot safely preserve it during this split.");
  }
  // An exception is an instance: Calendar rejects recurrence data on it.
  delete body.recurrence;
  return body;
}

function googleExceptionOriginalStart(exception: JsonRecord): string {
  const original = exception.originalStartTime;
  if (!original || typeof original !== "object") throw new CoreStoreError("Google returned a recurring exception without originalStartTime.");
  if (typeof original.dateTime === "string" && Number.isFinite(Date.parse(original.dateTime))) return new Date(original.dateTime).toISOString();
  if (typeof original.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(original.date)) return `${original.date}T00:00:00.000Z`;
  throw new CoreStoreError("Google returned a recurring exception with an invalid originalStartTime.");
}

function exceptionIsOnOrAfter(exception: JsonRecord, splitAt: string): boolean {
  return Date.parse(googleExceptionOriginalStart(exception)) >= Date.parse(splitAt);
}

function shiftedOriginalStart(originalStart: string, splitAt: string, successorStartsAt: string, allDay: boolean): string {
  const original = Date.parse(originalStart);
  const split = Date.parse(splitAt);
  const successor = Date.parse(successorStartsAt);
  if (![original, split, successor].every(Number.isFinite)) throw new CoreStoreError("Recurring exception split date is invalid.");
  if (allDay) {
    const dayDelta = Math.round((successor - split) / (24 * 60 * 60 * 1_000));
    return new Date(original + dayDelta * 24 * 60 * 60 * 1_000).toISOString();
  }
  return new Date(original + successor - split).toISOString();
}

function googleTaskBody(task: JsonRecord): JsonRecord {
  const due = googleTaskDue(task.dueAt);
  const notes = withHcbTaskMetadata(task.notes, task);
  if (String(task.title ?? "").length > googleTaskTitleMaxLength) {
    throw new CoreStoreError(`Google Tasks titles are limited to ${googleTaskTitleMaxLength} characters.`);
  }
  if (notes.length > googleTaskNotesMaxLength) {
    throw new CoreStoreError(`Google Tasks notes, including HCB planning metadata, are limited to ${googleTaskNotesMaxLength} characters.`);
  }
  return {
    title: task.title,
    notes: notes || undefined,
    // Google Tasks accepts an RFC 3339 timestamp here (although it only
    // retains the calendar-date portion). HCB intentionally stores task
    // dates as date-only values, so normalize those before writing. Omitting
    // the field is also important: the API rejects an explicit null due date.
    ...(due ? { due } : {}),
    status: task.status === "completed" ? "completed" : "needsAction"
  };
}

function googleTaskDue(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return `${normalized}T00:00:00.000Z`;
  return Number.isFinite(Date.parse(normalized)) ? new Date(normalized).toISOString() : undefined;
}

function googleEventBody(event: JsonRecord, createId?: string): JsonRecord {
  // RFC 5545 lines are HCB's canonical Calendar recurrence value. The
  // structured recurrence remains only for old local records and is promoted
  // during the next write; no imported Google recurrence is projected down.
  const recurrence = preservedGoogleRecurrence(event.recurrenceLines)
    ?? preservedGoogleRecurrence(event.googleRecurrence)
    ?? googleRecurrence(event.recurrence);
  const eventType = event.eventType === "focusTime" || event.eventType === "outOfOffice" || event.eventType === "workingLocation"
    ? event.eventType
    : "default";
  return {
    ...(createId ? { id: createId, extendedProperties: { private: { hcbLocalEventId: event.id } } } : {}),
    summary: event.title,
    description: event.description || undefined,
    location: event.location || undefined,
    colorId: googleCalendarEventColorIdForApi(event.colorId),
    start: googleEventTime(event.startsAt, Boolean(event.allDay), event.timeZone),
    end: googleEventTime(event.endsAt, Boolean(event.allDay), event.timeZone),
    recurrence: recurrence ?? [],
    attendees: normalizeAttendees(event.attendees),
    reminders: {
      useDefault: Boolean(event.remindersUseDefault),
      ...(event.remindersUseDefault ? {} : { overrides: safeArray(event.reminders) })
    },
    transparency: event.transparency || "opaque",
    visibility: event.visibility || "default",
    ...(eventType !== "default" ? { eventType } : {}),
    ...(eventType === "focusTime" && event.focusTimeProperties ? { focusTimeProperties: event.focusTimeProperties } : {}),
    ...(eventType === "outOfOffice" && event.outOfOfficeProperties ? { outOfOfficeProperties: event.outOfOfficeProperties } : {}),
    ...(eventType === "workingLocation" && event.workingLocationProperties ? { workingLocationProperties: event.workingLocationProperties } : {}),
    ...(event.attachmentsManaged ? { attachments: calendarAttachments(event.attachments) } : {}),
    ...(event.conferenceCreateRequested && !event.conference?.videoUri ? {
      conferenceData: {
        createRequest: {
          requestId: `hcb-${String(event.id).replace(/[^a-zA-Z0-9-]/g, "").slice(0, 100)}`,
          conferenceSolutionKey: { type: "hangoutsMeet" }
        }
      }
    } : {})
  };
}

function calendarEventWriteQuery(event: JsonRecord): Record<string, string> {
  return {
    supportsAttachments: "true",
    ...(event.conferenceCreateRequested || event.conference ? { conferenceDataVersion: "1" } : {})
  };
}

function calendarAttachments(value: unknown): JsonRecord[] {
  return safeArray(value)
    .filter((attachment) => typeof attachment.fileUrl === "string" && /^https:\/\//i.test(attachment.fileUrl))
    .map((attachment) => ({
      fileUrl: attachment.fileUrl,
      title: typeof attachment.title === "string" && attachment.title ? attachment.title : attachment.fileUrl,
      ...(typeof attachment.mimeType === "string" ? { mimeType: attachment.mimeType } : {})
    }));
}

function deterministicGoogleEventId(localId: string): string {
  // Google Calendar event ids use lower-case base32hex. UUID hex is a valid
  // subset; the prefix makes app-created ids recognisable without exposing
  // credentials or account identity.
  return `hcb${String(localId).replace(/[^a-f0-9]/gi, "").toLowerCase()}`.slice(0, 1024);
}

function googleEventTime(value: string, allDay: boolean, timeZone: unknown): JsonRecord {
  const zone = typeof timeZone === "string" && timeZone ? { timeZone } : {};
  if (!allDay) return { dateTime: value, ...zone };
  return { date: value.slice(0, 10), ...zone };
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

function preservedGoogleRecurrence(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const lines = value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  return lines.length > 0 ? lines : [];
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
