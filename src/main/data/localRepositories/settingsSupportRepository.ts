import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, extname, isAbsolute, join, normalize, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, shell } from "electron";
import { z } from "zod";
import {
  customizationExtensionCapabilitySchema,
  settingsUpdateRequestSchema,
  type AttachmentActionRequest,
  type AttachmentActionResponse,
  type AttachmentAddRequest,
  type AttachmentListRequest,
  type AttachmentListResponse,
  type AttachmentMutationResponse,
  type AttachmentSummary,
  type CustomizationExtension,
  type CustomizationExtensionLogRequest,
  type CustomizationStatusResponse,
  type CustomizationToggleRequest,
  type IcsImportRequest,
  type IcsImportResponse,
  type IcsSubscriptionActionRequest,
  type IcsSubscriptionCreateRequest,
  type IcsSubscriptionsResponse,
  type IcsSubscriptionSummary,
  type LocalReportExportRequest,
  type LocalReportExportResponse,
  type SettingsSnapshot,
  type SettingsUpdateRequest
} from "@shared/ipc/contracts";
import {
  defaultKeybindings,
  defaultLeaderKeybindings,
  hotkeyActionIds
} from "@shared/settingsCatalog";
import type { NativeAppPaths } from "../../native/types";
import type { SqliteConnection, SqliteWriteOperation } from "../sqliteConnection";
import { shouldQueueRemoteMutationsForConnection } from "./plannerBase";
import { boolInt, systemTimeZone, validationFailure } from "./shared";

const MAX_CSS_BYTES = 200_000;
const MAX_EXTENSION_BYTES = 200_000;
const LOCAL_ICS_ACCOUNT_ID = "local:ics";
const SETTINGS_JSON_KEYS = [
  "theme",
  "colorTheme",
  "appLanguage",
  "uiFontName",
  "uiTextSizePoints",
  "disableAnimations",
  "uiLayoutScale",
  "navigationPlacement",
  "hiddenNavigationTabs",
  "navigationTabOrder",
  "toolbarActionOrder",
  "hiddenCalendarViewModes",
  "calendarTimelineDensity",
  "monthScrollPastMonths",
  "monthScrollFutureMonths",
  "quickCreateExpandedByDefault",
  "showCompletedInCalendarViews",
  "semanticSearchEnabled",
  "agentActionTrayEnabled"
] as const satisfies readonly (keyof SettingsUpdateRequest)[];
const KEYMAP_JSON_KEYS = ["keybindings", "leaderKey", "leaderKeybindings"] as const satisfies readonly (keyof SettingsUpdateRequest)[];
const extensionManifestSchema = z
  .object({
    id: z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9._:-]+$/),
    name: z.string().trim().min(1).max(120),
    version: z.string().trim().min(1).max(80),
    main: z.string().trim().min(1).max(200).default("main.js"),
    capabilities: z.array(customizationExtensionCapabilitySchema).max(10).default(["ui.panel"])
  })
  .strict();

export class LocalSettingsSupportRepository {
  constructor(
    private readonly connection: SqliteConnection,
    private readonly appPaths: NativeAppPaths
  ) {}

  applyExternalSettings(snapshot: SettingsSnapshot): SettingsSnapshot {
    const externalSettings = this.readExternalSettings();
    const externalKeymap = this.readExternalKeymap();
    return {
      ...snapshot,
      ...externalSettings.patch,
      ...externalKeymap.patch
    };
  }

  customizationStatus(): CustomizationStatusResponse {
    this.ensureCustomizationDirectories();
    const safeMode = this.safeMode();
    const snippets = safeMode ? this.snippets(false) : this.snippets(true);
    const extensions = safeMode ? this.extensions(false) : this.extensions(true);

    return {
      configDirectory: this.appPaths.configDirectory,
      snippetsDirectory: this.snippetsDirectory(),
      extensionsDirectory: this.extensionsDirectory(),
      settingsJsonPath: this.settingsJsonPath(),
      keymapJsonPath: this.keymapJsonPath(),
      snippets,
      externalSettings: this.readExternalSettings().status,
      externalKeymap: this.readExternalKeymap().status,
      extensions,
      safeMode
    };
  }

  reloadCustomization(): CustomizationStatusResponse {
    return this.customizationStatus();
  }

  setSnippetEnabled(request: CustomizationToggleRequest): CustomizationStatusResponse {
    const state = this.readCustomizationState<Record<string, boolean>>("snippetsEnabled", {});
    state[request.id] = request.enabled;
    this.writeCustomizationState("snippetsEnabled", state);
    return this.customizationStatus();
  }

  setExtensionEnabled(request: CustomizationToggleRequest): CustomizationStatusResponse {
    const state = this.readCustomizationState<Record<string, boolean>>("extensionsEnabled", {});
    state[request.id] = request.enabled;
    this.writeCustomizationState("extensionsEnabled", state);
    return this.customizationStatus();
  }

  logExtensionMessage(request: CustomizationExtensionLogRequest): CustomizationStatusResponse {
    const logs = this.readCustomizationState<Record<string, string[]>>("extensionLogs", {});
    const now = new Date().toISOString();
    const next = [
      ...(logs[request.extensionId] ?? []),
      `${now} ${(request.level ?? "info").toUpperCase()} ${request.message}`
    ].slice(-100);
    logs[request.extensionId] = next;
    this.writeCustomizationState("extensionLogs", logs);
    return this.customizationStatus();
  }

  listAttachments(request: AttachmentListRequest): AttachmentListResponse {
    return {
      items: this.attachmentItems(request.entityKind, request.entityId)
    };
  }

  addAttachment(request: AttachmentAddRequest): AttachmentMutationResponse {
    const now = new Date().toISOString();
    const target = this.attachmentTarget(request.entityKind, request.entityId);
    const bytes = Buffer.from(request.dataBase64, "base64");

    if (bytes.byteLength === 0) {
      throw validationFailure("Attachment file is empty.");
    }

    const digest = createHash("sha256").update(bytes).digest("hex");
    const fileName = `${digest.slice(0, 16)}-${safeFileName(request.fileName)}`;
    const directory = join(dirname(this.connection.databasePath), "Attachments");
    const path = join(directory, fileName);
    const pointer = pathToFileURL(path).href;
    const line = `[Attachment: ${request.fileName.trim()}](${pointer})`;
    const nextText = appendAttachmentLine(target.text, line);
    const queued = !isLocalIcsAccount(target.accountId) && shouldQueueRemoteMutationsForConnection(this.connection);
    const operations: SqliteWriteOperation[] = [
      target.updateOperation(nextText, now)
    ];

    mkdirSync(directory, { recursive: true });
    writeFileSync(path, bytes);

    if (queued) {
      operations.push(target.mutationOperation(now));
    }

    this.connection.executeTransaction(operations);
    return {
      items: this.attachmentItems(target.entityKind, target.entityId),
      queued,
      revision: now
    };
  }

  removeAttachment(request: AttachmentActionRequest): AttachmentMutationResponse {
    const now = new Date().toISOString();
    const target = this.attachmentTargetForPointer(request.pointer);
    const nextText = removeAttachmentPointer(target.text, request.pointer);
    const queued = !isLocalIcsAccount(target.accountId) && shouldQueueRemoteMutationsForConnection(this.connection);
    const operations: SqliteWriteOperation[] = [target.updateOperation(nextText, now)];

    if (queued) {
      operations.push(target.mutationOperation(now));
    }

    this.connection.executeTransaction(operations);
    return {
      items: this.attachmentItems(target.entityKind, target.entityId),
      queued,
      revision: now
    };
  }

  async openAttachment(request: AttachmentActionRequest): Promise<AttachmentActionResponse> {
    const path = pathFromPointer(request.pointer);

    if (!existsSync(path)) {
      throw validationFailure("Attachment file is missing.");
    }

    if (typeof shell?.openPath !== "function") {
      return { path, message: "Attachment path resolved." };
    }

    const message = await shell.openPath(path);
    if (message) {
      throw validationFailure(message);
    }

    return { path, message: "Attachment opened." };
  }

  downloadAttachment(request: AttachmentActionRequest): AttachmentActionResponse {
    const sourcePath = pathFromPointer(request.pointer);

    if (!existsSync(sourcePath)) {
      throw validationFailure("Attachment file is missing.");
    }

    const downloads = typeof app?.getPath === "function"
      ? app.getPath("downloads")
      : join(this.appPaths.dataDirectory, "Downloads");
    const targetDirectory = join(downloads, "Hot Cross Buns");
    const targetPath = uniquePath(
      targetDirectory,
      safeFileName(request.displayName ?? basename(sourcePath))
    );

    mkdirSync(targetDirectory, { recursive: true });
    copyFileSync(sourcePath, targetPath);
    return { path: targetPath, message: "Attachment copied to Downloads." };
  }

  importIcs(request: IcsImportRequest): IcsImportResponse {
    const now = new Date().toISOString();
    const content = Buffer.from(request.dataBase64, "base64").toString("utf8");
    const parsed = parseIcs(content, {
      calendarTitle: request.calendarTitle ?? basename(request.fileName, extname(request.fileName)),
      sourceId: `file:${request.fileName}:${createHash("sha1").update(content).digest("hex").slice(0, 12)}`
    });
    return this.replaceIcsCalendar(parsed, now);
  }

  listIcsSubscriptions(): IcsSubscriptionsResponse {
    return { items: this.icsSubscriptionRows() };
  }

  async subscribeIcs(request: IcsSubscriptionCreateRequest): Promise<IcsSubscriptionsResponse> {
    const normalizedUrl = normalizeIcsUrl(request.url);
    const now = new Date().toISOString();
    const id = `ics-sub:${hashId(normalizedUrl)}`;
    const calendarId = `ics-calendar:${hashId(normalizedUrl)}`;
    const title = request.title?.trim() || hostTitle(normalizedUrl);

    this.ensureLocalIcsAccount(now);
    this.connection.run(
      `INSERT INTO local_ics_subscriptions (
        id, url, title, calendar_id, enabled, refresh_minutes, etag, last_modified,
        last_attempt_at, last_success_at, last_error, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, 1, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, NULL)
      ON CONFLICT(url) WHERE deleted_at IS NULL DO UPDATE SET
        title = excluded.title,
        enabled = 1,
        refresh_minutes = excluded.refresh_minutes,
        updated_at = excluded.updated_at;`,
      [id, normalizedUrl, title, calendarId, request.refreshMinutes ?? 360, now, now]
    );
    await this.refreshIcsSubscription({ id });
    return this.listIcsSubscriptions();
  }

  async refreshIcsSubscription(
    request: IcsSubscriptionActionRequest
  ): Promise<IcsSubscriptionsResponse> {
    const row = this.connection.get<{
      id: string;
      url: string;
      title: string;
      calendarId: string;
      etag: string | null;
      lastModified: string | null;
    }>(
      `SELECT id, url, title, calendar_id AS calendarId, etag, last_modified AS lastModified
       FROM local_ics_subscriptions
       WHERE id = ? AND deleted_at IS NULL
       LIMIT 1;`,
      [request.id]
    );

    if (!row) {
      throw validationFailure("ICS subscription was not found.");
    }

    const now = new Date().toISOString();
    try {
      const headers: Record<string, string> = {};
      if (row.etag) {
        headers["If-None-Match"] = row.etag;
      }
      if (row.lastModified) {
        headers["If-Modified-Since"] = row.lastModified;
      }

      const response = await fetch(row.url, { headers });
      if (response.status === 304) {
        this.markIcsSubscription(row.id, now, now, null, row.etag, row.lastModified);
        return this.listIcsSubscriptions();
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const content = await response.text();
      const parsed = parseIcs(content, {
        calendarTitle: row.title,
        calendarId: row.calendarId,
        sourceId: row.id
      });
      this.replaceIcsCalendar(parsed, now);
      this.markIcsSubscription(
        row.id,
        now,
        now,
        null,
        response.headers.get("etag"),
        response.headers.get("last-modified")
      );
    } catch (error) {
      this.markIcsSubscription(
        row.id,
        now,
        null,
        error instanceof Error ? error.message : String(error),
        row.etag,
        row.lastModified
      );
    }

    return this.listIcsSubscriptions();
  }

  deleteIcsSubscription(request: IcsSubscriptionActionRequest): IcsSubscriptionsResponse {
    const now = new Date().toISOString();
    const row = this.connection.get<{ calendarId: string }>(
      `SELECT calendar_id AS calendarId
       FROM local_ics_subscriptions
       WHERE id = ? AND deleted_at IS NULL
       LIMIT 1;`,
      [request.id]
    );

    if (!row) {
      throw validationFailure("ICS subscription was not found.");
    }

    this.connection.executeTransaction([
      {
        kind: "run",
        sql: "UPDATE local_ics_subscriptions SET deleted_at = ?, updated_at = ? WHERE id = ?;",
        params: [now, now, request.id]
      },
      ...this.deleteIcsCalendarOperations(row.calendarId, now)
    ]);
    return this.listIcsSubscriptions();
  }

  exportLocalReport(request: LocalReportExportRequest): LocalReportExportResponse {
    const generatedAt = new Date().toISOString();
    const range = reportRange(request.range ?? "today", request.start, request.end);
    const tasks = this.connection.query<{
      id: string;
      title: string;
      dueAt: string | null;
      status: string;
      notes: string | null;
      listTitle: string;
    }>(
      `SELECT tasks.id, tasks.title, tasks.due_at AS dueAt, tasks.status, tasks.notes, lists.title AS listTitle
       FROM google_tasks tasks
       INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
       WHERE tasks.deleted_at IS NULL
         AND tasks.is_hidden = 0
         AND (tasks.due_at IS NULL OR (tasks.due_at >= ? AND tasks.due_at < ?))
       ORDER BY tasks.due_at IS NULL, tasks.due_at ASC, tasks.title COLLATE NOCASE ASC;`,
      [range.start, range.end]
    );
    const events = this.connection.query<{
      id: string;
      title: string;
      startsAt: string;
      endsAt: string;
      calendarTitle: string;
      location: string | null;
      notes: string | null;
    }>(
      `SELECT instances.id,
              events.summary AS title,
              instances.start_at AS startsAt,
              instances.end_at AS endsAt,
              calendars.summary AS calendarTitle,
              events.location,
              events.description AS notes
       FROM google_calendar_event_instances instances
       INNER JOIN google_calendar_events events ON events.id = instances.event_id
       INNER JOIN google_calendar_lists calendars ON calendars.id = instances.calendar_id
       WHERE instances.deleted_at IS NULL
         AND instances.status != 'cancelled'
         AND events.deleted_at IS NULL
         AND calendars.deleted_at IS NULL
         AND instances.start_at < ?
         AND instances.end_at > ?
       ORDER BY instances.start_at ASC, instances.end_at ASC, instances.id ASC;`,
      [range.end, range.start]
    );
    const format = request.format ?? "markdown";
    const extension = format === "markdown" ? "md" : format;
    const path = uniquePath(
      join(dirname(this.connection.databasePath), "Reports"),
      `hcb-${request.range ?? "today"}-${generatedAt.replace(/[:.]/g, "-")}.${extension}`
    );
    const text = format === "csv"
      ? reportCsv(tasks, events)
      : format === "ics"
        ? reportIcs(events, generatedAt)
        : reportMarkdown(tasks, events, range, generatedAt);

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, "utf8");
    return {
      path,
      format,
      generatedAt,
      itemCount: tasks.length + events.length
    };
  }

  private readExternalSettings() {
    return this.readExternalPatch(this.settingsJsonPath(), SETTINGS_JSON_KEYS);
  }

  private readExternalKeymap() {
    const result = this.readExternalPatch(this.keymapJsonPath(), KEYMAP_JSON_KEYS);
    const conflicts = keymapConflicts(result.patch);

    return {
      patch: result.patch,
      status: {
        ...result.status,
        valid: result.status.valid && conflicts.length === 0,
        conflicts,
        error: result.status.error ?? (conflicts[0] ?? null)
      }
    };
  }

  private readExternalPatch(
    path: string,
    keys: readonly (keyof SettingsUpdateRequest)[]
  ): {
    patch: Partial<SettingsUpdateRequest>;
    status: CustomizationStatusResponse["externalSettings"];
  } {
    if (!existsSync(path)) {
      return {
        patch: {},
        status: { path, exists: false, valid: true, appliedKeys: [], conflicts: [], error: null }
      };
    }

    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new Error("JSON root must be an object.");
      }

      const source = raw as Record<string, unknown>;
      const patch = Object.fromEntries(
        keys
          .filter((key) => source[key] !== undefined)
          .map((key) => [key, source[key]])
      ) as Partial<SettingsUpdateRequest>;
      const parsed = Object.keys(patch).length === 0
        ? { success: true as const, data: {} }
        : settingsUpdateRequestSchema.safeParse(patch);

      if (!parsed.success) {
        return {
          patch: {},
          status: {
            path,
            exists: true,
            valid: false,
            appliedKeys: [],
            conflicts: [],
            error: parsed.error.issues[0]?.message ?? "External JSON failed validation."
          }
        };
      }

      return {
        patch: parsed.data,
        status: {
          path,
          exists: true,
          valid: true,
          appliedKeys: Object.keys(parsed.data),
          conflicts: [],
          error: null
        }
      };
    } catch (error) {
      return {
        patch: {},
        status: {
          path,
          exists: true,
          valid: false,
          appliedKeys: [],
          conflicts: [],
          error: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }

  private snippets(includeContent: boolean): CustomizationStatusResponse["snippets"] {
    const enabledState = this.readCustomizationState<Record<string, boolean>>("snippetsEnabled", {});
    return safeDirectoryEntries(this.snippetsDirectory())
      .filter((entry) => entry.name.endsWith(".css"))
      .map((entry) => {
        const id = entry.name;
        const path = join(this.snippetsDirectory(), entry.name);
        const stat = statSync(path);
        const enabled = enabledState[id] === true;
        let content: string | undefined;
        let error: string | null = null;

        if (stat.size > MAX_CSS_BYTES) {
          error = "CSS snippet is larger than 200 KB.";
        } else if (enabled && includeContent) {
          content = readFileSync(path, "utf8");
        }

        return {
          id,
          fileName: entry.name,
          path,
          enabled,
          sizeBytes: stat.size,
          updatedAt: stat.mtime.toISOString(),
          ...(content === undefined ? {} : { content }),
          error
        };
      });
  }

  private extensions(includeCode: boolean): CustomizationExtension[] {
    const enabledState = this.readCustomizationState<Record<string, boolean>>("extensionsEnabled", {});
    const logs = this.readCustomizationState<Record<string, string[]>>("extensionLogs", {});
    return safeDirectoryEntries(this.extensionsDirectory())
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const extensionPath = join(this.extensionsDirectory(), entry.name);
        const manifestPath = join(extensionPath, "manifest.json");
        try {
          const manifest = extensionManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
          const mainPath = safeChildPath(extensionPath, manifest.main);
          if (!mainPath) {
            throw new Error("Extension main must stay inside the extension directory.");
          }

          const stat = statSync(mainPath);
          if (!stat.isFile()) {
            throw new Error("Extension main must be a file.");
          }
          if (stat.size > MAX_EXTENSION_BYTES) {
            throw new Error("Extension main is larger than 200 KB.");
          }

          const enabled = enabledState[manifest.id] === true;
          return {
            id: manifest.id,
            name: manifest.name,
            version: manifest.version,
            path: extensionPath,
            mainPath,
            enabled,
            capabilities: manifest.capabilities,
            ...(enabled && includeCode ? { code: readFileSync(mainPath, "utf8") } : {}),
            logs: logs[manifest.id] ?? [],
            error: null
          };
        } catch (error) {
          return {
            id: entry.name,
            name: entry.name,
            version: "0.0.0",
            path: extensionPath,
            mainPath: manifestPath,
            enabled: false,
            capabilities: [],
            logs: logs[entry.name] ?? [],
            error: error instanceof Error ? error.message : String(error)
          };
        }
      });
  }

  private replaceIcsCalendar(parsed: ParsedIcsCalendar, now: string): IcsImportResponse {
    this.ensureLocalIcsAccount(now);
    const calendarId = parsed.calendarId ?? `ics-calendar:${hashId(parsed.sourceId)}`;
    const operations: SqliteWriteOperation[] = [
      ...this.deleteIcsCalendarOperations(calendarId, now),
      {
        kind: "run",
        sql: `INSERT INTO google_calendar_lists (
          id, account_id, google_id, summary, description, time_zone, background_color,
          foreground_color, access_role, is_selected, is_hidden, is_primary, etag,
          google_updated_at, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'reader', 1, 0, 0, NULL, NULL, ?, ?, NULL)
        ON CONFLICT(account_id, google_id) DO UPDATE SET
          summary = excluded.summary,
          description = excluded.description,
          time_zone = excluded.time_zone,
          background_color = excluded.background_color,
          foreground_color = excluded.foreground_color,
          deleted_at = NULL,
          updated_at = excluded.updated_at;`,
        params: [
          calendarId,
          LOCAL_ICS_ACCOUNT_ID,
          calendarId,
          parsed.title,
          "Read-only ICS calendar",
          parsed.timeZone,
          "#64748b",
          "#ffffff",
          now,
          now
        ]
      }
    ];

    for (const event of parsed.events) {
      const eventId = `${calendarId}:event:${hashId(event.uid)}`;
      operations.push(
        {
          kind: "run",
          sql: `INSERT INTO google_calendar_events (
            id, account_id, calendar_id, google_id, recurring_event_id, original_start_at,
            status, summary, description, location, start_at, start_time_zone, end_at,
            end_time_zone, is_all_day, recurrence_rule, color_id, transparency, visibility,
            local_time_zone, hcb_kind, local_tags_json, attendee_emails_json,
            attendee_details_json, reminder_minutes_json, reminders_json, reminders_use_default,
            conference_json, etag, sequence, google_updated_at, created_at, updated_at, deleted_at
          ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'opaque', 'default',
            ?, NULL, '[]', '[]', '[]', '[]', '[]', 0, NULL, NULL, NULL, ?, ?, ?, NULL);`,
          params: [
            eventId,
            LOCAL_ICS_ACCOUNT_ID,
            calendarId,
            event.uid,
            event.status,
            event.summary,
            event.description,
            event.location,
            event.startsAt,
            event.timeZone,
            event.endsAt,
            event.timeZone,
            boolInt(event.allDay),
            event.recurrenceRule,
            event.timeZone,
            event.updatedAt ?? now,
            now,
            now
          ]
        },
        {
          kind: "run",
          sql: `INSERT INTO google_calendar_event_instances (
            id, account_id, calendar_id, event_id, google_event_id, recurring_event_id,
            original_start_at, start_at, end_at, is_all_day, status, completed_at,
            updated_at, deleted_at
          ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, ?, NULL);`,
          params: [
            eventId,
            LOCAL_ICS_ACCOUNT_ID,
            calendarId,
            eventId,
            event.uid,
            event.startsAt,
            event.endsAt,
            boolInt(event.allDay),
            event.status,
            event.updatedAt ?? now
          ]
        }
      );
    }

    this.connection.executeTransaction(operations);
    return {
      calendarId,
      calendarTitle: parsed.title,
      importedEventCount: parsed.events.length,
      skippedEventCount: parsed.skipped,
      revision: now
    };
  }

  private deleteIcsCalendarOperations(calendarId: string, now: string): SqliteWriteOperation[] {
    return [
      {
        kind: "run",
        sql: "UPDATE google_calendar_event_instances SET deleted_at = ?, status = 'cancelled', updated_at = ? WHERE calendar_id = ?;",
        params: [now, now, calendarId]
      },
      {
        kind: "run",
        sql: "UPDATE google_calendar_events SET deleted_at = ?, status = 'cancelled', updated_at = ? WHERE calendar_id = ?;",
        params: [now, now, calendarId]
      },
      {
        kind: "run",
        sql: "UPDATE google_calendar_lists SET deleted_at = ?, updated_at = ? WHERE id = ? AND account_id = ?;",
        params: [now, now, calendarId, LOCAL_ICS_ACCOUNT_ID]
      }
    ];
  }

  private markIcsSubscription(
    id: string,
    attemptedAt: string,
    successAt: string | null,
    error: string | null,
    etag: string | null,
    lastModified: string | null
  ): void {
    this.connection.run(
      `UPDATE local_ics_subscriptions
       SET last_attempt_at = ?,
           last_success_at = COALESCE(?, last_success_at),
           last_error = ?,
           etag = ?,
           last_modified = ?,
           updated_at = ?
       WHERE id = ?;`,
      [attemptedAt, successAt, error, etag, lastModified, attemptedAt, id]
    );
  }

  private icsSubscriptionRows(): IcsSubscriptionSummary[] {
    return this.connection.query<{
      id: string;
      url: string;
      title: string;
      enabled: number;
      refreshMinutes: number;
      calendarId: string;
      lastAttemptAt: string | null;
      lastSuccessAt: string | null;
      lastError: string | null;
      eventCount: number;
      etag: string | null;
      lastModified: string | null;
    }>(
      `SELECT subs.id,
              subs.url,
              subs.title,
              subs.enabled,
              subs.refresh_minutes AS refreshMinutes,
              subs.calendar_id AS calendarId,
              subs.last_attempt_at AS lastAttemptAt,
              subs.last_success_at AS lastSuccessAt,
              subs.last_error AS lastError,
              subs.etag,
              subs.last_modified AS lastModified,
              COUNT(events.id) AS eventCount
       FROM local_ics_subscriptions subs
       LEFT JOIN google_calendar_events events
         ON events.calendar_id = subs.calendar_id
        AND events.deleted_at IS NULL
        AND events.status != 'cancelled'
       WHERE subs.deleted_at IS NULL
       GROUP BY subs.id
       ORDER BY subs.updated_at DESC, subs.id DESC;`
    ).map((row) => ({
      ...row,
      enabled: row.enabled === 1
    }));
  }

  private ensureLocalIcsAccount(now: string): void {
    this.connection.run(
      `INSERT INTO google_accounts (
        id, google_account_id, email, display_name, avatar_url, locale, time_zone,
        connection_state, granted_scopes_json, missing_scopes_json, last_authenticated_at,
        created_at, updated_at, deleted_at
      ) VALUES (?, NULL, NULL, 'Local ICS', NULL, NULL, ?, 'connected', '[]', '[]', NULL, ?, ?, NULL)
      ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, deleted_at = NULL;`,
      [LOCAL_ICS_ACCOUNT_ID, systemTimeZone(), now, now]
    );
  }

  private attachmentItems(
    entityKind: AttachmentListRequest["entityKind"],
    entityId: string
  ): AttachmentSummary[] {
    const target = this.attachmentTarget(entityKind, entityId);
    return filePointersFromText(target.text).map((pointer) => {
      const path = pathFromPointer(pointer);
      const exists = existsSync(path);
      const stat = exists ? statSync(path) : null;
      return {
        id: `${target.entityKind}:${target.entityId}:${hashId(pointer)}`,
        entityKind: target.entityKind,
        entityId: target.entityId,
        pointer,
        displayName: basename(path),
        kind: imageExtensions.has(extname(path).toLowerCase()) ? "image" : "file",
        exists,
        sizeBytes: stat?.isFile() ? stat.size : null
      };
    });
  }

  private attachmentTarget(
    entityKind: AttachmentListRequest["entityKind"],
    entityId: string
  ): AttachmentTarget {
    if (entityKind === "task" || entityKind === "note") {
      const row = this.connection.get<{
        id: string;
        accountId: string | null;
        notes: string | null;
      }>(
        `SELECT id, account_id AS accountId, notes
         FROM google_tasks
         WHERE id = ? AND deleted_at IS NULL
         LIMIT 1;`,
        [entityId]
      );
      if (!row) {
        throw validationFailure("Task or note was not found.");
      }
      return taskAttachmentTarget(entityKind, row.id, row.accountId, row.notes ?? "");
    }

    const row = this.connection.get<{
      id: string;
      accountId: string;
      description: string | null;
    }>(
      `SELECT id, account_id AS accountId, description
       FROM google_calendar_events
       WHERE id = ? AND deleted_at IS NULL
       LIMIT 1;`,
      [entityId]
    );
    if (!row) {
      throw validationFailure("Calendar event was not found.");
    }
    return eventAttachmentTarget(row.id, row.accountId, row.description ?? "");
  }

  private attachmentTargetForPointer(pointer: string): AttachmentTarget {
    const task = this.connection.get<{
      id: string;
      accountId: string | null;
      notes: string | null;
      parentId: string | null;
      dueAt: string | null;
      status: string;
      isHidden: number;
    }>(
      `SELECT id,
              account_id AS accountId,
              notes,
              parent_task_id AS parentId,
              due_at AS dueAt,
              status,
              is_hidden AS isHidden
       FROM google_tasks
       WHERE deleted_at IS NULL AND notes LIKE ?
       LIMIT 1;`,
      [`%${pointer}%`]
    );
    if (task) {
      const kind: "task" | "note" = noteLikeTask(task) ? "note" : "task";
      return taskAttachmentTarget(kind, task.id, task.accountId, task.notes ?? "");
    }

    const event = this.connection.get<{
      id: string;
      accountId: string;
      description: string | null;
    }>(
      `SELECT id, account_id AS accountId, description
       FROM google_calendar_events
       WHERE deleted_at IS NULL AND description LIKE ?
       LIMIT 1;`,
      [`%${pointer}%`]
    );
    if (event) {
      return eventAttachmentTarget(event.id, event.accountId, event.description ?? "");
    }

    throw validationFailure("Attachment pointer is not attached to a visible item.");
  }

  private readCustomizationState<T>(key: string, fallback: T): T {
    const row = this.connection.get<{ valueJson: string }>(
      `SELECT value_json AS valueJson
       FROM local_settings
       WHERE scope = 'customization' AND key = ?
       LIMIT 1;`,
      [key]
    );

    if (!row) {
      return fallback;
    }

    try {
      return JSON.parse(row.valueJson) as T;
    } catch {
      return fallback;
    }
  }

  private writeCustomizationState(key: string, value: unknown): void {
    const now = new Date().toISOString();
    this.connection.run(
      `INSERT INTO local_settings (scope, key, value_json, updated_at)
       VALUES ('customization', ?, ?, ?)
       ON CONFLICT(scope, key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at;`,
      [key, JSON.stringify(value), now]
    );
  }

  private ensureCustomizationDirectories(): void {
    mkdirSync(this.appPaths.configDirectory, { recursive: true });
    mkdirSync(this.snippetsDirectory(), { recursive: true });
    mkdirSync(this.extensionsDirectory(), { recursive: true });
  }

  private safeMode(): boolean {
    return existsSync(join(this.appPaths.configDirectory, "safe-mode"));
  }

  private settingsJsonPath(): string {
    return join(this.appPaths.configDirectory, "settings.json");
  }

  private keymapJsonPath(): string {
    return join(this.appPaths.configDirectory, "keymap.json");
  }

  private snippetsDirectory(): string {
    return join(this.appPaths.configDirectory, "snippets");
  }

  private extensionsDirectory(): string {
    return join(this.appPaths.configDirectory, "extensions");
  }
}

type AttachmentTarget = {
  accountId: string | null;
  entityId: string;
  entityKind: AttachmentListRequest["entityKind"];
  text: string;
  updateOperation: (text: string, now: string) => SqliteWriteOperation;
  mutationOperation: (now: string) => SqliteWriteOperation;
};

type ParsedIcsCalendar = {
  calendarId?: string;
  events: ParsedIcsEvent[];
  skipped: number;
  sourceId: string;
  timeZone: string;
  title: string;
};

type ParsedIcsEvent = {
  allDay: boolean;
  description: string;
  endsAt: string;
  location: string;
  recurrenceRule: string | null;
  startsAt: string;
  status: "confirmed" | "tentative" | "cancelled";
  summary: string;
  timeZone: string;
  uid: string;
  updatedAt: string | null;
};

const imageExtensions = new Set([".apng", ".avif", ".gif", ".jpeg", ".jpg", ".png", ".webp"]);

function taskAttachmentTarget(
  entityKind: "task" | "note",
  entityId: string,
  accountId: string | null,
  text: string
): AttachmentTarget {
  return {
    accountId,
    entityId,
    entityKind,
    text,
    updateOperation: (nextText, now) => ({
      kind: "run",
      sql: "UPDATE google_tasks SET notes = ?, updated_at = ? WHERE id = ?;",
      params: [nextText, now, entityId]
    }),
    mutationOperation: (now) => pendingMutationOperation({
      id: `mutation:task:${randomUUID()}`,
      accountId,
      resourceType: "task",
      resourceId: entityId,
      operation: "task.update",
      payload: { id: entityId, attachmentEdit: true },
      now
    })
  };
}

function eventAttachmentTarget(entityId: string, accountId: string, text: string): AttachmentTarget {
  return {
    accountId,
    entityId,
    entityKind: "event",
    text,
    updateOperation: (nextText, now) => ({
      kind: "run",
      sql: "UPDATE google_calendar_events SET description = ?, updated_at = ? WHERE id = ?;",
      params: [nextText, now, entityId]
    }),
    mutationOperation: (now) => pendingMutationOperation({
      id: `mutation:event:${randomUUID()}`,
      accountId,
      resourceType: "event",
      resourceId: entityId,
      operation: "calendar.events.update",
      payload: { id: entityId, attachmentEdit: true },
      now
    })
  };
}

function pendingMutationOperation(input: {
  id: string;
  accountId: string | null;
  resourceType: "task" | "event";
  resourceId: string;
  operation: "task.update" | "calendar.events.update";
  payload: Record<string, unknown>;
  now: string;
}): SqliteWriteOperation {
  return {
    kind: "run",
    sql: `INSERT INTO google_pending_mutations (
      id, account_id, resource_type, resource_id, operation, payload_json, status,
      attempt_count, next_retry_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, NULL, ?, ?);`,
    params: [
      input.id,
      input.accountId,
      input.resourceType,
      input.resourceId,
      input.operation,
      JSON.stringify(input.payload),
      input.now,
      input.now
    ]
  };
}

function safeDirectoryEntries(path: string) {
  try {
    return readdirSync(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

function safeChildPath(root: string, child: string): string | null {
  const normalizedRoot = normalize(root);
  const normalizedPath = normalize(join(root, child));
  const relativePath = relative(normalizedRoot, normalizedPath);
  return relativePath && !relativePath.startsWith("..") && !isAbsolute(relativePath) ? normalizedPath : null;
}

function safeFileName(value: string): string {
  const cleaned = value.trim().replace(/[^\w .@()+-]/g, "_").replace(/\s+/g, " ").slice(0, 180);
  return cleaned || "attachment";
}

function uniquePath(directory: string, fileName: string): string {
  const extension = extname(fileName);
  const stem = basename(fileName, extension);
  let candidate = join(directory, fileName);
  let index = 2;

  while (existsSync(candidate)) {
    candidate = join(directory, `${stem}-${index}${extension}`);
    index += 1;
  }

  return candidate;
}

function appendAttachmentLine(text: string, line: string): string {
  const trimmed = text.trimEnd();
  return `${trimmed}${trimmed ? "\n\n" : ""}${line}`;
}

function removeAttachmentPointer(text: string, pointer: string): string {
  return text
    .split("\n")
    .filter((line) => !line.includes(pointer))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

function filePointersFromText(value: string): string[] {
  const pointers: string[] = [];
  const pointerPattern = /file:\/\/[^\s)'"<>]+/g;

  for (const match of value.matchAll(pointerPattern)) {
    pointers.push(match[0]);
  }

  return [...new Set(pointers)];
}

function pathFromPointer(pointer: string): string {
  try {
    return fileURLToPath(pointer);
  } catch {
    throw validationFailure("Attachment pointer is not a valid file URL.");
  }
}

function hashId(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 24);
}

function isLocalIcsAccount(accountId: string | null): boolean {
  return accountId === LOCAL_ICS_ACCOUNT_ID;
}

function noteLikeTask(row: { dueAt: string | null; isHidden: number; parentId: string | null; status: string }): boolean {
  return row.isHidden !== 1 &&
    row.status !== "completed" &&
    row.parentId === null &&
    row.dueAt === null;
}

function normalizeIcsUrl(value: string): string {
  const trimmed = value.trim();
  const normalized = trimmed.startsWith("webcal://")
    ? `https://${trimmed.slice("webcal://".length)}`
    : trimmed;
  const url = new URL(normalized);

  if (url.protocol !== "https:") {
    throw validationFailure("ICS subscriptions must use https:// or webcal:// URLs.");
  }

  return url.href;
}

function hostTitle(value: string): string {
  try {
    return new URL(value).hostname || "ICS subscription";
  } catch {
    return "ICS subscription";
  }
}

function parseIcs(
  content: string,
  input: { calendarId?: string; calendarTitle: string; sourceId: string }
): ParsedIcsCalendar {
  const lines = unfoldIcsLines(content);
  let title = input.calendarTitle;
  let timeZone = systemTimeZone();
  const events: ParsedIcsEvent[] = [];
  let current: Record<string, IcsProperty[]> | null = null;
  let skipped = 0;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (current) {
        const event = parseIcsEvent(current, timeZone);
        if (event) {
          events.push(event);
        } else {
          skipped += 1;
        }
      }
      current = null;
      continue;
    }
    if (current) {
      const property = parseIcsProperty(line);
      if (property) {
        const bucket = current[property.name] ?? [];
        bucket.push(property);
        current[property.name] = bucket;
      }
      continue;
    }

    const property = parseIcsProperty(line);
    if (!property) {
      continue;
    }
    if (property.name === "X-WR-CALNAME" && property.value.trim()) {
      title = property.value.trim();
    }
    if (property.name === "X-WR-TIMEZONE" && property.value.trim()) {
      timeZone = property.value.trim();
    }
  }

  return {
    calendarId: input.calendarId,
    events,
    skipped,
    sourceId: input.sourceId,
    timeZone,
    title
  };
}

type IcsProperty = {
  name: string;
  params: Record<string, string>;
  value: string;
};

function unfoldIcsLines(content: string): string[] {
  const lines: string[] = [];
  for (const rawLine of content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    if ((rawLine.startsWith(" ") || rawLine.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] = `${lines[lines.length - 1]}${rawLine.slice(1)}`;
    } else if (rawLine.trim()) {
      lines.push(rawLine.trimEnd());
    }
  }
  return lines;
}

function parseIcsProperty(line: string): IcsProperty | null {
  const separator = line.indexOf(":");
  if (separator < 0) {
    return null;
  }

  const head = line.slice(0, separator);
  const value = unescapeIcsText(line.slice(separator + 1));
  const [rawName, ...paramParts] = head.split(";");
  const name = rawName?.toUpperCase();
  if (!name) {
    return null;
  }

  const params: Record<string, string> = {};
  for (const part of paramParts) {
    const [key, ...rest] = part.split("=");
    if (key && rest.length > 0) {
      params[key.toUpperCase()] = rest.join("=");
    }
  }

  return { name, params, value };
}

function parseIcsEvent(
  props: Record<string, IcsProperty[]>,
  defaultTimeZone: string
): ParsedIcsEvent | null {
  const start = props.DTSTART?.[0];
  const end = props.DTEND?.[0];
  const uid = firstIcsValue(props, "UID") || `${firstIcsValue(props, "SUMMARY")}:${start?.value}`;

  if (!start || !uid) {
    return null;
  }

  const parsedStart = parseIcsDate(start, defaultTimeZone);
  const parsedEnd = end ? parseIcsDate(end, defaultTimeZone) : null;
  const endsAt = parsedEnd?.iso ?? fallbackIcsEnd(parsedStart.iso, parsedStart.allDay);
  const statusValue = firstIcsValue(props, "STATUS").toUpperCase();
  const status = statusValue === "CANCELLED"
    ? "cancelled"
    : statusValue === "TENTATIVE"
      ? "tentative"
      : "confirmed";

  return {
    allDay: parsedStart.allDay,
    description: firstIcsValue(props, "DESCRIPTION"),
    endsAt,
    location: firstIcsValue(props, "LOCATION"),
    recurrenceRule: firstIcsRawValue(props, "RRULE") || null,
    startsAt: parsedStart.iso,
    status,
    summary: firstIcsValue(props, "SUMMARY") || "Untitled event",
    timeZone: parsedStart.timeZone,
    uid,
    updatedAt: parseIcsOptionalDate(firstIcsRawValue(props, "LAST-MODIFIED") || firstIcsRawValue(props, "DTSTAMP"))
  };
}

function firstIcsValue(props: Record<string, IcsProperty[]>, key: string): string {
  return props[key]?.[0]?.value.trim() ?? "";
}

function firstIcsRawValue(props: Record<string, IcsProperty[]>, key: string): string {
  return props[key]?.[0]?.value.trim() ?? "";
}

function parseIcsDate(property: IcsProperty, defaultTimeZone: string): {
  allDay: boolean;
  iso: string;
  timeZone: string;
} {
  const value = property.value.trim();
  const allDay = property.params.VALUE === "DATE" || /^\d{8}$/.test(value);
  const timeZone = property.params.TZID ?? (value.endsWith("Z") ? "UTC" : defaultTimeZone);

  if (allDay) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6)) - 1;
    const day = Number(value.slice(6, 8));
    return { allDay: true, iso: new Date(Date.UTC(year, month, day)).toISOString(), timeZone };
  }

  const compact = value.endsWith("Z") ? value.slice(0, -1) : value;
  const year = Number(compact.slice(0, 4));
  const month = Number(compact.slice(4, 6)) - 1;
  const day = Number(compact.slice(6, 8));
  const hour = Number(compact.slice(9, 11));
  const minute = Number(compact.slice(11, 13));
  const second = Number(compact.slice(13, 15) || "0");
  return {
    allDay: false,
    iso: new Date(Date.UTC(year, month, day, hour, minute, second)).toISOString(),
    timeZone
  };
}

function parseIcsOptionalDate(value: string): string | null {
  if (!value) {
    return null;
  }
  try {
    return parseIcsDate({ name: "DTSTAMP", params: {}, value }, "UTC").iso;
  } catch {
    return null;
  }
}

function fallbackIcsEnd(startIso: string, allDay: boolean): string {
  const date = new Date(startIso);
  date.setUTCMinutes(date.getUTCMinutes() + (allDay ? 24 * 60 : 60));
  return date.toISOString();
}

function unescapeIcsText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function keymapConflicts(patch: Partial<SettingsUpdateRequest>): string[] {
  const conflicts: string[] = [];
  const keybindings = patch.keybindings ?? {};
  const leaderKeybindings = patch.leaderKeybindings ?? {};
  const seen = new Map<string, string>();
  const seenLeader = new Map<string, string>();

  for (const action of hotkeyActionIds) {
    const accelerator = keybindings[action] ?? defaultKeybindings[action];
    if (accelerator) {
      const key = accelerator.toLowerCase();
      const existing = seen.get(key);
      if (existing) {
        conflicts.push(`${accelerator} is assigned to ${existing} and ${action}.`);
      } else {
        seen.set(key, action);
      }
    }

    const leader = leaderKeybindings[action] ?? defaultLeaderKeybindings[action];
    if (leader) {
      const key = leader.toLowerCase();
      const existing = seenLeader.get(key);
      if (existing) {
        conflicts.push(`Leader ${leader} is assigned to ${existing} and ${action}.`);
      } else {
        seenLeader.set(key, action);
      }
    }
  }

  return conflicts.slice(0, 50);
}

function reportRange(range: "today" | "week" | "custom", start?: string, end?: string): { start: string; end: string } {
  if (range === "custom" && start && end) {
    return { start, end };
  }

  const now = new Date();
  const startDate = new Date(now);
  startDate.setHours(0, 0, 0, 0);
  if (range === "week") {
    startDate.setDate(startDate.getDate() - startDate.getDay());
  }
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + (range === "week" ? 7 : 1));
  return { start: startDate.toISOString(), end: endDate.toISOString() };
}

function reportMarkdown(
  tasks: Array<{ title: string; dueAt: string | null; status: string; listTitle: string }>,
  events: Array<{ title: string; startsAt: string; endsAt: string; calendarTitle: string }>,
  range: { start: string; end: string },
  generatedAt: string
): string {
  return [
    "# Hot Cross Buns report",
    "",
    `Generated: ${generatedAt}`,
    `Range: ${range.start} to ${range.end}`,
    "",
    "## Tasks",
    ...tasks.map((task) => `- [${task.status === "completed" ? "x" : " "}] ${task.title} (${task.listTitle}${task.dueAt ? `, due ${task.dueAt.slice(0, 10)}` : ""})`),
    "",
    "## Events",
    ...events.map((event) => `- ${event.startsAt} - ${event.endsAt}: ${event.title} (${event.calendarTitle})`)
  ].join("\n");
}

function reportCsv(
  tasks: Array<{ id: string; title: string; dueAt: string | null; status: string; listTitle: string }>,
  events: Array<{ id: string; title: string; startsAt: string; endsAt: string; calendarTitle: string }>
): string {
  const rows = [
    ["kind", "id", "title", "start_or_due", "end", "source", "status"],
    ...tasks.map((task) => ["task", task.id, task.title, task.dueAt ?? "", "", task.listTitle, task.status]),
    ...events.map((event) => ["event", event.id, event.title, event.startsAt, event.endsAt, event.calendarTitle, "confirmed"])
  ];
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function reportIcs(
  events: Array<{ id: string; title: string; startsAt: string; endsAt: string; location: string | null; notes: string | null }>,
  generatedAt: string
): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Hot Cross Buns//Local Report//EN",
    ...events.flatMap((event) => [
      "BEGIN:VEVENT",
      `UID:${escapeIcsText(event.id)}`,
      `DTSTAMP:${icsUtc(generatedAt)}`,
      `DTSTART:${icsUtc(event.startsAt)}`,
      `DTEND:${icsUtc(event.endsAt)}`,
      `SUMMARY:${escapeIcsText(event.title)}`,
      event.location ? `LOCATION:${escapeIcsText(event.location)}` : null,
      event.notes ? `DESCRIPTION:${escapeIcsText(event.notes)}` : null,
      "END:VEVENT"
    ].filter((line): line is string => Boolean(line))),
    "END:VCALENDAR"
  ].join("\r\n");
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function icsUtc(value: string): string {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}
