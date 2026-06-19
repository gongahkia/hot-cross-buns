import { performance } from "node:perf_hooks";
import { app } from "electron";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ipcContracts,
  type AgentActionApplyRequest,
  type AgentActionListRequest,
  type AgentActionRejectRequest,
  type AvailabilityExportRequest,
  type BootstrapGetRequest,
  type CalendarEventCompletionRequest,
  type CalendarListRequest,
  type CalendarEventCreateRequest,
  type CalendarEventDeleteRequest,
  type CalendarEventUpdateRequest,
  type CalendarRangeRequest,
  type CalendarScheduleSuggestRequest,
  type DuplicateCleanupRequest,
  type EntityByIdRequest,
  type GoogleDisconnectRequest,
  type GoogleStatusResponse,
  type GoogleSaveOAuthClientRequest,
  type HcbVaultExportRequest,
  type HcbVaultImportRequest,
  type HcbVaultRemotePullRequest,
  type HcbVaultRemotePushRequest,
  type HcbVaultRemoteStatusRequest,
  type McpSetEnabledRequest,
  type NativeCapabilitiesResponse,
  type NativeImportMenuBarIconRequest,
  type NativeOpenExternalUrlRequest,
  type NoteBrokenLinksRequest,
  type NoteCreateRequest,
  type NoteDeleteRequest,
  type NoteEntityLinksRequest,
  type NoteLinkSuggestRequest,
  type NoteListCreateRequest,
  type NoteListDeleteRequest,
  type NoteListRequest,
  type NoteListRenameRequest,
  type NoteUpdateRequest,
  type PortableArchivePathRequest,
  type PortableImportRequest,
  type SearchQueryRequest,
  type SearchIndexRebuildRequest,
  type SearchModelMutationRequest,
  type ScheduledTaskBlockCreateRequest,
  type ScheduledTaskBlockListRequest,
  type ScheduledTaskBlockMoveRequest,
  type ScheduledTaskBlockUnscheduleRequest,
  type SmartRescheduleRequest,
  type SettingsRecoveryActionRequest,
  type SettingsUpdateRequest,
  type AttachmentActionRequest,
  type AttachmentAddRequest,
  type AttachmentListRequest,
  type CustomizationExtensionLogRequest,
  type CustomizationToggleRequest,
  type IcsImportRequest,
  type IcsSubscriptionActionRequest,
  type IcsSubscriptionCreateRequest,
  type LocalReportExportRequest,
  type SyncRunNowRequest,
  type TaskCompletionRequest,
  type TaskCreateRequest,
  type TaskDeleteRequest,
  type TaskListCreateRequest,
  type TaskListDeleteRequest,
  type TaskListRenameRequest,
  type TaskListsRequest,
  type TaskListRequest,
  type TaskListResponse,
  type TaskSummary,
  type NoteListResponse,
  type TaskMoveRequest,
  type TaskUpdateRequest,
  type LocalPerformanceTiming,
  type SyncStatusResponse,
  type AutoTagReapplyApplyRequest,
  type AutoTagReapplyPreviewRequest,
  type TaskBulkRescheduleRequest,
  type TagBulkApplyRequest,
  type TagCreateRequest,
  type TagDeleteRequest,
  type TagListRequest,
  type TagMergeRequest,
  type TagUpdateRequest,
  type LocalPointerListRequest,
  type LocalPointerRepairRequest,
  type UndoStackStatusResponse,
  type WebhookDeleteRequest,
  type WebhookListRequest,
  type WebhookTestRequest,
  type WebhookUpsertRequest
} from "@shared/ipc/contracts";
import { appLogger } from "../diagnostics/appLogger";
import type { AppDomainServices } from "../services/domainInterfaces";
import type { IpcHandlerDefinition } from "./registry";

type PerformanceTimingRecorder = {
  record?: (timing: {
    kind: LocalPerformanceTiming["kind"];
    name: string;
    durationMs: number;
    metadata?: Record<string, string | number | boolean | null>;
  }) => void;
};

export function createCoreIpcHandlers(
  services: AppDomainServices,
  performanceTimings?: PerformanceTimingRecorder
): IpcHandlerDefinition[] {
  const scheduleMutationDrain = createMutationDrainScheduler(services, performanceTimings);
  const withMutationDrain = <Request, Response>(
    handle: (request: Request) => Promise<Response> | Response
  ) => async (request: Request): Promise<Response> => {
    const response = await handle(request);
    scheduleMutationDrain();
    return response;
  };

  return [
    {
      contract: ipcContracts.bootstrap.get,
      handle: (request) =>
        bootstrapSnapshot(services, request as BootstrapGetRequest, performanceTimings)
    },
    {
      contract: ipcContracts.tasks.listTaskLists,
      handle: (request) => services.planner.listTaskLists(request as TaskListsRequest)
    },
    {
      contract: ipcContracts.tasks.list,
      handle: (request) => services.planner.listTasks(request as TaskListRequest)
    },
    {
      contract: ipcContracts.tasks.get,
      handle: (request) => services.planner.getTask(request as EntityByIdRequest)
    },
    {
      contract: ipcContracts.tasks.create,
      handle: withMutationDrain(async (request) => {
        const task = await services.planner.createTask(request as TaskCreateRequest);
        void services.webhooks.emit("task.created", {
          id: task.id,
          title: task.title,
          listId: task.listId
        });
        return task;
      })
    },
    {
      contract: ipcContracts.tasks.update,
      handle: withMutationDrain((request) =>
        services.planner.updateTask(request as TaskUpdateRequest)
      )
    },
    {
      contract: ipcContracts.tasks.complete,
      handle: withMutationDrain(async (request) => {
        const task = await services.planner.completeTask(request as TaskCompletionRequest);
        void services.webhooks.emit("task.completed", {
          id: task.id,
          title: task.title,
          listId: task.listId
        });
        return task;
      })
    },
    {
      contract: ipcContracts.tasks.reopen,
      handle: withMutationDrain((request) =>
        services.planner.reopenTask(request as TaskCompletionRequest)
      )
    },
    {
      contract: ipcContracts.tasks.move,
      handle: withMutationDrain((request) =>
        services.planner.moveTask(request as TaskMoveRequest)
      )
    },
    {
      contract: ipcContracts.tasks.bulkReschedule,
      handle: withMutationDrain((request) =>
        services.planner.bulkRescheduleTasks(request as TaskBulkRescheduleRequest)
      )
    },
    {
      contract: ipcContracts.tasks.delete,
      handle: withMutationDrain((request) =>
        services.planner.deleteTask(request as TaskDeleteRequest)
      )
    },
    {
      contract: ipcContracts.tasks.createTaskList,
      handle: withMutationDrain((request) =>
        services.planner.createTaskList(request as TaskListCreateRequest)
      )
    },
    {
      contract: ipcContracts.tasks.renameTaskList,
      handle: withMutationDrain((request) =>
        services.planner.renameTaskList(request as TaskListRenameRequest)
      )
    },
    {
      contract: ipcContracts.tasks.deleteTaskList,
      handle: withMutationDrain((request) =>
        services.planner.deleteTaskList(request as TaskListDeleteRequest)
      )
    },
    {
      contract: ipcContracts.calendar.listCalendars,
      handle: (request) => services.planner.listCalendars(request as CalendarListRequest)
    },
    {
      contract: ipcContracts.calendar.listEvents,
      handle: (request) => services.planner.listCalendarEvents(request as CalendarRangeRequest)
    },
    {
      contract: ipcContracts.calendar.get,
      handle: (request) => services.planner.getCalendarEvent(request as EntityByIdRequest)
    },
    {
      contract: ipcContracts.calendar.create,
      handle: withMutationDrain((request) =>
        services.planner.createCalendarEvent(request as CalendarEventCreateRequest)
      )
    },
    {
      contract: ipcContracts.calendar.update,
      handle: withMutationDrain((request) =>
        services.planner.updateCalendarEvent(request as CalendarEventUpdateRequest)
      )
    },
    {
      contract: ipcContracts.calendar.complete,
      handle: (request) => services.planner.completeCalendarEvent(request as CalendarEventCompletionRequest)
    },
    {
      contract: ipcContracts.calendar.reopen,
      handle: (request) => services.planner.reopenCalendarEvent(request as CalendarEventCompletionRequest)
    },
    {
      contract: ipcContracts.calendar.delete,
      handle: withMutationDrain((request) =>
        services.planner.deleteCalendarEvent(request as CalendarEventDeleteRequest)
      )
    },
    {
      contract: ipcContracts.calendar.listScheduledTaskBlocks,
      handle: (request) =>
        services.planner.listScheduledTaskBlocks(request as ScheduledTaskBlockListRequest)
    },
    {
      contract: ipcContracts.calendar.scheduleTaskBlock,
      handle: withMutationDrain((request) =>
        services.planner.scheduleTaskBlock(request as ScheduledTaskBlockCreateRequest)
      )
    },
    {
      contract: ipcContracts.calendar.moveScheduledTaskBlock,
      handle: withMutationDrain((request) =>
        services.planner.moveScheduledTaskBlock(request as ScheduledTaskBlockMoveRequest)
      )
    },
    {
      contract: ipcContracts.calendar.unscheduleTaskBlock,
      handle: withMutationDrain((request) =>
        services.planner.unscheduleTaskBlock(request as ScheduledTaskBlockUnscheduleRequest)
      )
    },
    {
      contract: ipcContracts.calendar.scheduleSuggest,
      handle: (request) =>
        services.planner.scheduleSuggest(request as CalendarScheduleSuggestRequest)
    },
    {
      contract: ipcContracts.calendar.smartReschedule,
      handle: withMutationDrain((request) =>
        services.planner.smartReschedule(request as SmartRescheduleRequest)
      )
    },
    {
      contract: ipcContracts.calendar.exportAvailability,
      handle: (request) =>
        services.planner.exportAvailability(request as AvailabilityExportRequest)
    },
    {
      contract: ipcContracts.notes.list,
      handle: (request) => services.planner.listNotes(request as NoteListRequest)
    },
    {
      contract: ipcContracts.notes.createList,
      handle: withMutationDrain((request) =>
        services.planner.createNoteList(request as NoteListCreateRequest)
      )
    },
    {
      contract: ipcContracts.notes.renameList,
      handle: withMutationDrain((request) =>
        services.planner.renameNoteList(request as NoteListRenameRequest)
      )
    },
    {
      contract: ipcContracts.notes.deleteList,
      handle: withMutationDrain((request) =>
        services.planner.deleteNoteList(request as NoteListDeleteRequest)
      )
    },
    {
      contract: ipcContracts.notes.get,
      handle: (request) => services.planner.getNote(request as EntityByIdRequest)
    },
    {
      contract: ipcContracts.notes.create,
      handle: withMutationDrain((request) =>
        services.planner.createNote(request as NoteCreateRequest)
      )
    },
    {
      contract: ipcContracts.notes.update,
      handle: withMutationDrain((request) =>
        services.planner.updateNote(request as NoteUpdateRequest)
      )
    },
    {
      contract: ipcContracts.notes.delete,
      handle: withMutationDrain((request) =>
        services.planner.deleteNote(request as NoteDeleteRequest)
      )
    },
    {
      contract: ipcContracts.notes.linkSuggest,
      handle: (request) => services.planner.suggestNoteLinks(request as NoteLinkSuggestRequest)
    },
    {
      contract: ipcContracts.notes.listBrokenLinks,
      handle: (request) => services.planner.listBrokenNoteLinks(request as NoteBrokenLinksRequest)
    },
    {
      contract: ipcContracts.notes.entityLinks,
      handle: (request) => services.planner.listEntityLinks(request as NoteEntityLinksRequest)
    },
    {
      contract: ipcContracts.tags.list,
      handle: (request) => services.planner.listTags(request as TagListRequest)
    },
    {
      contract: ipcContracts.tags.create,
      handle: (request) => services.planner.createTag(request as TagCreateRequest)
    },
    {
      contract: ipcContracts.tags.update,
      handle: (request) => services.planner.updateTag(request as TagUpdateRequest)
    },
    {
      contract: ipcContracts.tags.delete,
      handle: (request) => services.planner.deleteTag(request as TagDeleteRequest)
    },
    {
      contract: ipcContracts.tags.merge,
      handle: (request) => services.planner.mergeTags(request as TagMergeRequest)
    },
    {
      contract: ipcContracts.tags.bulkApply,
      handle: (request) => services.planner.bulkApplyTags(request as TagBulkApplyRequest)
    },
    {
      contract: ipcContracts.tags.previewAutoReapply,
      handle: (request) =>
        services.planner.previewAutoTagReapply(request as AutoTagReapplyPreviewRequest)
    },
    {
      contract: ipcContracts.tags.applyAutoReapply,
      handle: withMutationDrain((request) =>
        services.planner.applyAutoTagReapply(request as AutoTagReapplyApplyRequest)
      )
    },
    {
      contract: ipcContracts.tags.analytics,
      handle: () => services.planner.tagAnalytics()
    },
    {
      contract: ipcContracts.duplicates.cleanup,
      handle: withMutationDrain((request) =>
        services.planner.cleanupDuplicates(request as DuplicateCleanupRequest)
      )
    },
    {
      contract: ipcContracts.search.query,
      handle: (request) => services.planner.search(request as SearchQueryRequest)
    },
    {
      contract: ipcContracts.search.listModels,
      handle: () => services.searchModels.listModels()
    },
    {
      contract: ipcContracts.search.installModel,
      handle: (request) => services.searchModels.installModel(request as SearchModelMutationRequest)
    },
    {
      contract: ipcContracts.search.uninstallModel,
      handle: (request) => services.searchModels.uninstallModel(request as SearchModelMutationRequest)
    },
    {
      contract: ipcContracts.search.rebuildIndex,
      handle: (request) => services.searchModels.rebuildIndex(request as SearchIndexRebuildRequest)
    },
    {
      contract: ipcContracts.agent.listActions,
      handle: (request) => services.agent.listActions(request as AgentActionListRequest)
    },
    {
      contract: ipcContracts.agent.applyAction,
      handle: withMutationDrain((request) =>
        services.agent.applyAction(request as AgentActionApplyRequest)
      )
    },
    {
      contract: ipcContracts.agent.rejectAction,
      handle: (request) => services.agent.rejectAction(request as AgentActionRejectRequest)
    },
    {
      contract: ipcContracts.agent.clearExpired,
      handle: () => services.agent.clearExpired()
    },
    {
      contract: ipcContracts.webhooks.list,
      handle: (request) => services.webhooks.list(request as WebhookListRequest)
    },
    {
      contract: ipcContracts.webhooks.upsert,
      handle: (request) => services.webhooks.upsert(request as WebhookUpsertRequest)
    },
    {
      contract: ipcContracts.webhooks.delete,
      handle: (request) => services.webhooks.delete(request as WebhookDeleteRequest)
    },
    {
      contract: ipcContracts.webhooks.test,
      handle: (request) => services.webhooks.test(request as WebhookTestRequest)
    },
    {
      contract: ipcContracts.sync.status,
      handle: () => services.sync.status()
    },
    {
      contract: ipcContracts.sync.runNow,
      handle: async (request) => {
        const result = await services.sync.runNow(request as SyncRunNowRequest);
        void services.webhooks.emit("sync.completed", {
          resources: result.resources,
          drainOnly: result.drainOnly,
          dryRun: result.dryRun
        });
        return result;
      }
    },
    {
      contract: ipcContracts.google.status,
      handle: () => services.google.status()
    },
    {
      contract: ipcContracts.google.saveOAuthClient,
      handle: (request) =>
        services.google.saveOAuthClient(request as GoogleSaveOAuthClientRequest)
    },
    {
      contract: ipcContracts.google.beginOAuth,
      handle: () => services.google.beginOAuth()
    },
    {
      contract: ipcContracts.google.disconnect,
      handle: (request) => services.google.disconnect(request as GoogleDisconnectRequest)
    },
    {
      contract: ipcContracts.settings.get,
      handle: () => services.settings.get()
    },
    {
      contract: ipcContracts.settings.update,
      handle: (request) => services.settings.update(request as SettingsUpdateRequest)
    },
    {
      contract: ipcContracts.settings.recoveryAction,
      handle: (request) =>
        services.settings.recoveryAction(request as SettingsRecoveryActionRequest)
    },
    {
      contract: ipcContracts.settings.exportPortableArchive,
      handle: () => services.settings.exportPortableArchive()
    },
    {
      contract: ipcContracts.settings.previewPortableImport,
      handle: (request) =>
        services.settings.previewPortableImport(request as PortableArchivePathRequest)
    },
    {
      contract: ipcContracts.settings.importPortableArchive,
      handle: (request) =>
        services.settings.importPortableArchive(request as PortableImportRequest)
    },
    {
      contract: ipcContracts.settings.exportHcbVault,
      handle: (request) => services.settings.exportHcbVault(request as HcbVaultExportRequest)
    },
    {
      contract: ipcContracts.settings.importHcbVault,
      handle: (request) => services.settings.importHcbVault(request as HcbVaultImportRequest)
    },
    {
      contract: ipcContracts.settings.hcbVaultRemoteStatus,
      handle: (request) =>
        services.settings.hcbVaultRemoteStatus(request as HcbVaultRemoteStatusRequest)
    },
    {
      contract: ipcContracts.settings.pushHcbVaultRemote,
      handle: (request) =>
        services.settings.pushHcbVaultRemote(request as HcbVaultRemotePushRequest)
    },
    {
      contract: ipcContracts.settings.pullHcbVaultRemote,
      handle: (request) =>
        services.settings.pullHcbVaultRemote(request as HcbVaultRemotePullRequest)
    },
    {
      contract: ipcContracts.settings.listLocalPointers,
      handle: (request) => services.settings.listLocalPointers(request as LocalPointerListRequest)
    },
    {
      contract: ipcContracts.settings.repairLocalPointer,
      handle: withMutationDrain((request) =>
        services.settings.repairLocalPointer(request as LocalPointerRepairRequest)
      )
    },
    {
      contract: ipcContracts.settings.customizationStatus,
      handle: () => services.settings.customizationStatus()
    },
    {
      contract: ipcContracts.settings.reloadCustomization,
      handle: () => services.settings.reloadCustomization()
    },
    {
      contract: ipcContracts.settings.setSnippetEnabled,
      handle: (request) =>
        services.settings.setSnippetEnabled(request as CustomizationToggleRequest)
    },
    {
      contract: ipcContracts.settings.setExtensionEnabled,
      handle: (request) =>
        services.settings.setExtensionEnabled(request as CustomizationToggleRequest)
    },
    {
      contract: ipcContracts.settings.logExtensionMessage,
      handle: (request) =>
        services.settings.logExtensionMessage(request as CustomizationExtensionLogRequest)
    },
    {
      contract: ipcContracts.settings.listAttachments,
      handle: (request) => services.settings.listAttachments(request as AttachmentListRequest)
    },
    {
      contract: ipcContracts.settings.addAttachment,
      handle: withMutationDrain((request) =>
        services.settings.addAttachment(request as AttachmentAddRequest)
      )
    },
    {
      contract: ipcContracts.settings.removeAttachment,
      handle: withMutationDrain((request) =>
        services.settings.removeAttachment(request as AttachmentActionRequest)
      )
    },
    {
      contract: ipcContracts.settings.openAttachment,
      handle: (request) => services.settings.openAttachment(request as AttachmentActionRequest)
    },
    {
      contract: ipcContracts.settings.downloadAttachment,
      handle: (request) => services.settings.downloadAttachment(request as AttachmentActionRequest)
    },
    {
      contract: ipcContracts.settings.importIcs,
      handle: (request) => services.settings.importIcs(request as IcsImportRequest)
    },
    {
      contract: ipcContracts.settings.listIcsSubscriptions,
      handle: () => services.settings.listIcsSubscriptions()
    },
    {
      contract: ipcContracts.settings.subscribeIcs,
      handle: (request) => services.settings.subscribeIcs(request as IcsSubscriptionCreateRequest)
    },
    {
      contract: ipcContracts.settings.refreshIcsSubscription,
      handle: (request) =>
        services.settings.refreshIcsSubscription(request as IcsSubscriptionActionRequest)
    },
    {
      contract: ipcContracts.settings.deleteIcsSubscription,
      handle: (request) =>
        services.settings.deleteIcsSubscription(request as IcsSubscriptionActionRequest)
    },
    {
      contract: ipcContracts.settings.exportLocalReport,
      handle: (request) => services.settings.exportLocalReport(request as LocalReportExportRequest)
    },
    {
      contract: ipcContracts.undo.status,
      handle: () => services.undo.status()
    },
    {
      contract: ipcContracts.undo.undo,
      handle: () => services.undo.undo()
    },
    {
      contract: ipcContracts.undo.redo,
      handle: () => services.undo.redo()
    },
    {
      contract: ipcContracts.mcp.status,
      handle: () => services.mcp.status()
    },
    {
      contract: ipcContracts.mcp.setEnabled,
      handle: (request) => services.mcp.setEnabled(request as McpSetEnabledRequest)
    },
    {
      contract: ipcContracts.native.capabilities,
      handle: () => services.native.capabilities()
    },
    {
      contract: ipcContracts.native.requestNotificationPermission,
      handle: () => services.native.requestNotificationPermission()
    },
    {
      contract: ipcContracts.native.listFontFamilies,
      handle: () => services.native.listFontFamilies()
    },
    {
      contract: ipcContracts.native.importMenuBarIcon,
      handle: (request) => importMenuBarIcon(request as NativeImportMenuBarIconRequest)
    },
    {
      contract: ipcContracts.native.openExternalUrl,
      handle: (request) => services.native.openExternalUrl(request as NativeOpenExternalUrlRequest)
    }
  ];
}

function importMenuBarIcon(request: NativeImportMenuBarIconRequest) {
  const buffer = Buffer.from(request.dataBase64, "base64");
  if (!isPng(buffer)) {
    throw new Error("Menu bar icon must be a PNG file.");
  }

  const now = new Date().toISOString();
  const uuid = randomUUID();
  const id = `custom:${uuid}`;
  const fileName = `custom-${uuid}.png`;
  const directory = join(app.getPath("userData"), "menu-bar-icons", "custom");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, fileName), buffer);

  return {
    id,
    name: request.name.trim(),
    fileName,
    createdAt: now,
    updatedAt: now
  };
}

function isPng(buffer: Buffer): boolean {
  return (
    buffer.length > 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  );
}

async function bootstrapSnapshot(
  services: AppDomainServices,
  request: BootstrapGetRequest,
  performanceTimings?: PerformanceTimingRecorder
) {
  const startedAt = performance.now();
  const mode = request.mode ?? "full";
  const timingName = mode === "light" ? "startup.bootstrap.light" : "startup.bootstrap.get";

  try {
    const commonTimings: Record<string, number> = {};
    const timedCommon = <T>(name: string, read: () => Promise<T> | T): Promise<T> | T => {
      const phaseStartedAt = performance.now();

      try {
        return read();
      } finally {
        commonTimings[`${name}DurationMs`] = Math.round((performance.now() - phaseStartedAt) * 100) / 100;
      }
    };
    const fullTaskPages = mode === "full"
      ? Promise.all([
          loadAllBootstrapPages({ status: "all", limit: 100 }, (pageRequest) =>
            services.planner.listTasks(pageRequest)
          ),
          loadAllBootstrapPages({ status: "hidden", limit: 100 }, (pageRequest) =>
            services.planner.listTasks(pageRequest)
          ),
          loadAllBootstrapPages({ status: "deleted", limit: 100 }, (pageRequest) =>
            services.planner.listTasks(pageRequest)
          )
        ])
      : null;
    const commonStartedAt = performance.now();
    let taskLists: Awaited<ReturnType<AppDomainServices["planner"]["listTaskLists"]>>;
    let calendars: Awaited<ReturnType<AppDomainServices["planner"]["listCalendars"]>>;
    let events: Awaited<ReturnType<AppDomainServices["planner"]["listCalendarEvents"]>>;
    let scheduledTaskBlocks: Awaited<ReturnType<AppDomainServices["planner"]["listScheduledTaskBlocks"]>>;
    let notesPage: NoteListResponse;
    let tags: Awaited<ReturnType<AppDomainServices["planner"]["listTags"]>>;
    let settings: Awaited<ReturnType<AppDomainServices["settings"]["get"]>>;
    let syncStatus: SyncStatusResponse;
    let googleStatus: GoogleStatusResponse;
    let undoStatus: UndoStackStatusResponse;
    let native: NativeCapabilitiesResponse;

    if (mode === "light") {
      const taskListsValue = timedCommon("taskLists", () =>
        services.planner.listTaskLists({ limit: 100 })
      );
      taskLists = isPromiseLike(taskListsValue) ? await taskListsValue : taskListsValue;
      const calendarsValue = timedCommon("calendars", () =>
        services.planner.listCalendars({ limit: 100 })
      );
      calendars = isPromiseLike(calendarsValue) ? await calendarsValue : calendarsValue;
      const eventsValue = timedCommon("events", () =>
        services.planner.listCalendarEvents({
          start: request.calendarRange.start,
          end: request.calendarRange.end,
          limit: request.calendarRange.limit ?? 500
        })
      );
      events = isPromiseLike(eventsValue) ? await eventsValue : eventsValue;
      const scheduledTaskBlocksValue = timedCommon("scheduledTaskBlocks", () =>
        services.planner.listScheduledTaskBlocks({
          start: request.calendarRange.start,
          end: request.calendarRange.end,
          limit: 500
        })
      );
      scheduledTaskBlocks = isPromiseLike(scheduledTaskBlocksValue)
        ? await scheduledTaskBlocksValue
        : scheduledTaskBlocksValue;
      notesPage = timedCommon("notes", () => emptyNotesResponse()) as NoteListResponse;
      const tagsValue = timedCommon("tags", () => services.planner.listTags({ limit: 100 }));
      tags = isPromiseLike(tagsValue) ? await tagsValue : tagsValue;
      const settingsValue = timedCommon("settings", () => services.settings.get());
      settings = isPromiseLike(settingsValue) ? await settingsValue : settingsValue;
      syncStatus = timedCommon("syncStatus", () => deferredSyncStatus()) as SyncStatusResponse;
      googleStatus = timedCommon("googleStatus", () => deferredGoogleStatus()) as GoogleStatusResponse;
      undoStatus = timedCommon("undoStatus", () => deferredUndoStatus()) as UndoStackStatusResponse;
      native = timedCommon("native", () => deferredNativeCapabilities()) as NativeCapabilitiesResponse;
    } else {
      [
        taskLists,
        calendars,
        events,
        scheduledTaskBlocks,
        notesPage,
        tags,
        settings,
        syncStatus,
        googleStatus,
        undoStatus,
        native
      ] = await Promise.all([
        loadAllBootstrapPages({ limit: 100 }, (pageRequest) =>
          services.planner.listTaskLists(pageRequest)
        ),
        loadAllBootstrapPages({ limit: 100 }, (pageRequest) =>
          services.planner.listCalendars(pageRequest)
        ),
        loadAllBootstrapPages(
          {
            start: request.calendarRange.start,
            end: request.calendarRange.end,
            limit: request.calendarRange.limit ?? 500
          },
          (pageRequest) => services.planner.listCalendarEvents(pageRequest)
        ),
        loadAllBootstrapPages(
          {
            start: request.calendarRange.start,
            end: request.calendarRange.end,
            limit: 500
          },
          (pageRequest) => services.planner.listScheduledTaskBlocks(pageRequest)
        ),
        loadAllBootstrapPages({ limit: 50 }, (pageRequest) =>
          services.planner.listNotes(pageRequest)
        ),
        loadAllBootstrapPages({ limit: 100 }, (pageRequest) =>
          services.planner.listTags(pageRequest)
        ),
        services.settings.get(),
        services.sync.status(),
        services.google.status(),
        services.undo.status(),
        services.native.capabilities()
      ]);
    }
    const commonDurationMs = performance.now() - commonStartedAt;
    const taskStartedAt = performance.now();
    const [tasks, hiddenTasks, deletedTasks] = fullTaskPages
      ? await fullTaskPages
      : [
          await loadLightBootstrapTasks(
            services,
            request,
            taskListIdsForBootstrap(settings.selectedTaskListIds, taskLists.items),
            linkedTaskIds(events.items)
          ),
          emptyTaskResponse(),
          emptyTaskResponse()
        ];
    const taskDurationMs = performance.now() - taskStartedAt;
    const notes = mode === "light" ? emptyNotesFromPage(notesPage) : notesPage;
    const snapshotStartedAt = performance.now();

    const snapshot = {
      taskLists,
      tasks,
      hiddenTasks,
      deletedTasks,
      calendars,
      events,
      scheduledTaskBlocks,
      notes,
      tags,
      settings,
      syncStatus,
      googleStatus,
      undoStatus,
      native,
      resourceCounts: {
        calendarEvents: calendars.items.every((calendar) => calendar.eventCount !== undefined)
          ? calendars.items.reduce((count, calendar) => count + (calendar.eventCount ?? 0), 0)
          : knownTotal(events.page.totalKnown, events.items.length),
        notes: knownTotal(notes.page.totalKnown, notes.items.length),
        tasks: taskLists.items.every((taskList) => taskList.taskCount !== undefined)
          ? taskLists.items.reduce((count, taskList) => count + (taskList.taskCount ?? 0), 0)
          : knownTotal(tasks.page.totalKnown, tasks.items.length) +
            knownTotal(hiddenTasks.page.totalKnown, hiddenTasks.items.length) +
            knownTotal(deletedTasks.page.totalKnown, deletedTasks.items.length)
      }
    };
    const snapshotDurationMs = performance.now() - snapshotStartedAt;
    const payloadStartedAt = performance.now();
    const snapshotPayloadBytes = payloadBytes(snapshot);
    const payloadDurationMs = performance.now() - payloadStartedAt;

    if (mode === "light") {
      recordPerformanceTiming(performanceTimings, {
        kind: "startup",
        name: "startup.bootstrap.light.phase",
        durationMs: performance.now() - startedAt,
        metadata: {
          commonDurationMs: Math.round(commonDurationMs * 100) / 100,
          taskDurationMs: Math.round(taskDurationMs * 100) / 100,
          snapshotDurationMs: Math.round(snapshotDurationMs * 100) / 100,
          payloadDurationMs: Math.round(payloadDurationMs * 100) / 100,
          ...commonTimings
        }
      });
    }

    recordPerformanceTiming(performanceTimings, {
      kind: "startup",
      name: timingName,
      durationMs: performance.now() - startedAt,
      metadata: {
        outcome: "used",
        mode,
        tasks: snapshot.resourceCounts.tasks,
        loadedTasks: tasks.items.length + hiddenTasks.items.length + deletedTasks.items.length,
        calendarEvents: snapshot.resourceCounts.calendarEvents,
        notes: snapshot.resourceCounts.notes,
        loadedNotes: notes.items.length,
        tags: tags.items.length,
        payloadBytes: snapshotPayloadBytes
      }
    });

    return snapshot;
  } catch (thrown) {
    recordPerformanceTiming(performanceTimings, {
      kind: "startup",
      name: timingName,
      durationMs: performance.now() - startedAt,
      metadata: {
        outcome: "failed",
        mode
      }
    });

    throw thrown;
  }
}

async function loadLightBootstrapTasks(
  services: AppDomainServices,
  request: BootstrapGetRequest,
  listIds: string[],
  linkedTaskIds: string[]
): Promise<TaskListResponse> {
  if (services.planner.listCalendarBootstrapTasks) {
    return loadAllBootstrapPages(
      {
        start: request.calendarRange.start,
        end: request.calendarRange.end,
        listIds,
        taskIds: linkedTaskIds,
        limit: 100
      },
      (pageRequest) => services.planner.listCalendarBootstrapTasks!(pageRequest)
    );
  }

  const fullPage = await loadAllBootstrapPages({ status: "all", limit: 100 }, (pageRequest) =>
    services.planner.listTasks(pageRequest)
  );
  const linkedIds = new Set(linkedTaskIds);
  const selectedListIds = new Set(listIds);
  const items = fullPage.items.filter((task) =>
    linkedIds.has(task.id) ||
    (
      selectedListIds.has(task.listId) &&
      rootTaskDueInRange(task, request.calendarRange.start, request.calendarRange.end)
    )
  );

  return {
    ...fullPage,
    items,
    page: {
      limit: fullPage.page.limit,
      totalKnown: items.length
    }
  };
}

function taskListIdsForBootstrap(
  selectedTaskListIds: readonly string[],
  taskLists: readonly { id: string }[]
): string[] {
  return selectedTaskListIds.length > 0
    ? [...selectedTaskListIds]
    : taskLists.map((taskList) => taskList.id);
}

function rootTaskDueInRange(task: TaskSummary, start: string, end: string): boolean {
  return Boolean(
    task.parentId == null &&
    task.dueAt &&
    task.dueAt >= start &&
    task.dueAt < end
  );
}

function linkedTaskIds(events: { linkedTaskId?: string }[]): string[] {
  return [...new Set(events.flatMap((event) => event.linkedTaskId ? [event.linkedTaskId] : []))];
}

function emptyTaskResponse(): TaskListResponse {
  return {
    items: [],
    page: {
      limit: 1,
      totalKnown: 0
    }
  };
}

function emptyNotesResponse(): NoteListResponse {
  return {
    items: [],
    lists: [],
    page: {
      limit: 1,
      totalKnown: 0
    }
  };
}

function emptyNotesFromPage(notes: NoteListResponse): NoteListResponse {
  const { nextCursor: _nextCursor, ...page } = notes.page;

  return {
    ...notes,
    items: [],
    page
  };
}

function deferredSyncStatus(): SyncStatusResponse {
  return {
    state: "idle",
    pendingMutationCount: 0,
    offline: true,
    stale: true
  };
}

function deferredGoogleStatus(): GoogleStatusResponse {
  return {
    oauthClientConfigured: false,
    clientId: null,
    hasClientSecret: false,
    accounts: []
  };
}

function deferredUndoStatus(): UndoStackStatusResponse {
  return {
    canUndo: false,
    canRedo: false
  };
}

function deferredNativeCapabilities(): NativeCapabilitiesResponse {
  return {
    platform: "unknown",
    notifications: false,
    globalShortcuts: false,
    tray: false,
    deepLinks: false,
    trayStatus: {
      state: "unsupported",
      message: "Native shell status is deferred until after first render."
    },
    notificationsStatus: {
      permission: "unsupported",
      scheduledCount: 0,
      state: "unsupported",
      message: "Notification status is deferred until after first render."
    },
    deepLinkStatus: {
      scheme: "hotcrossbuns",
      registered: false,
      state: "unsupported",
      message: "Deep link status is deferred until after first render."
    },
    updaterStatus: {
      state: "unsupported",
      message: "Updater status is deferred until after first render."
    },
    mcpStatus: {
      state: "disabled",
      message: "MCP status is deferred until after first render."
    },
    capabilityReport: {
      platform: "unknown",
      adapterId: "deferred",
      packageFormat: "development",
      flags: {
        supportsAppPaths: false,
        supportsTray: false,
        supportsAppMenu: false,
        supportsGlobalShortcut: false,
        supportsNotifications: false,
        supportsNotificationPermissionQuery: false,
        supportsProtocolRegistration: false,
        supportsProtocolRegistrationCheck: false,
        supportsAutostart: false,
        supportsInPlaceAutoUpdate: false,
        supportsInstallerMetadata: false,
        supportsExternalUrlOpen: false,
        supportsDiagnosticsCollection: false,
        supportsCredentialStorage: false,
        supportsOAuthLoopback: false,
        supportsMcpLoopback: false,
        requiresSignedBuildForNotifications: false
      },
      paths: [],
      capabilities: [],
      diagnostics: []
    },
    deferredStartup: {
      state: "pending"
    }
  };
}

function knownTotal(pageTotal: number | undefined, itemCount: number): number {
  return pageTotal ?? itemCount;
}

type BootstrapPageRequest = Record<string, unknown> & { cursor?: string };
type BootstrapPagedResponse<Item> = {
  items: Item[];
  page: {
    limit: number;
    nextCursor?: string;
    totalKnown?: number;
  };
};

async function loadAllBootstrapPages<
  Item,
  Response extends BootstrapPagedResponse<Item>
>(
  request: BootstrapPageRequest,
  loadPage: (request: any) => Promise<Response> | Response
): Promise<Response> {
  const items: Item[] = [];
  let firstPage: Response | null = null;
  let lastPage: Response | null = null;
  let cursor = request.cursor;

  do {
    const page = await loadPage({
      ...request,
      ...(cursor === undefined ? {} : { cursor })
    });

    firstPage ??= page;
    lastPage = page;
    items.push(...page.items);
    cursor = page.page.nextCursor;
  } while (cursor !== undefined);

  if (!firstPage || !lastPage) {
    throw new Error("Paged bootstrap request returned no data.");
  }

  const { nextCursor: _nextCursor, ...pageMetadata } = lastPage.page;

  return {
    ...lastPage,
    items,
    page: {
      ...pageMetadata,
      totalKnown: lastPage.page.totalKnown ?? firstPage.page.totalKnown ?? items.length
    }
  } as Response;
}

function createMutationDrainScheduler(
  services: AppDomainServices,
  performanceTimings?: PerformanceTimingRecorder
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let requested = false;

  const schedule = (delayMs = 1_000): void => {
    requested = true;
    if (timer) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      timer = undefined;
      void run();
    }, delayMs);
  };

  const run = async (): Promise<void> => {
    if (running) {
      return;
    }

    running = true;
    requested = false;
    const startedAt = performance.now();

    try {
      const before = await Promise.resolve(services.sync.status()).catch(() => undefined);
      const result = await services.sync.runNow({ drainOnly: true });
      const after = await Promise.resolve(services.sync.status()).catch(() => undefined);

      recordPerformanceTiming(performanceTimings, {
        kind: "ipc",
        name: "sync.post-crud-drain",
        durationMs: performance.now() - startedAt,
        metadata: {
          accepted: result.accepted,
          pendingBefore: before?.pendingMutationCount ?? null,
          pendingAfter: after?.pendingMutationCount ?? null
        }
      });

      if (!result.accepted) {
        schedule(2_000);
      }
    } catch (thrown) {
      recordPerformanceTiming(performanceTimings, {
        kind: "ipc",
        name: "sync.post-crud-drain",
        durationMs: performance.now() - startedAt,
        metadata: {
          accepted: false,
          outcome: "failed"
        }
      });
      appLogger.warn("post-write mutation drain failed", "sync", {
        message: thrown instanceof Error ? thrown.message : String(thrown)
      });
    } finally {
      running = false;
      if (requested) {
        schedule();
      }
    }
  };

  return schedule;
}

function recordPerformanceTiming(
  performanceTimings: PerformanceTimingRecorder | undefined,
  timing: {
    kind: LocalPerformanceTiming["kind"];
    name: string;
    durationMs: number;
    metadata?: Record<string, string | number | boolean | null>;
  }
): void {
  performanceTimings?.record?.({
    kind: timing.kind,
    name: timing.name,
    durationMs: timing.durationMs,
    ...(timing.metadata === undefined ? {} : { metadata: timing.metadata })
  });
}

function payloadBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return 0;
  }
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as { then?: unknown }).then === "function";
}
