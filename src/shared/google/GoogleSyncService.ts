import { CoreStore, CoreStoreError, type PendingSyncMutation, type GoogleSyncBatch } from "../core/CoreStore";
import type { GoogleSyncOAuth, GoogleSyncPlatform, GoogleUploadSource, SyncCheckpoint } from "./types";
import { SyncPersistenceError } from "./types";
export { SyncPersistenceError } from "./types";
import { googleTaskBody, googleEventBody } from "./googleWriteBody";
import { googleRemoteBaseline, syncValuesEqual } from "./syncMerge";
import { googleOriginalStartQueryValue } from "../core/googleRecurrence";
import { recordTiming, timedAsync } from "../core/performance";
import { splitHcbTaskMetadata } from "../core/hcbTaskMetadata";
import type { GoogleResolutionSnapshot, SyncResolutionContext } from "../core/syncResolution";
import { resolutionGoogleEvent, resolutionLocalRecord } from "../core/syncResolution";
import type { SyncResolutionPreview } from "@shared/syncResolution";

type JsonRecord = Record<string, any>;
type WorkspaceService = "driveSearch" | "driveUpload" | "gmail";

const driveUploadFolderName = "Hot Cross Buns attachments";
const resumableUploadChunkBytes = 256 * 1024;
const maximumDriveUploadBytes = 512 * 1024 * 1024;

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

class ConcurrentSeriesEditError extends CoreStoreError {
  constructor() { super('Local changes arrived during a recurring-series split. They are saved. Compare Google in Diagnostics before continuing this split.'); }
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
  private splittingAccountId?: string;
  private inFlight: Promise<JsonRecord> | null = null;
  private resolvingMutation = false;
  private readonly statusListeners = new Set<(status: JsonRecord) => void>();
  private currentMutationId: string | undefined;
  private interval: ReturnType<typeof setTimeout> | null = null;
  private writeDebounce: ReturnType<typeof setTimeout> | null = null;
  private readonly resolutionReviews = new Map<string, { mutationId: string; version: string; fingerprint: string; expires: number }>();

  constructor(
    private readonly store: CoreStore,
    private readonly oauth: GoogleSyncOAuth,
    private readonly platform: GoogleSyncPlatform = {}
  ) {
    if (platform.automaticConnectionSync !== false) oauth.onConnectionChange(() => {
      void this.runNow({ reason: "connection-change" }).catch(() => undefined);
    });
  }

  runNow(input: JsonRecord = {}): Promise<JsonRecord> {
    if (this.inFlight) return this.resolvingMutation
      ? this.inFlight.catch(() => undefined).then(() => this.runNow(input))
      : this.inFlight;
    const startedAt = performance.now();
    this.inFlight = this.sync(input).finally(() => {
      this.inFlight = null;
      recordTiming({ kind: "sync", name: "google.sync", durationMs: performance.now() - startedAt });
    });
    return this.inFlight;
  }

  onStatus(listener: (status: JsonRecord) => void): () => void {
    this.statusListeners.add(listener);
    return () => { this.statusListeners.delete(listener); };
  }

  private async checkpoint(stage: SyncCheckpoint['stage']): Promise<void> {
    if (!this.platform.checkpoint) return;
    const checkpoint: SyncCheckpoint = { stage, ...(this.currentMutationId ? { mutationId: this.currentMutationId } : {}) };
    try { await timedAsync(`google.checkpoint.${stage}`, 'sync', () => this.platform.checkpoint!(checkpoint)); }
    catch (error) { throw error instanceof SyncPersistenceError ? error : new SyncPersistenceError(checkpoint, error); }
  }

  /** Explicit refresh always works; automatic activity follows the user's mode. */
  async runAutomatic(reason: string): Promise<void> {
    if (this.syncSettings().syncMode === "manual") return;
    await this.runNow({ reason });
  }

  private syncSettings(): JsonRecord {
    return this.store.dispatch("settings", "get", {});
  }

  startBackgroundSync(): void {
    this.stopBackgroundSync();
    const mode = this.syncSettings().syncMode;
    if (mode === "manual") return;
    const intervalMs = mode === "near-real-time" ? 30_000 : 5 * 60_000;
    this.interval = setInterval(() => void this.runAutomatic("interval").catch(() => undefined), intervalMs);
    (this.interval as unknown as { unref?: () => void }).unref?.();
  }

  stopBackgroundSync(): void {
    if (this.interval) clearInterval(this.interval);
    if (this.writeDebounce) clearTimeout(this.writeDebounce);
    this.interval = null;
    this.writeDebounce = null;
  }

  async shutdown(): Promise<void> {
    this.stopBackgroundSync();
    while (this.inFlight) await this.inFlight.catch(() => undefined);
  }

  scheduleAfterLocalMutation(): void {
    if (this.writeDebounce) clearTimeout(this.writeDebounce);
    const mode = this.syncSettings().syncMode;
    if (mode === "manual") {
      this.writeDebounce = null;
      return;
    }
    this.writeDebounce = setTimeout(() => {
      this.writeDebounce = null;
      void this.runAutomatic("local-mutation").catch(() => undefined);
    }, mode === "near-real-time" ? 150 : 500);
  }

  async forceFullResync(input: JsonRecord = {}): Promise<JsonRecord> {
    const accountId = typeof input.accountId === "string" ? input.accountId : undefined;
    // An active pull can still save its old checkpoint. Let it finish before
    // resetting tokens, then start a distinct full pull instead of coalescing.
    while (this.inFlight) await this.inFlight.catch(() => undefined);
    this.store.resetGoogleSyncTokens(accountId);
    return this.runNow({ reason: "force-full", ...(accountId ? { accountId } : {}) });
  }

  private async resolutionSnapshot(context: SyncResolutionContext): Promise<GoogleResolutionSnapshot> {
    const accountId = this.workspaceAccountId(context.mutation.accountId);
    const snapshot: GoogleResolutionSnapshot = {};
    if (context.entities.some((entity) => entity.kind !== "event")) {
      snapshot.lists = [];
      for (const remote of await this.allPages(accountId, "https://tasks.googleapis.com/tasks/v1/users/@me/lists", { maxResults: "100" })) {
        const tasks = await this.allPages(accountId, taskCollectionUrl(remote.id), { maxResults: "100", showCompleted: "true", showHidden: "true", showDeleted: "true" });
        snapshot.lists.push({ remote, tasks });
      }
    }
    if (context.entities.some((entity) => entity.kind === "event")) {
      snapshot.calendars = [];
      for (const remote of await this.allPages(accountId, "https://www.googleapis.com/calendar/v3/users/me/calendarList", { maxResults: "250", showDeleted: "true" })) {
        if (remote.deleted) continue;
        const page = await this.allPagesWithSyncToken(accountId, calendarEventCollectionUrl(remote.id), { maxResults: "2500", showDeleted: "true", singleEvents: "false" });
        snapshot.calendars.push({ remote, events: page.items, token: page.nextSyncToken });
      }
    }
    return snapshot;
  }

  async previewMutationResolution(input: JsonRecord): Promise<SyncResolutionPreview> {
    while (this.inFlight) await this.inFlight.catch(() => undefined);
    const context = this.store.syncResolutionContext(requiredText(input.id, "Mutation id"));
    const snapshot = await this.resolutionSnapshot(context);
    if (this.store.syncResolutionContext(context.mutation.id).version !== context.version) throw new CoreStoreError("Local changes arrived during comparison. Compare again.");
    const reviewId = globalThis.crypto.randomUUID();
    for (const [id, review] of this.resolutionReviews) if (review.expires < Date.now()) this.resolutionReviews.delete(id);
    if (this.resolutionReviews.size >= 5) this.resolutionReviews.delete(this.resolutionReviews.keys().next().value!);
    this.resolutionReviews.set(reviewId, { mutationId: context.mutation.id, version: context.version, fingerprint: await snapshotFingerprint(snapshot, this.platform.fingerprint), expires: Date.now() + 5 * 60_000 });
    const lists = new Map(snapshot.lists?.map((list) => [list.remote.id, list]));
    const tasks = new Map(snapshot.lists?.flatMap((list) => list.tasks.map((task) => [task.id, { task, list }] as const)));
    const items = context.entities.map((entity) => {
      const local = resolutionLocalRecord(context, entity.id);
      const event = entity.kind === "event" ? resolutionGoogleEvent(context, entity.id, snapshot, (id) => this.store.googleCalendarForSync(id)) : null;
      const task = entity.kind === "task" ? tasks.get(local?.googleId) : null;
      const remote = entity.kind === "taskList" ? lists.get(local?.googleId)?.remote : entity.kind === "task" ? task?.task : event?.event;
      const localFields = resolutionFields(entity.kind, entity.local);
      const googleFields = resolutionFields(entity.kind, remote ?? null, true, entity.local);
      if (entity.kind === "task") {
        if (localFields) { localFields.list = this.store.googleTaskListForSync(local?.listId)?.title ?? "Unavailable list"; localFields.parent = local?.parentId ? this.store.googleTaskForSync(local.parentId)?.title ?? "Unavailable parent" : null; }
        if (googleFields) { googleFields.list = task?.list.remote.title; googleFields.parent = remote?.parent ? tasks.get(remote.parent)?.task.title ?? "Unavailable parent" : null; }
        const order = context.mutations.filter((mutation) => mutation.entityId === entity.id && Object.hasOwn(mutation.payload, "previousTaskId")).at(-1);
        if (order && localFields && googleFields && task) {
          localFields.after = order.payload.previousTaskId ? this.store.googleTaskForSync(order.payload.previousTaskId)?.title ?? "Unavailable task" : "Start of list";
          const siblings = task.list.tasks.filter((sibling) => !sibling.deleted && (sibling.parent ?? null) === (remote?.parent ?? null)).sort((a, b) => String(a.position ?? "").localeCompare(String(b.position ?? "")));
          const index = siblings.findIndex((sibling) => sibling.id === remote?.id);
          googleFields.after = index > 0 ? siblings[index - 1].title : "Start of list";
        }
      }
      if (entity.kind === "event") {
        if (localFields) localFields.calendar = this.store.googleCalendarForSync(local?.calendarId)?.title ?? "Unavailable calendar";
        if (googleFields) googleFields.calendar = event?.calendar.remote.summary ?? event?.calendar.remote.title;
      }
      return { id: entity.id, kind: entity.kind, title: local?.title ?? "Locally deleted item", local: localFields, google: googleFields };
    });
    const split = context.mutations.some((mutation) => mutation.kind === "event.splitSeries");
    const removed = context.entities.some((entity, index) => entity.local?.googleId && (!items[index].google || items[index].google?.status === "deleted") &&
      !context.mutations.some((mutation) => mutation.entityId === entity.id && mutation.kind.endsWith(".delete")));
    const canKeepLocal = !context.uncertainCreation && !split && !removed;
    return { id: context.mutation.id, reviewId, affectedCount: context.mutations.length, uncertainCreation: context.uncertainCreation, canKeepLocal, items,
      message: context.uncertainCreation
        ? "Google may already have accepted this creation. Keeping local is blocked to prevent duplicates. Use Google imports the current remote items and removes the unlinked local draft and its dependent edits. Copy any local text you want to preserve first."
        : split ? "This recurring-series split may have changed several Google records. Use Google restores their actual remote state together. Copy any local content you want to preserve before discarding and starting a new split."
        : removed ? "A linked item was removed in Google. Copy any local content you want to preserve before using Google; overwriting a missing remote record is unavailable."
        : "This decision covers the related queued changes shown below. Use Google restores the fetched version immediately; keep local queues an explicit overwrite. Unrelated queued changes remain pending." };
  }

  resolveMutation(input: JsonRecord): Promise<JsonRecord> {
    // Reserve the same lock as sync before the first await, including another
    // recovery request. Background delivery cannot race the reviewed decision.
    if (this.inFlight) return Promise.reject(new CoreStoreError("Sync is running. Wait for it to finish, then resolve again."));
    this.resolvingMutation = true;
    this.inFlight = this.applyMutationResolution(input).finally(() => { this.resolvingMutation = false; this.inFlight = null; });
    return this.inFlight;
  }

  private async applyMutationResolution(input: JsonRecord): Promise<JsonRecord> {
    const reviewId = requiredText(input.reviewId, "Comparison id");
    const review = this.resolutionReviews.get(reviewId);
    if (!review || review.expires < Date.now() || review.mutationId !== input.id) throw new CoreStoreError("This comparison expired. Compare again before resolving.");
    const current = this.store.syncResolutionContext(review.mutationId);
    if (current.version !== review.version) throw new CoreStoreError("Local changes arrived after comparison. Compare again before resolving.");
    const snapshot = await this.resolutionSnapshot(current);
    if (await snapshotFingerprint(snapshot, this.platform.fingerprint) !== review.fingerprint) throw new CoreStoreError("Google changed after comparison. Compare again before resolving.");
    if (this.store.syncResolutionContext(current.mutation.id).version !== current.version) throw new CoreStoreError("Local changes arrived during recovery. Compare again before resolving.");
    let result: JsonRecord;
    if (input.strategy === "google") result = this.store.applyGoogleResolution(current, snapshot);
    else if (input.strategy === "local") {
      if (current.mutations.some((mutation) => mutation.kind === "event.splitSeries")) throw new CoreStoreError("Restore Google's recurring-series state before starting a new split.");
      for (const entity of current.entities) {
        if (!entity.local?.googleId || current.mutations.some((mutation) => mutation.entityId === entity.id && mutation.kind.endsWith(".delete"))) continue;
        if (entity.kind === "event") {
          const target = resolutionGoogleEvent(current, entity.id, snapshot, (id) => this.store.googleCalendarForSync(id));
          if (!target || target.event.status === "cancelled") throw new CoreStoreError("This item was removed in Google. Preserve local content before using Google or creating a new item.");
          continue;
        }
        const remote = entity.kind === "taskList" ? snapshot.lists?.map((list) => list.remote)
          : entity.kind === "task" ? snapshot.lists?.flatMap((list) => list.tasks)
          : snapshot.calendars?.flatMap((calendar) => calendar.events);
        if (!remote?.some((item) => item.id === entity.local!.googleId && !item.deleted && item.status !== "cancelled")) throw new CoreStoreError("This item was removed in Google. Preserve local content before using Google or creating a new item.");
      }
      result = this.store.retryGoogleResolution(current, snapshot);
    }
    else throw new CoreStoreError("Choose keep local or use Google.");
    this.resolutionReviews.delete(reviewId);
    await this.checkpoint('resolution');
    await this.publishDurableStatus({ state: "idle", stale: false, offline: false, message: input.strategy === "google" ? "Google's version was restored locally." : "Related local changes are queued for sync." });
    return result;
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
    const accountId = this.workspaceAccountId(input.accountId, "driveSearch");
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

  /** Upload a user-selected byte source; the browser supplies Blob slices. */
  async uploadDriveSource(input: { accountId?: unknown; source: GoogleUploadSource }): Promise<JsonRecord> {
    const accountId = this.workspaceAccountId(input.accountId, "driveUpload");
    const file = input.source;
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > maximumDriveUploadBytes) {
      throw new CoreStoreError("Files larger than 512 MB cannot be uploaded from a description reference.");
    }
    const title = safeDriveFileName(file.name);
    const mimeType = file.type || mimeTypeForPath(file.name);
    const operations = this.platform.operations;
    const operationKey = operations ? await this.driveUploadKey(file, title, mimeType) : undefined;
    const previous = operationKey ? operations!.read(accountId, operationKey) : null;
    let fileId = typeof previous?.fileId === 'string' ? previous.fileId : undefined;
    if (fileId) {
      const existing = await this.driveFileById(accountId, fileId);
      if (existing) {
        if (existing.trashed) throw new CoreStoreError('The previous upload is in Google Drive trash. Restore it in Drive before reusing its link.');
        if (Number(existing.size) !== file.size) throw new CoreStoreError('The previous upload has a different size in Google Drive. Check Drive before retrying.');
        return this.completeDriveUpload(accountId, operationKey!, fileId, existing, file.size, mimeType);
      }
      if (previous?.state === 'complete') throw new CoreStoreError('The previous uploaded file was removed from Google Drive. Choose a renamed copy to upload it again.');
    }
    const folderId = await this.ensureDriveUploadFolder(accountId);
    if (operationKey && !fileId) {
      fileId = await this.generateDriveId(accountId);
      operations!.write(accountId, operationKey, { fileId, state: 'pending', name: title, size: file.size });
    }
    let uploaded: JsonRecord;
    try {
      const sessionUrl = await this.startResumableDriveUpload(accountId, {
        mimeType, name: title, parentId: folderId, sizeBytes: file.size, ...(fileId ? { id: fileId } : {})
      });
      uploaded = await this.finishResumableDriveUpload(accountId, sessionUrl, file, file.size, mimeType);
    } catch (error) {
      if (error instanceof SyncPersistenceError) throw error;
      // A resumable completion may have reached Google before its response was
      // lost. A persisted pre-generated ID reconciles that exact file only.
      if (!fileId || !(error instanceof GoogleApiError) || ![0, 408, 409, 500, 502, 503, 504].includes(error.status)) throw error;
      const existing = await this.driveFileById(accountId, fileId);
      if (!existing || existing.trashed || Number(existing.size) !== file.size) throw error;
      uploaded = existing;
    }
    if (operationKey && fileId) return this.completeDriveUpload(accountId, operationKey, fileId, uploaded, file.size, mimeType);
    return this.driveUploadResult(uploaded, file.size, mimeType);
  }

  private async driveUploadKey(file: GoogleUploadSource, name: string, type: string): Promise<string> {
    // Bounded-memory content identity survives a lost tab and file reselection.
    // Hashes of fixed-size chunks avoid reading a 512 MB file into one buffer.
    const chunks: string[] = [];
    for (let offset = 0; offset < file.size; offset += resumableUploadChunkBytes) {
      const bytes = await file.read(offset, Math.min(resumableUploadChunkBytes, file.size - offset));
      chunks.push(await sha256(bytes));
    }
    return `drive-upload:${await sha256(new TextEncoder().encode(JSON.stringify({ name, type, size: file.size, chunks })))}`;
  }

  private async completeDriveUpload(accountId: string, key: string, fileId: string, uploaded: JsonRecord, size: number, mimeType: string): Promise<JsonRecord> {
    if (uploaded.id !== fileId) throw new CoreStoreError('Google Drive returned an unexpected file identity. Check Drive before retrying.');
    const result = this.driveUploadResult(uploaded, size, mimeType);
    this.platform.operations!.write(accountId, key, { fileId, state: 'complete', result });
    await this.checkpoint('upload-receipt');
    return result;
  }

  private driveUploadResult(uploaded: JsonRecord, size: number, mimeType: string): JsonRecord {
    if (typeof uploaded.id !== "string" || typeof uploaded.name !== "string" || typeof uploaded.webViewLink !== "string") {
      throw new CoreStoreError("Google Drive did not return a link for the uploaded file.");
    }
    return {
      fileId: uploaded.id, fileUrl: uploaded.webViewLink,
      iconLink: typeof uploaded.iconLink === "string" ? uploaded.iconLink : undefined,
      mimeType: typeof uploaded.mimeType === "string" ? uploaded.mimeType : mimeType,
      modifiedTime: typeof uploaded.modifiedTime === "string" ? uploaded.modifiedTime : undefined,
      sizeBytes: typeof uploaded.size === "string" && /^\d+$/.test(uploaded.size) ? Number(uploaded.size) : size,
      title: uploaded.name
    };
  }

  async searchGmailMessages(input: JsonRecord): Promise<JsonRecord> {
    const accountId = this.workspaceAccountId(input.accountId, "gmail");
    const query = String(input.query ?? "").trim().slice(0, 500);
    const page = await this.requestJson<{ messages?: Array<{ id?: string; threadId?: string }> }>(accountId,
      "https://gmail.googleapis.com/gmail/v1/users/me/messages", {
        query: { ...(query ? { q: query } : {}), maxResults: "10" }
      });
    const messages: JsonRecord[] = [];
    for (const message of (page.messages ?? []).slice(0, 10)) {
      if (!message.id) continue;
      const item = await this.requestJson<JsonRecord>(accountId,
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(message.id)}`, {
          query: { format: "metadata", metadataHeaders: "Subject", fields: "id,threadId,snippet,payload(headers)" }
        });
      const headers = Array.isArray(item.payload?.headers) ? item.payload.headers : [];
      const subject = headers.find((header: JsonRecord) => String(header.name).toLowerCase() === "subject")?.value;
      const from = headers.find((header: JsonRecord) => String(header.name).toLowerCase() === "from")?.value;
      messages.push({
        id: item.id ?? message.id,
        threadId: item.threadId ?? message.threadId ?? null,
        subject: typeof subject === "string" && subject.trim() ? subject.trim() : "Untitled email",
        from: typeof from === "string" ? from : null,
        snippet: typeof item.snippet === "string" ? item.snippet : ""
      });
    }
    return { items: messages };
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
      account.accountId !== "local" && account.connectionState === "connected" && (!requestedAccountId || account.accountId === requestedAccountId) &&
      (this.platform.accountAvailable?.(account.accountId) ?? true)
    );
    if (accounts.length === 0) {
      const status = {
        state: "idle",
        pendingMutationCount: this.store.pendingSyncMutations().length,
        offline: false,
        stale: false,
        message: "Connect Google before syncing."
      };
      return this.publishDurableStatus(status);
    }

    this.publishStatus({ state: "syncing", pendingMutationCount: this.store.pendingSyncMutations().length, offline: false, stale: false });
    try {
      const settings = this.syncSettings();
      const failures: Error[] = [];
      const missingServices = new Set<string>();
      let grantedServices = 0;
      for (const account of accounts) {
        try {
          const allowed = this.platform.accountCapabilities?.(account.accountId) ?? { tasks: true, calendar: true };
          grantedServices += Number(allowed.tasks) + Number(allowed.calendar);
          if (!allowed.tasks && settings.syncTasksEnabled !== false) missingServices.add('Tasks');
          if (!allowed.calendar && settings.syncCalendarEventsEnabled !== false) missingServices.add('Calendar');
          if (settings.syncTasksEnabled !== false && allowed.tasks) await timedAsync('google.pull.tasks', 'sync', () => this.pullGoogleTasks(account.accountId));
          if (settings.syncCalendarEventsEnabled !== false && allowed.calendar) await timedAsync('google.pull.calendar', 'sync', () => this.pullGoogleCalendars(account.accountId));
          if (!readOnly) {
            const hasPendingWrites = this.store.pendingSyncMutations(100, account.accountId).length > 0;
            await timedAsync('google.outbox', 'sync', () => this.deliverOutbox(account.accountId));
            // Pull once more so remote canonical values, including generated ids
            // and server-normalised recurrence, are reflected after a write batch.
            if (hasPendingWrites) {
              if (settings.syncTasksEnabled !== false && allowed.tasks) await timedAsync('google.pull.tasks', 'sync', () => this.pullGoogleTasks(account.accountId));
              if (settings.syncCalendarEventsEnabled !== false && allowed.calendar) await timedAsync('google.pull.calendar', 'sync', () => this.pullGoogleCalendars(account.accountId));
            }
          }
          await this.platform.accountSyncFinished?.(account.accountId, true);
        } catch (error: unknown) {
          if (error instanceof SyncPersistenceError) throw error;
          await this.platform.accountSyncFinished?.(account.accountId, false);
          failures.push(error instanceof Error ? error : new Error("Google sync failed."));
        }
      }
      if (failures.length) throw failures[0];
      const status = {
        state: grantedServices ? "idle" : "error",
        pendingMutationCount: this.store.pendingSyncMutations().length,
        offline: false,
        stale: !grantedServices,
        ...(grantedServices ? { lastCompletedAt: new Date().toISOString() } : {}),
        lastErrorCode: grantedServices ? null : 'AUTH_SCOPE_REQUIRED',
        ...(missingServices.size ? { message: `${grantedServices ? 'Synced granted services.' : 'Google Tasks and Calendar access is unavailable.'} Reconnect Google and allow ${[...missingServices].join(' and ')} to sync those pending changes.`, missingServices: [...missingServices] } : {})
      };
      return await this.publishDurableStatus(status);
    } catch (error: unknown) {
      if (error instanceof SyncPersistenceError) throw error;
      const status = {
        state: "error",
        pendingMutationCount: this.store.pendingSyncMutations().length,
        offline: error instanceof GoogleApiError && error.status === 0,
        stale: true,
        message: safeError(error),
        lastErrorCode: error instanceof GoogleApiError ? String(error.status) : "LOCAL_ERROR"
      };
      await this.publishDurableStatus(status);
      throw error;
    }
  }

  private async pullGoogleTasks(accountId: string): Promise<void> {
    const taskLists = await this.allPages(accountId, "https://tasks.googleapis.com/tasks/v1/users/@me/lists", { maxResults: "100" });
    for (const remoteList of taskLists) {
      if (this.store.googleDeletionPending('taskList', accountId, remoteList.id)) continue;
      const localList = this.store.upsertGoogleTaskList(remoteList, accountId);
      if (!this.store.isSelectedTaskList(localList.id)) continue;
      const key = `tasks-updated:${remoteList.id}`;
      const previous = this.store.googleSyncToken(accountId, key);
      const previousUpdate = previous && Number.isFinite(Date.parse(previous)) ? Date.parse(previous) : 0;
      let checkpoint = previousUpdate;
      // Checkpoint the first response's server clock, never the newest item
      // seen on a later page: an earlier page may change during pagination.
      const updatedMin = previousUpdate ? new Date(previousUpdate - 1000).toISOString() : undefined;
      const fullSnapshotIds = updatedMin ? null : new Set<string>();
      await this.streamPages(accountId,
        `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(remoteList.id)}/tasks`,
        { maxResults: "100", showCompleted: "true", showHidden: "true", showDeleted: "true", ...(updatedMin ? { updatedMin } : {}) },
        async (tasks) => {
          for (const task of tasks) if (typeof task.id === "string") fullSnapshotIds?.add(task.id);
          this.store.upsertGoogleTaskBatch(tasks, localList.id);
          await (this.platform.yieldToRequests?.() ?? new Promise<void>((resolve) => setTimeout(resolve, 0)));
        },
        (response) => {
          const serverTime = Date.parse(response.headers.get("date") ?? "");
          if (Number.isFinite(serverTime)) checkpoint = Math.max(checkpoint, serverTime);
        }
      );
      if (fullSnapshotIds) this.store.reconcileGoogleTasks(localList.id, fullSnapshotIds);
      this.store.reconcileGoogleTaskParents(localList.id);
      if (checkpoint) this.store.setGoogleSyncToken(accountId, key, new Date(checkpoint).toISOString());
    }
    // Import moves into surviving lists first so their stable local ids survive
    // removal of a former list. Never prune from a partial list response.
    this.store.pruneGoogleTaskLists(accountId, taskLists.map((list) => requiredText(list.id, "Google task-list id")));
    await this.checkpoint('pull-complete');
  }

  private publishStatus(status: JsonRecord, emit = true): JsonRecord {
    this.store.setSyncRuntime(status);
    const stored = this.store.dispatch("sync", "status", {});
    const current = { ...status, ...(stored.state === "error" ? stored : {}),
      pendingMutationCount: stored.pendingMutationCount ?? this.store.pendingSyncMutations().length };
    if (emit) for (const listener of this.statusListeners) listener(current);
    return current;
  }

  private async publishDurableStatus(status: JsonRecord): Promise<JsonRecord> {
    const current = this.publishStatus(status, false);
    await this.checkpoint('sync-status');
    for (const listener of this.statusListeners) listener(current);
    return current;
  }

  private async pullGoogleCalendars(accountId: string): Promise<void> {
    const remoteCalendars = await this.allPages(accountId, "https://www.googleapis.com/calendar/v3/users/me/calendarList", {
      maxResults: "250", showDeleted: "true"
    });
    this.store.pruneGoogleCalendars(accountId, remoteCalendars.flatMap((calendar) =>
      !calendar.deleted && typeof calendar.id === "string" ? [calendar.id] : []
    ));
    for (const remoteCalendar of remoteCalendars) {
      if (remoteCalendar.deleted) continue;
      const localCalendar = this.store.upsertGoogleCalendar(remoteCalendar, accountId);
      if (this.store.isSelectedCalendar(localCalendar.id)) await this.pullGoogleEvents(accountId, localCalendar);
    }
    await this.checkpoint('pull-complete');
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
    const fullSnapshotIds = syncToken ? null : new Set<string>();

    try {
      const nextSyncToken = await this.streamPages(accountId,
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(googleId)}/events`,
        query,
        async (events) => {
          for (const event of events) if (typeof event.id === "string") fullSnapshotIds?.add(event.id);
          for (let index = 0; index < events.length; index += 100) {
            this.store.upsertGoogleEventBatch(events.slice(index, index + 100), localCalendar.id);
            await (this.platform.yieldToRequests?.() ?? new Promise<void>((resolve) => setTimeout(resolve, 0)));
          }
        }
      );
      if (!nextSyncToken) throw new CoreStoreError("Google did not return a Calendar sync token. Retry the pull.");
      // A full snapshot is authoritative only after its final page. Keep local
      // creations and unresolved edits; incremental responses are only deltas.
      if (fullSnapshotIds) this.store.reconcileGoogleEvents(localCalendar.id, fullSnapshotIds);
      this.store.setGoogleSyncToken(accountId, tokenKey, nextSyncToken);
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
    for (const queued of this.store.pendingSyncMutations(100, accountId)) {
      if (this.store.googleAccount(accountId)?.connectionState !== 'connected' || this.platform.accountAvailable?.(accountId) === false) break;
      const settings = this.syncSettings();
      const allowed = this.platform.accountCapabilities?.(accountId) ?? { tasks: true, calendar: true };
      // A previous receipt can update a queued delete/move while HTTP is pending.
      // Re-read eligibility too: a local recovery action may cancel this chain.
      const mutation = this.store.pendingSyncMutations(100, accountId).find(item => item.id === queued.id);
      if (!mutation) continue;
      if ((mutation.kind.startsWith("task") && (settings.syncTasksEnabled === false || !allowed.tasks)) ||
          (mutation.kind.startsWith("event") && (settings.syncCalendarEventsEnabled === false || !allowed.calendar))) continue;
      const nonIdempotentCreate =
        (["task.create", "task.update"].includes(mutation.kind) && !this.store.googleTaskForSync(mutation.entityId)?.googleId) ||
        (["taskList.create", "taskList.update"].includes(mutation.kind) && !this.store.googleTaskListForSync(mutation.entityId)?.googleId);
      try {
        this.currentMutationId = mutation.id;
        const batch = await this.prepareDeliveryBatch(accountId, mutation);
        // A multi-request series split also needs explicit review if the worker
        // stops partway through it. Native tooling keeps its existing behavior.
        if (nonIdempotentCreate || (this.platform.checkpoint && mutation.kind === 'event.splitSeries')) this.store.beginSyncCreation(mutation.id);
        if (batch) await this.deliverGoogleBatch(batch);
        else {
          await this.deliverMutation(accountId, mutation);
          this.store.completeSyncMutation(mutation.id);
        }
        await this.checkpoint('mutation-receipt');
      } catch (error: unknown) {
        if (error instanceof SyncPersistenceError) throw error;
        if (error instanceof CoreStoreError && !nonIdempotentCreate && mutation.kind !== 'event.splitSeries' && this.platform.accountAvailable?.(accountId) === false) {
          // A disconnect between steps of a move must preserve its saved
          // receipt and leave the remaining command queued for reconnection.
          await this.checkpoint('mutation-receipt');
          break;
        }
        if (error instanceof SplitSeriesRolledBackError) {
          this.store.completeSyncMutation(mutation.id);
          await this.checkpoint('mutation-receipt');
          throw error;
        }
        // Tasks does not accept client-generated ids. Retrying a create after a
        // lost response can duplicate a user task, so preserve it as an
        // explicit conflict instead of guessing. Calendar creates are
        // idempotent below through a deterministic event id.
        const ambiguousTaskCreate = nonIdempotentCreate && !(error instanceof CoreStoreError) &&
          (!(error instanceof GoogleApiError) || error.status === 0 || error.status === 408 || error.status >= 500);
        const retryable = !ambiguousTaskCreate && (error instanceof GoogleApiError ? error.retryable : !(error instanceof CoreStoreError));
        this.store.deferSyncMutation(mutation.id, ambiguousTaskCreate
          ? "Google may have accepted this creation before its response was lost. Check Google before retrying to avoid duplicates."
          : safeError(error), retryable, ambiguousTaskCreate || mutation.kind === 'event.splitSeries');
        await this.checkpoint('mutation-error');
        // Preserve causal order: later writes may depend on this one.
        break;
      } finally {
        this.currentMutationId = undefined;
      }
    }
  }

  private async prepareDeliveryBatch(accountId: string, mutation: PendingSyncMutation): Promise<GoogleSyncBatch | null> {
    if (!/^(taskList|task|event)\.(create|update|move)$/.test(mutation.kind)) return null;
    const kind = mutation.kind.split(".")[0] as "task" | "taskList" | "event";
    const current = kind === "task" ? this.store.googleTaskForSync(mutation.entityId) : kind === "event"
      ? this.store.googleEventForSync(mutation.entityId) : this.store.googleTaskListForSync(mutation.entityId);
    // Existing tombstone handling owns deletion/undo semantics.
    if (!current || (kind === "task" && current.status === "deleted")) return null;
    if (!mutation.intent) throw new CoreStoreError("This older queued change has no saved submission. Compare Google before applying the current local version.");
    const prepared = this.store.prepareGoogleSyncBatch(accountId, mutation.id);
    if (prepared) return prepared;
    if (!current.googleId) throw new CoreStoreError("This queued creation is incomplete. Compare Google before continuing.");
    const collectionId = kind === "task" ? current.googleListId ?? current.listGoogleId : kind === "event"
      ? this.store.googleSyncState(accountId, kind, mutation.entityId)?.baseline.collectionId ?? current.calendarGoogleId : null;
    const url = kind === "task" ? taskUrl(collectionId, current.googleId) : kind === "event"
      ? `${calendarEventCollectionUrl(collectionId)}/${encodeURIComponent(current.googleId)}`
      : `https://tasks.googleapis.com/tasks/v1/users/@me/lists/${encodeURIComponent(current.googleId)}`;
    const remote = await this.requestJson<JsonRecord>(accountId, url);
    if (this.store.observeGoogleRemote(accountId, kind, mutation.entityId, remote, collectionId) !== "merged") {
      throw new CoreStoreError("The original Google version is unknown or changed. Compare Google before continuing.");
    }
    const discovered = this.store.prepareGoogleSyncBatch(accountId, mutation.id);
    if (!discovered) throw new CoreStoreError("This queued change needs review before it can be sent safely.");
    return discovered;
  }

  private async deliverGoogleBatch(batch: GoogleSyncBatch, retry = 0): Promise<void> {
    if (batch.move?.stage === "pending") {
      const source = batch.kind === "task" ? taskCollectionUrl(batch.move.source) : calendarEventCollectionUrl(batch.move.source);
      if (batch.move.attempted) {
        const current = await this.requestJson<JsonRecord>(batch.accountId, `${source}/${encodeURIComponent(batch.snapshot.googleId)}`);
        const observed = googleRemoteBaseline(batch.kind, current, batch.move.source, batch.baseline?.fields);
        if (!batch.baseline?.etag || observed.etag !== batch.baseline.etag || !syncValuesEqual(observed.fields, batch.baseline.fields)) {
          throw new CoreStoreError("The previous move may have reached Google. Compare its current location before retrying.");
        }
      }
      batch = { ...batch, move: { ...batch.move, attempted: true } };
      this.store.beginGoogleSyncBatch(batch);
      const moved = await this.requestJson<JsonRecord>(batch.accountId, `${source}/${encodeURIComponent(batch.snapshot.googleId)}/move`, {
        method: "POST", headers: conditionalHeaders(batch.baseline?.etag), query: batch.kind === "event"
          ? { destination: batch.move!.destination }
          : { ...(batch.move!.source !== batch.move!.destination ? { destinationTasklist: batch.move!.destination } : {}),
              ...(batch.move!.parent ? { parent: batch.move!.parent } : {}), ...(batch.move!.previous ? { previous: batch.move!.previous } : {}) }
      });
      batch = this.store.acceptGoogleMoveReceipt(batch, moved);
    }
    const { accountId, kind, snapshot, body, creating } = batch;
    if (!creating && Object.keys(body).length === 0) {
      this.store.completeGoogleSyncBatch(batch);
      return;
    }
    let collection: string;
    const query: Record<string, string> = {};
    if (kind === "taskList") collection = "https://tasks.googleapis.com/tasks/v1/users/@me/lists";
    else if (kind === "task") {
      if (!snapshot.listGoogleId) throw new CoreStoreError("This task list has not been created in Google yet.");
      collection = taskCollectionUrl(snapshot.listGoogleId);
      if (creating && snapshot.parentId) {
        const parent = await this.remoteParentId(snapshot.parentId);
        if (!parent) throw new CoreStoreError("This task's parent has not been created in Google yet.");
        query.parent = parent;
      }
    } else {
      if (!snapshot.calendarGoogleId) throw new CoreStoreError("This calendar has not been discovered in Google yet.");
      collection = calendarEventCollectionUrl(snapshot.calendarGoogleId);
      Object.assign(query, calendarEventWriteQuery(snapshot));
    }
    this.store.beginGoogleSyncBatch(batch);
    let remote: JsonRecord;
    try {
      remote = await this.requestJson<JsonRecord>(accountId, creating ? collection : `${collection}/${encodeURIComponent(snapshot.googleId)}`, {
        method: creating ? "POST" : "PATCH", body: json(body), query,
        ...(creating ? {} : { headers: conditionalHeaders(batch.baseline?.etag) })
      });
    } catch (error) {
      if (!creating && error instanceof GoogleApiError && error.status === 412 && retry < 2) {
        const latest = await this.requestJson<JsonRecord>(accountId, `${collection}/${encodeURIComponent(snapshot.googleId)}`);
        const collectionId = kind === "task" ? snapshot.listGoogleId : kind === "event" ? snapshot.calendarGoogleId : null;
        const result = this.store.observeGoogleRemote(accountId, kind, batch.entityId, latest, collectionId);
        if (result !== "merged") throw new CoreStoreError("Google changed this item. Compare Google to review the overlapping or structural changes.");
        const rebased = this.store.rebaseGoogleSyncBatch(batch);
        if (rebased) await this.deliverGoogleBatch(rebased, retry + 1);
        return;
      }
      if (!(creating && kind === "event" && error instanceof GoogleApiError && error.status === 409)) throw error;
      remote = await this.requestJson<JsonRecord>(accountId, `${collection}/${encodeURIComponent(body.id)}`);
      if (this.store.recoverGoogleCreationBatch(batch, remote) !== "merged") throw new CoreStoreError("Google changed the accepted creation. Compare Google to review the newer changes.");
      return;
    }
    this.store.acceptGoogleSyncBatch(batch, remote);
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
      case "task.delete":
        if (mutation.payload.googleId && mutation.payload.googleListId) await this.deleteGoogleResource(accountId, taskUrl(mutation.payload.googleListId, mutation.payload.googleId), mutation.payload.googleEtag);
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
        this.splittingAccountId = accountId;
        try { await this.splitGoogleSeries(accountId, mutation.payload); }
        finally { this.splittingAccountId = undefined; }
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
    this.store.bindGoogleTaskList(localId, remote, list);
  }

  private async deleteTaskList(accountId: string, list: JsonRecord): Promise<void> {
    if (!list.googleId) return;
    await this.deleteGoogleResource(accountId, `https://tasks.googleapis.com/tasks/v1/users/@me/lists/${encodeURIComponent(list.googleId)}`, list.googleEtag);
  }

  private async pushTask(accountId: string, localId: string, mutationPayload: JsonRecord): Promise<void> {
    let task = this.store.googleTaskForSync(localId);
    if (!task) return;
    if (!task.listGoogleId) throw new CoreStoreError("This task list has not been created in Google yet.");
    if (task.status === "deleted") {
      if (task.googleId) {
        await this.deleteGoogleResource(accountId, taskUrl(task.googleListId ?? task.listGoogleId, task.googleId), task.googleEtag);
        this.store.completeGoogleTaskDeletion(localId, task.googleId);
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
      this.store.bindGoogleTask(localId, remote, task);
      return;
    }
    const changesList = task.googleListId && task.googleListId !== task.listGoogleId;
    const changesPosition = Object.prototype.hasOwnProperty.call(mutationPayload, "previousTaskId");
    if (changesList || (task.googleParentId ?? undefined) !== parent || changesPosition) {
      const previous = typeof mutationPayload.previousTaskId === "string"
        ? await this.remoteParentId(mutationPayload.previousTaskId)
        : undefined;
      const moved = await this.requestJson<JsonRecord>(accountId, `${taskUrl(task.googleListId ?? task.listGoogleId, task.googleId)}/move`, {
        method: "POST", query: {
          ...(changesList ? { destinationTasklist: task.listGoogleId } : {}),
          ...(parent ? { parent } : {}), ...(previous ? { previous } : {})
        }
      });
      this.store.bindGoogleTask(localId, moved, task);
      // Keep this command's destination/body. A newer move is a later command.
      task = { ...task, googleId: moved.id, googleEtag: moved.etag };
    }
    const remote = await this.requestJson<JsonRecord>(accountId, taskUrl(task.listGoogleId, task.googleId), {
      method: "PATCH", body: json(body), headers: conditionalHeaders(task.googleEtag)
    });
    this.store.bindGoogleTask(localId, remote, task);
  }

  private async remoteParentId(localParentId: string): Promise<string | undefined> {
    return this.store.googleTaskForSync(localParentId)?.googleId ?? undefined;
  }

  private async pushEvent(accountId: string, localId: string): Promise<void> {
    const event = this.store.googleEventForSync(localId);
    if (!event) return;
    if (!event.calendarGoogleId) throw new CoreStoreError("This calendar has not been discovered in Google yet.");
    const creationId = this.store.googleEventCreationId(accountId, event.id);
    const body = googleEventBody(event, event.googleId ? undefined : creationId);
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
        remote = await this.requestJson<JsonRecord>(accountId, `${collection}/${creationId}`);
      }
    }
    this.store.bindGoogleEvent(localId, remote, event, this.currentMutationId);
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
      this.store.bindGoogleEvent(localId, remote, occurrence, this.currentMutationId);
      return;
    }
    const remote = await this.requestJson<JsonRecord>(accountId, `${collection}/${encodeURIComponent(requiredText(target.id, "Google occurrence id"))}`, {
      method: "PATCH",
      body: json(body),
      headers: conditionalHeaders(target.etag),
      query: calendarEventWriteQuery(occurrence)
    });
    this.store.bindGoogleEvent(localId, remote, occurrence, this.currentMutationId);
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
      this.store.bindGoogleEvent(parentEventId, updatedParent, parent, this.currentMutationId);

      createdSuccessor = await this.insertSplitSuccessor(accountId, collection, successor);
      this.store.bindGoogleEvent(successorEventId, createdSuccessor, successor, this.currentMutationId);

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
      if (error instanceof SyncPersistenceError || error instanceof ConcurrentSeriesEditError) throw error;
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
    const creationId = this.store.googleEventCreationId(accountId, successor.id);
    const body = googleEventBody(successor, creationId);
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
      return await this.requestJson<JsonRecord>(accountId, `${collection}/${encodeURIComponent(creationId)}`);
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
        if (error instanceof SyncPersistenceError || error instanceof ConcurrentSeriesEditError) throw error;
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
        if (error instanceof SyncPersistenceError || error instanceof ConcurrentSeriesEditError) throw error;
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
    this.store.bindGoogleEvent(localId, remote, { ...event, calendarGoogleId: destination.googleId }, this.currentMutationId);

    // An edit can be queued after more than one local calendar move. Apply the
    // current event body only at its final destination; an intermediate move
    // merely preserves causal order for Google's single-source move endpoint.
    if (event.calendarId !== destinationCalendarId) return;
    remote = await this.requestJson<JsonRecord>(accountId,
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(destination.googleId)}/events/${encodeURIComponent(remote.id)}`,
      { method: "PATCH", body: json(googleEventBody(event)), headers: conditionalHeaders(remote.etag), query: calendarEventWriteQuery(event) }
    );
    this.store.bindGoogleEvent(localId, remote, event, this.currentMutationId);
  }

  private async deleteEvent(accountId: string, event: JsonRecord): Promise<void> {
    if (!event.googleId || !event.calendarGoogleId) return;
    const restored = typeof event.id === 'string' ? this.store.googleEventForSync(event.id) : null;
    if (restored && (!restored.googleId || restored.googleId === event.googleId)) {
      // Undo arrived before delivery started; keep the existing remote event.
      this.store.bindGoogleEvent(event.id, { id: event.googleId, etag: event.googleEtag }, restored);
      return;
    }
    await this.deleteGoogleResource(accountId, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(event.calendarGoogleId)}/events/${encodeURIComponent(event.googleId)}`, event.googleEtag);
    if (typeof event.id === 'string') this.store.completeGoogleEventDeletion(accountId, event.id, event.googleId);
  }

  private async deleteGoogleResource(accountId: string, url: string, etag: unknown): Promise<void> {
    if (typeof etag !== "string" || !etag.trim()) {
      // An already absent item is safe to acknowledge. A present one needs a
      // reviewed revision; never turn missing historical data into a blind delete.
      try { await this.requestJson<JsonRecord>(accountId, url); }
      catch (error) { if (error instanceof GoogleApiError && [404, 410].includes(error.status)) return; throw error; }
      throw new CoreStoreError("The original Google revision for this deletion is unknown. Compare Google before deleting it.");
    }
    try { await this.requestJson<void>(accountId, url, { method: "DELETE", headers: conditionalHeaders(etag) }); }
    catch (error) {
      // Missing/gone is the requested final state after a lost delete response.
      // Authorization and revision failures still block delivery.
      if (!(error instanceof GoogleApiError) || ![404, 410].includes(error.status)) throw error;
    }
  }

  private async allPages(accountId: string, url: string, query: Record<string, string>): Promise<JsonRecord[]> {
    return (await this.allPagesWithSyncToken(accountId, url, query)).items;
  }

  private async streamPages(accountId: string, url: string, query: Record<string, string>, consume: (items: JsonRecord[]) => Promise<void>, firstResponse?: (response: Response) => void): Promise<string | undefined> {
    let pageToken: string | undefined;
    let nextSyncToken: string | undefined;
    do {
      const page = await this.requestJson<GooglePage>(accountId, url, { query: { ...query, ...(pageToken ? { pageToken } : {}) }, ...(!pageToken && firstResponse ? { observeResponse: firstResponse } : {}) });
      await consume(page.items ?? []);
      pageToken = page.nextPageToken;
      nextSyncToken = page.nextSyncToken ?? nextSyncToken;
    } while (pageToken);
    return nextSyncToken;
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

  private async requestJson<T>(accountId: string, url: string, init: RequestInit & { query?: Record<string, string>; observeResponse?: (response: Response) => void } = {}): Promise<T> {
    const target = new URL(url);
    for (const [key, value] of Object.entries(init.query ?? {})) target.searchParams.set(key, value);
    const { query: _query, observeResponse, ...requestInit } = init;
    if (typeof requestInit.body === 'string') {
      const headers = new Headers(requestInit.headers);
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');
      requestInit.headers = headers;
    }
    if (requestInit.method && !['GET', 'HEAD'].includes(requestInit.method.toUpperCase())) await this.checkpoint('before-remote-write');
    // Fixed labels only: URLs, account ids, bodies and credentials never enter timings.
    const write = requestInit.method && !['GET', 'HEAD'].includes(requestInit.method.toUpperCase());
    return timedAsync(write ? 'google.http.write' : 'google.http.read', 'sync', async () => {
      let response: Response;
      const version = this.splittingAccountId ? this.store.googleMutationVersion(accountId) : undefined;
      try {
        response = await this.oauth.googleFetch(accountId, target, requestInit);
        if (version !== undefined && version !== this.store.googleMutationVersion(accountId)) throw new ConcurrentSeriesEditError();
      } catch (error: unknown) {
        if (error instanceof SyncPersistenceError) throw error;
        if (version !== undefined && version !== this.store.googleMutationVersion(accountId)) throw new ConcurrentSeriesEditError();
        if (error instanceof CoreStoreError || error instanceof SyncPersistenceError) throw error;
        throw new GoogleApiError(0, error instanceof Error ? error.message : "Google request failed.");
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new GoogleApiError(response.status, googleErrorMessage(response.status, detail));
      }
      observeResponse?.(response);
      if (response.status === 204) return undefined as T;
      return await response.json() as T;
    });
  }

  private async ensureDriveUploadFolder(accountId: string): Promise<string> {
    const operations = this.platform.operations;
    const saved = operations?.read(accountId, 'drive-folder');
    let reservedId = typeof saved?.fileId === 'string' ? saved.fileId : undefined;
    if (reservedId) {
      const existing = await this.driveFileById(accountId, reservedId);
      if (existing && !existing.trashed) return reservedId;
      if (saved?.state === 'complete' || existing?.trashed) throw new CoreStoreError('The Hot Cross Buns attachments folder was removed. Restore it in Google Drive before uploading again.');
    }
    const escapedName = driveUploadFolderName.replace(/'/g, "\\'");
    const existing = await this.requestJson<GooglePage & { files?: JsonRecord[] }>(accountId, "https://www.googleapis.com/drive/v3/files", {
      query: {
        fields: "files(id)",
        orderBy: "createdTime asc",
        pageSize: "1",
        q: `trashed = false and mimeType = 'application/vnd.google-apps.folder' and name = '${escapedName}'`
      }
    });
    const existingId = existing.files?.[0]?.id;
    if (typeof existingId === "string" && existingId) {
      operations?.write(accountId, 'drive-folder', { fileId: existingId, state: 'complete' });
      return existingId;
    }

    if (operations && !reservedId) {
      reservedId = await this.generateDriveId(accountId);
      operations.write(accountId, 'drive-folder', { fileId: reservedId, state: 'pending' });
    }

    let created: JsonRecord;
    try {
      created = await this.requestJson<JsonRecord>(accountId, "https://www.googleapis.com/drive/v3/files", {
        method: "POST", headers: { "content-type": "application/json" }, query: { fields: "id" },
        body: json({ ...(reservedId ? { id: reservedId } : {}), name: driveUploadFolderName, mimeType: "application/vnd.google-apps.folder" })
      });
    } catch (error) {
      if (error instanceof SyncPersistenceError || !reservedId || !(error instanceof GoogleApiError) || ![0, 408, 409, 500, 502, 503, 504].includes(error.status)) throw error;
      const existing = await this.driveFileById(accountId, reservedId);
      if (!existing || existing.trashed) throw error;
      created = existing;
    }
    if (typeof created.id !== "string" || !created.id) {
      throw new CoreStoreError("Google Drive could not create the Hot Cross Buns attachments folder.");
    }
    if (reservedId && created.id !== reservedId) throw new CoreStoreError('Google Drive returned an unexpected folder identity.');
    if (operations) {
      operations.write(accountId, 'drive-folder', { fileId: created.id, state: 'complete' });
      await this.checkpoint('upload-receipt');
    }
    return created.id;
  }

  private async generateDriveId(accountId: string): Promise<string> {
    const result = await this.requestJson<JsonRecord>(accountId, 'https://www.googleapis.com/drive/v3/files/generateIds', { query: { count: '1', space: 'drive', type: 'files' } });
    const id = result.ids?.[0];
    if (typeof id !== 'string' || !id) throw new CoreStoreError('Google Drive did not reserve an upload identity. Try again.');
    return id;
  }

  private async driveFileById(accountId: string, id: string): Promise<JsonRecord | null> {
    try {
      return await this.requestJson<JsonRecord>(accountId, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`, {
        query: { fields: 'id,name,mimeType,webViewLink,iconLink,modifiedTime,size,trashed' },
      });
    } catch (error) {
      if (error instanceof GoogleApiError && error.status === 404) return null;
      throw error;
    }
  }

  private async startResumableDriveUpload(
    accountId: string,
    file: { mimeType: string; name: string; parentId: string; sizeBytes: number; id?: string }
  ): Promise<string> {
    const target = new URL("https://www.googleapis.com/upload/drive/v3/files");
    target.searchParams.set("uploadType", "resumable");
    target.searchParams.set("fields", "id,name,mimeType,webViewLink,iconLink,modifiedTime,size");
    const response = await this.googleResponse(accountId, target, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-length": String(file.sizeBytes),
        "x-upload-content-type": file.mimeType
      },
      body: json({ ...(file.id ? { id: file.id } : {}), name: file.name, mimeType: file.mimeType, parents: [file.parentId] })
    });
    const sessionUrl = response.headers.get("location");
    if (!sessionUrl) throw new CoreStoreError("Google Drive did not start the file upload.");
    return sessionUrl;
  }

  private async finishResumableDriveUpload(
    accountId: string,
    sessionUrl: string,
    file: GoogleUploadSource,
    sizeBytes: number,
    mimeType: string
  ): Promise<JsonRecord> {
    {
      if (sizeBytes === 0) {
        const response = await this.googleResponse(accountId, sessionUrl, {
          method: "PUT",
          headers: { "content-range": "bytes */0" }
        });
        return await response.json() as JsonRecord;
      }

      let offset = 0;
      let stalledResponses = 0;
      while (offset < sizeBytes) {
        const bytes = Math.min(resumableUploadChunkBytes, sizeBytes - offset);
        const buffer = await file.read(offset, bytes);
        if (buffer.byteLength !== bytes) throw new CoreStoreError("The selected file changed while it was uploading.");
        const response = await this.googleResponse(accountId, sessionUrl, {
          method: "PUT",
          headers: {
            "content-range": `bytes ${offset}-${offset + bytes - 1}/${sizeBytes}`,
            "content-type": mimeType
          },
          body: buffer
        }, new Set([200, 201, 308]));
        if (response.status === 308) {
          const range = response.headers.get('range');
          const match = range?.match(/^bytes=0-(\d+)$/i);
          if (range && !match) throw new CoreStoreError('Google Drive returned an invalid upload acknowledgement. Retry the selected file.');
          const received = match ? Number(match[1]) + 1 : 0;
          if (!Number.isSafeInteger(received) || received < 0 || received > offset + bytes) throw new CoreStoreError('Google Drive returned an inconsistent upload offset. Retry the selected file.');
          stalledResponses = received <= offset ? stalledResponses + 1 : 0;
          if (stalledResponses >= 3) throw new CoreStoreError('Google Drive is not accepting upload data. Retry the selected file when your connection is stable.');
          offset = received;
          continue;
        }
        offset += bytes;
        if (offset !== sizeBytes) throw new CoreStoreError("Google Drive ended the upload before the file was complete.");
        return await response.json() as JsonRecord;
      }
    }
    throw new CoreStoreError("Google Drive did not finish the file upload.");
  }

  private async googleResponse(
    accountId: string,
    url: string | URL,
    init: RequestInit,
    acceptedStatuses = new Set([200, 201])
  ): Promise<Response> {
    if (init.method && !['GET', 'HEAD'].includes(init.method.toUpperCase())) await this.checkpoint('before-remote-write');
    let response: Response;
    try {
      response = await this.oauth.googleFetch(accountId, url, init);
    } catch (error: unknown) {
      if (error instanceof CoreStoreError || error instanceof SyncPersistenceError) throw error;
      throw new GoogleApiError(0, error instanceof Error ? error.message : "Google request failed.");
    }
    if (!acceptedStatuses.has(response.status)) {
      const detail = await response.text().catch(() => "");
      throw new GoogleApiError(response.status, googleErrorMessage(response.status, detail));
    }
    return response;
  }

  private workspaceAccountId(value: unknown, requiredService?: WorkspaceService): string {
    const accountId = typeof value === "string" && value ? value : this.store.googleAccounts().find((account) => account.accountId !== "local" && account.connectionState === "connected")?.accountId;
    if (!accountId) throw new CoreStoreError("Connect a Google account before using this feature.");
    const account = this.store.googleAccount(accountId);
    if (!account || account.connectionState !== "connected") throw new CoreStoreError("The selected Google account is not connected.");
    if (requiredService) {
      const scope = requiredService === "driveSearch"
        ? "https://www.googleapis.com/auth/drive.metadata.readonly"
        : requiredService === "driveUpload"
          ? "https://www.googleapis.com/auth/drive.file"
          : "https://www.googleapis.com/auth/gmail.readonly";
      if (!Array.isArray(account.grantedScopes) || !account.grantedScopes.includes(scope)) {
        const serviceLabel = requiredService === "driveSearch"
          ? "Drive linking"
          : requiredService === "driveUpload"
            ? "Drive uploads"
            : "Gmail capture";
        throw new CoreStoreError(`Reconnect this Google account with ${serviceLabel} enabled.`);
      }
    }
    return accountId;
  }
}

async function snapshotFingerprint(snapshot: GoogleResolutionSnapshot, fingerprint?: (value: string) => string | Promise<string>): Promise<string> {
  const canonical = (value: any): any => Array.isArray(value)
    ? value.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    : value && typeof value === "object"
      ? Object.fromEntries(Object.keys(value).sort().filter((key) => key !== "token").map((key) => [key, canonical(value[key])])) : value;
  const value = JSON.stringify(canonical(snapshot));
  if (fingerprint) return fingerprint(value);
  return sha256(new TextEncoder().encode(value));
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function resolutionFields(kind: string, value: JsonRecord | null, remote = false, fallback: JsonRecord | null = null): JsonRecord | null {
  if (!value) return null;
  if (kind === "taskList") return { title: value.title ?? "" };
  if (kind === "task") {
    const parsed = splitHcbTaskMetadata(value.notes);
    const planning: JsonRecord = remote ? parsed.metadata ?? fallback ?? {} : value;
    return {
      title: value.title ?? "", notes: remote ? parsed.notes : value.notes ?? "",
      status: value.deleted ? "deleted" : remote ? value.status === "completed" ? "completed" : "active" : value.status,
      due: ((remote ? value.due : value.dueAt) as string | undefined)?.slice(0, 10) ?? null,
      priority: planning.priority ?? "none", durationMinutes: planning.durationMinutes ?? null,
      plannedStart: planning.plannedStart ?? null, plannedEnd: planning.plannedEnd ?? null,
      lockedSchedule: Boolean(planning.lockedSchedule), snoozeUntil: planning.snoozeUntil ?? null, tags: planning.tags ?? []
    };
  }
  const allDay = remote ? Boolean(value.start?.date) : Boolean(value.allDay);
  const date = (input: unknown) => typeof input !== "string" ? null : allDay ? input.slice(0, 10) : Number.isFinite(Date.parse(input)) ? new Date(input).toISOString() : input;
  const attendees = safeArray(value.attendees).map((attendee) => ({ email: attendee.email, name: attendee.displayName ?? null, response: attendee.responseStatus ?? "needsAction", optional: Boolean(attendee.optional) })).sort((a, b) => String(a.email).localeCompare(String(b.email)));
  const video = remote ? safeArray(value.conferenceData?.entryPoints).find((point) => point.entryPointType === "video")?.uri ?? value.hangoutLink : value.conference?.videoUri;
  return {
    title: remote ? value.summary ?? "" : value.title ?? "", description: value.description ?? "",
    start: date(remote ? value.start?.dateTime ?? value.start?.date : value.startsAt), end: date(remote ? value.end?.dateTime ?? value.end?.date : value.endsAt), allDay,
    timeZone: (remote ? value.start?.timeZone : value.timeZone) ?? null,
    location: value.location ?? "", color: value.colorId === "default" ? null : value.colorId ?? null,
    recurrence: remote ? value.recurrence ?? [] : value.recurrenceLines ?? value.googleRecurrence ?? [],
    attendees, remindersUseDefault: remote ? value.reminders?.useDefault !== false : Boolean(value.remindersUseDefault),
    reminders: remote ? value.reminders?.overrides ?? [] : value.reminders ?? [],
    transparency: value.transparency ?? "opaque", visibility: value.visibility ?? "default",
    attachments: safeArray(value.attachments).map((attachment) => ({ title: attachment.title ?? "", url: attachment.fileUrl, mimeType: attachment.mimeType ?? null })),
    meeting: video ?? null, eventType: value.eventType ?? "default", focusTimeProperties: value.focusTimeProperties ?? null,
    outOfOfficeProperties: value.outOfOfficeProperties ?? null, workingLocationProperties: value.workingLocationProperties ?? null,
    status: value.status === "cancelled" ? "deleted" : "active"
  };
}

function safeDriveFileName(value: string): string {
  const normalized = value.replace(/[\u0000-\u001f<>:"/\\|?*]+/g, " ").trim().slice(0, 240);
  return normalized || "Untitled attachment";
}

function mimeTypeForPath(filePath: string): string {
  const extension = /\.[^.\/\\]+$/.exec(filePath)?.[0].toLowerCase() ?? "";
  const known: Record<string, string> = {
    ".csv": "text/csv", ".gif": "image/gif", ".heic": "image/heic", ".htm": "text/html",
    ".html": "text/html", ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".json": "application/json",
    ".md": "text/markdown", ".mov": "video/quicktime", ".mp3": "audio/mpeg", ".mp4": "video/mp4",
    ".pdf": "application/pdf", ".png": "image/png", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".txt": "text/plain", ".webp": "image/webp", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".zip": "application/zip"
  };
  return known[extension] ?? "application/octet-stream";
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

function calendarEventWriteQuery(event: JsonRecord): Record<string, string> {
  return {
    supportsAttachments: "true",
    ...(event.conferenceCreateRequested || event.conference ? { conferenceDataVersion: "1" } : {})
  };
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
