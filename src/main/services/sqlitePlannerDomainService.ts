import type { JsonValue } from "@shared/domain/localData";
import type {
  CalendarEventCreateRequest,
  CalendarEventUpdateRequest,
  DuplicateCleanupRequest,
  NoteCreateRequest,
  NoteUpdateRequest,
  TaskBulkMutationResponse,
  TaskCreateRequest,
  TaskUpdateRequest
} from "@shared/ipc/contracts";
import type {
  LocalPlannerRepository,
  LocalSettingsRepository,
  LocalUndoRepository
} from "../data/localRepositories";
import { applyAutoTagRules } from "./autoTags";
import type { PlannerViewDomainService } from "./domainInterfaces";
import { buildDaySchedule } from "./schedulingSuggestionService";

export function createSqlitePlannerDomainService(
  repository: LocalPlannerRepository,
  undoRepository?: LocalUndoRepository,
  settingsRepository?: LocalSettingsRepository
): PlannerViewDomainService {
  function recordUndo(input: {
    actionKind: string;
    label: string;
    resourceKind: Parameters<LocalUndoRepository["recordChange"]>[0]["resourceKind"];
    resourceId: string;
    before: unknown;
    after: unknown;
  }): void {
    undoRepository?.recordChange({
      actionKind: input.actionKind,
      label: input.label,
      resourceKind: input.resourceKind,
      resourceId: input.resourceId,
      before: jsonValue(input.before),
      after: jsonValue(input.after)
    });
  }

  function recordUndoGroup(input: {
    actionKind: string;
    label: string;
    resourceId: string;
    changes: Array<{
      actionKind: string;
      label: string;
      resourceKind: Parameters<LocalUndoRepository["recordChange"]>[0]["resourceKind"];
      resourceId: string;
      before: unknown;
      after: unknown;
    }>;
  }): void {
    undoRepository?.recordGroupChange({
      actionKind: input.actionKind,
      label: input.label,
      resourceId: input.resourceId,
      changes: input.changes.map((change) => ({
        actionKind: change.actionKind,
        label: change.label,
        resourceKind: change.resourceKind,
        resourceId: change.resourceId,
        before: jsonValue(change.before),
        after: jsonValue(change.after)
      }))
    });
  }

  function snapshotFor(kind: "task" | "event" | "note", id: string): unknown {
    if (kind === "event") {
      return undoRepository?.calendarEventSnapshot(id) ?? null;
    }
    return undoRepository?.taskSnapshot(id) ?? null;
  }

  function resourceKindFor(kind: "task" | "event" | "note") {
    return kind === "event" ? "calendarEvent" as const : "task" as const;
  }

  function queueRemoteMutations(): boolean {
    const backend = settingsRepository?.get().storageBackend;
    return backend !== "hcb-local" && backend !== "hcb-hoster";
  }

  return {
    listTaskLists: (request) => repository.listTaskLists(request),
    listTasks: (request) => repository.listTasks(request),
    listTags: (request) => repository.listTags(request),
    createTag: (request) => repository.createTag(request),
    updateTag: (request) => repository.updateTag(request),
    deleteTag: (request) => {
      const refs = repository.tagEntityRefsForIds([request.id]);
      const before = refs.map((ref) => ({ ref, snapshot: snapshotFor(ref.kind, ref.entityId) }));
      const deleted = repository.deleteTag(request);
      recordUndoGroup({
        actionKind: "tag.delete",
        label: "Delete tag",
        resourceId: request.id,
        changes: before.map(({ ref, snapshot }) => ({
          actionKind: "tag.delete",
          label: "Delete tag",
          resourceKind: resourceKindFor(ref.kind),
          resourceId: ref.entityId,
          before: snapshot,
          after: snapshotFor(ref.kind, ref.entityId)
        }))
      });
      return deleted;
    },
    mergeTags: (request) => {
      const refs = repository.tagEntityRefsForIds([request.sourceId]);
      const before = refs.map((ref) => ({ ref, snapshot: snapshotFor(ref.kind, ref.entityId) }));
      const merged = repository.mergeTags(request);
      recordUndoGroup({
        actionKind: "tag.merge",
        label: "Merge tags",
        resourceId: `${request.sourceId}:${request.targetId}`,
        changes: before.map(({ ref, snapshot }) => ({
          actionKind: "tag.merge",
          label: "Merge tags",
          resourceKind: resourceKindFor(ref.kind),
          resourceId: ref.entityId,
          before: snapshot,
          after: snapshotFor(ref.kind, ref.entityId)
        }))
      });
      return merged;
    },
    bulkApplyTags: (request) => {
      const entityIds = [...new Set(request.entityIds)];
      const before = entityIds.map((entityId) => ({
        entityId,
        snapshot: snapshotFor(request.entityKind, entityId)
      }));
      const applied = repository.bulkApplyTags(request);
      recordUndoGroup({
        actionKind: "tag.bulk_apply",
        label: "Bulk apply tags",
        resourceId: `tags:${request.entityKind}`,
        changes: before.map(({ entityId, snapshot }) => ({
          actionKind: "tag.bulk_apply",
          label: "Bulk apply tags",
          resourceKind: resourceKindFor(request.entityKind),
          resourceId: entityId,
          before: snapshot,
          after: snapshotFor(request.entityKind, entityId)
        }))
      });
      return applied;
    },
    previewAutoTagReapply: (request) =>
      repository.previewAutoTagReapply(autoTagRules(settingsRepository), request),
    applyAutoTagReapply: (request) => {
      const rules = autoTagRules(settingsRepository);
      const refs = repository.autoTagReapplyChangedRefs(rules, request);
      const before = refs.map((ref) => ({ ref, snapshot: snapshotFor(ref.kind, ref.entityId) }));
      const applied = repository.applyAutoTagReapply(rules, request);

      if (refs.length > 0) {
        recordUndoGroup({
          actionKind: "tags.auto_reapply",
          label: "Auto-tag reapply",
          resourceId: `auto-tags:${request.kind}`,
          changes: before.map(({ ref, snapshot }) => ({
            actionKind: "tags.auto_reapply",
            label: "Auto-tag reapply",
            resourceKind: resourceKindFor(ref.kind),
            resourceId: ref.entityId,
            before: snapshot,
            after: snapshotFor(ref.kind, ref.entityId)
          }))
        });
      }

      const { changedRefs: _changedRefs, ...response } = applied;
      return response;
    },
    tagAnalytics: () => repository.tagAnalytics(),
    listCalendarBootstrapTasks: (request) => repository.listCalendarBootstrapTasks(request),
    getTask: (request) => repository.getTask(request.id),
    createTask: (request) => {
      const created = repository.createTask(autoTaggedTaskCreate(settingsRepository, request));
      recordUndo({
        actionKind: "task.create",
        label: "Create task",
        resourceKind: "task",
        resourceId: created.id,
        before: null,
        after: undoRepository?.taskSnapshot(created.id)
      });
      return created;
    },
    updateTask: (request) => {
      const before = undoRepository?.taskSnapshot(request.id) ?? null;
      const updated = repository.updateTask(autoTaggedTaskUpdate(repository, settingsRepository, request));
      recordUndo({
        actionKind: "task.update",
        label: "Edit task",
        resourceKind: "task",
        resourceId: request.id,
        before,
        after: undoRepository?.taskSnapshot(request.id)
      });
      return updated;
    },
    completeTask: (request) => {
      const before = undoRepository?.taskSnapshot(request.id) ?? null;
      const completed = repository.completeTask(request);
      recordUndo({
        actionKind: "task.complete",
        label: "Complete task",
        resourceKind: "task",
        resourceId: request.id,
        before,
        after: undoRepository?.taskSnapshot(request.id)
      });
      return completed;
    },
    reopenTask: (request) => {
      const before = undoRepository?.taskSnapshot(request.id) ?? null;
      const reopened = repository.reopenTask(request);
      recordUndo({
        actionKind: "task.reopen",
        label: "Reopen task",
        resourceKind: "task",
        resourceId: request.id,
        before,
        after: undoRepository?.taskSnapshot(request.id)
      });
      return reopened;
    },
    moveTask: (request) => {
      const before = undoRepository?.taskSnapshot(request.id) ?? null;
      const moved = repository.moveTask(request);
      recordUndo({
        actionKind: "task.move",
        label: "Move task",
        resourceKind: "task",
        resourceId: request.id,
        before,
        after: undoRepository?.taskSnapshot(request.id)
      });
      return moved;
    },
    bulkRescheduleTasks: (request) => {
      const ids = [...new Set(request.taskIds)];
      const before = ids.map((id) => ({ id, snapshot: undoRepository?.taskSnapshot(id) ?? null }));
      const updated = ids.map((id) =>
        repository.updateTask(autoTaggedTaskUpdate(repository, settingsRepository, {
          id,
          dueDate: request.dueDate
        }))
      );

      recordUndoGroup({
        actionKind: "task.bulk_reschedule",
        label: "Bulk reschedule tasks",
        resourceId: `tasks:${ids.join(",")}`,
        changes: before.map(({ id, snapshot }) => ({
          actionKind: "task.bulk_reschedule",
          label: "Bulk reschedule tasks",
          resourceKind: "task",
          resourceId: id,
          before: snapshot,
          after: undoRepository?.taskSnapshot(id) ?? null
        }))
      });

      return {
        ids: updated.map((task) => task.id),
        updatedCount: updated.length,
        queued: updated.length > 0 && queueRemoteMutations(),
        revision: new Date().toISOString()
      } satisfies TaskBulkMutationResponse;
    },
    deleteTask: (request) => {
      const before = undoRepository?.taskSnapshot(request.id) ?? null;
      const deleted = repository.deleteTask(request);
      recordUndo({
        actionKind: "task.delete",
        label: "Delete task",
        resourceKind: "task",
        resourceId: request.id,
        before,
        after: null
      });
      return deleted;
    },
    createTaskList: (request) => {
      const created = repository.createTaskList(request);
      recordUndo({
        actionKind: "task_list.create",
        label: "Create task list",
        resourceKind: "taskList",
        resourceId: created.id,
        before: null,
        after: undoRepository?.taskListSnapshot(created.id)
      });
      return created;
    },
    renameTaskList: (request) => {
      const before = undoRepository?.taskListSnapshot(request.id) ?? null;
      const renamed = repository.renameTaskList(request);
      recordUndo({
        actionKind: "task_list.rename",
        label: "Rename task list",
        resourceKind: "taskList",
        resourceId: request.id,
        before,
        after: undoRepository?.taskListSnapshot(request.id)
      });
      return renamed;
    },
    deleteTaskList: (request) => {
      const before = undoRepository?.taskListSnapshot(request.id) ?? null;
      const deleted = repository.deleteTaskList(request);
      recordUndo({
        actionKind: "task_list.delete",
        label: "Delete task list",
        resourceKind: "taskList",
        resourceId: request.id,
        before,
        after: null
      });
      return deleted;
    },
    listCalendars: (request) => repository.listCalendars(request),
    listCalendarEvents: (request) => repository.listCalendarEvents(request),
    getCalendarEvent: (request) => repository.getCalendarEvent(request.id),
    createCalendarEvent: (request) => {
      const created = repository.createCalendarEvent(autoTaggedEventCreate(settingsRepository, request));
      recordUndo({
        actionKind: "calendar.events.create",
        label: "Create event",
        resourceKind: "calendarEvent",
        resourceId: created.id,
        before: null,
        after: undoRepository?.calendarEventSnapshot(created.id)
      });
      return created;
    },
    updateCalendarEvent: (request) => {
      const before = undoRepository?.calendarEventSnapshot(request.id) ?? null;
      const updated = repository.updateCalendarEvent(autoTaggedEventUpdate(repository, settingsRepository, request));
      recordUndo({
        actionKind: "calendar.events.update",
        label: "Edit event",
        resourceKind: "calendarEvent",
        resourceId: updated.id,
        before,
        after: undoRepository?.calendarEventSnapshot(updated.id)
      });
      return updated;
    },
    completeCalendarEvent: (request) => {
      const beforeDetail = repository.getCalendarEvent(request.id);
      const resourceId = beforeDetail.eventId ?? beforeDetail.id;
      const before = undoRepository?.calendarEventSnapshot(resourceId) ?? null;
      const completed = repository.completeCalendarEvent(request);
      const completedResourceId = completed.eventId ?? completed.id;
      recordUndo({
        actionKind: "calendar.events.complete",
        label: "Complete event",
        resourceKind: "calendarEvent",
        resourceId: completedResourceId,
        before,
        after: undoRepository?.calendarEventSnapshot(completedResourceId)
      });
      return completed;
    },
    reopenCalendarEvent: (request) => {
      const beforeDetail = repository.getCalendarEvent(request.id);
      const resourceId = beforeDetail.eventId ?? beforeDetail.id;
      const before = undoRepository?.calendarEventSnapshot(resourceId) ?? null;
      const reopened = repository.reopenCalendarEvent(request);
      const reopenedResourceId = reopened.eventId ?? reopened.id;
      recordUndo({
        actionKind: "calendar.events.reopen",
        label: "Reopen event",
        resourceKind: "calendarEvent",
        resourceId: reopenedResourceId,
        before,
        after: undoRepository?.calendarEventSnapshot(reopenedResourceId)
      });
      return reopened;
    },
    deleteCalendarEvent: (request) => {
      const before = undoRepository?.calendarEventSnapshot(request.id) ?? null;
      const deleted = repository.deleteCalendarEvent(request);
      recordUndo({
        actionKind: "calendar.events.delete",
        label: "Delete event",
        resourceKind: "calendarEvent",
        resourceId: deleted.id,
        before,
        after: null
      });
      return deleted;
    },
    listScheduledTaskBlocks: (request) => repository.listScheduledTaskBlocks(request),
    scheduleTaskBlock: (request) => {
      const scheduled = repository.scheduleTaskBlock(request);
      recordUndo({
        actionKind: "scheduled_task_block.create",
        label: "Schedule task",
        resourceKind: "scheduledTaskBlock",
        resourceId: scheduled.id,
        before: null,
        after: undoRepository?.scheduledTaskBlockSnapshot(scheduled.id)
      });
      return scheduled;
    },
    moveScheduledTaskBlock: (request) => {
      const before = undoRepository?.scheduledTaskBlockSnapshot(request.id) ?? null;
      const moved = repository.moveScheduledTaskBlock(request);
      recordUndo({
        actionKind: "scheduled_task_block.move",
        label: "Move scheduled task",
        resourceKind: "scheduledTaskBlock",
        resourceId: request.id,
        before,
        after: undoRepository?.scheduledTaskBlockSnapshot(request.id)
      });
      return moved;
    },
    unscheduleTaskBlock: (request) => {
      const before = undoRepository?.scheduledTaskBlockSnapshot(request.id) ?? null;
      const unscheduled = repository.unscheduleTaskBlock(request);
      recordUndo({
        actionKind: "scheduled_task_block.delete",
        label: "Unschedule task",
        resourceKind: "scheduledTaskBlock",
        resourceId: request.id,
        before,
        after: null
      });
      return unscheduled;
    },
    scheduleSuggest: (request) => {
      const start = `${request.date}T00:00:00.000Z`;
      const end = new Date(Date.parse(start) + 24 * 60 * 60 * 1000).toISOString();
      const events = repository.listCalendarEvents({
        start,
        end,
        limit: 500
      }).items;
      const tasks = repository.listTasks({
        status: "active",
        limit: 100
      }).items;

      return buildDaySchedule({
        date: request.date,
        events: events.filter((event) => event.completedAt === null || event.completedAt === undefined),
        tasks,
        capacityMinutes: request.capacityMinutes ?? 480,
        workingHours: {
          start: request.workingHours?.start ?? 6,
          end: request.workingHours?.end ?? 22
        }
      });
    },
    smartReschedule: (request) => {
      const preview = repository.smartReschedule({ ...request, apply: false });
      const beforeByBlockId = new Map(
        preview.suggestions
          .flatMap((suggestion) => suggestion.scheduledTaskBlockId ? [suggestion.scheduledTaskBlockId] : [])
          .map((blockId) => [blockId, undoRepository?.scheduledTaskBlockSnapshot(blockId) ?? null])
      );
      const result = repository.smartReschedule(request);

      if (request.apply && result.appliedBlocks.length > 0) {
        recordUndoGroup({
          actionKind: "scheduled_task_block.smart_reschedule",
          label: "Smart reschedule",
          resourceId: result.appliedBlocks[0]?.id ?? "smart-reschedule",
          changes: result.appliedBlocks.map((block) => ({
            actionKind: beforeByBlockId.has(block.id)
              ? "scheduled_task_block.move"
              : "scheduled_task_block.create",
            label: "Smart reschedule",
            resourceKind: "scheduledTaskBlock",
            resourceId: block.id,
            before: beforeByBlockId.get(block.id) ?? null,
            after: undoRepository?.scheduledTaskBlockSnapshot(block.id) ?? null
          }))
        });
      }

      return result;
    },
    exportAvailability: (request) => repository.exportAvailability(request),
    listNotes: (request) => repository.listNotes(request),
    createNoteList: (request) => {
      const created = repository.createNoteList(request);
      recordUndo({
        actionKind: "task_list.create",
        label: "Create note list",
        resourceKind: "taskList",
        resourceId: created.id,
        before: null,
        after: undoRepository?.taskListSnapshot(created.id)
      });
      return created;
    },
    renameNoteList: (request) => {
      const before = undoRepository?.taskListSnapshot(request.id) ?? null;
      const renamed = repository.renameNoteList(request);
      recordUndo({
        actionKind: "task_list.rename",
        label: "Rename note list",
        resourceKind: "taskList",
        resourceId: request.id,
        before,
        after: undoRepository?.taskListSnapshot(request.id)
      });
      return renamed;
    },
    deleteNoteList: (request) => {
      const before = undoRepository?.taskListSnapshot(request.id) ?? null;
      const deleted = repository.deleteNoteList(request);
      recordUndo({
        actionKind: "task_list.delete",
        label: "Delete note list",
        resourceKind: "taskList",
        resourceId: request.id,
        before,
        after: null
      });
      return deleted;
    },
    getNote: (request) => repository.getNote(request.id),
    createNote: (request) => {
      const created = repository.createNote(autoTaggedNoteCreate(settingsRepository, request));
      recordUndo({
        actionKind: "note.create",
        label: "Create note",
        resourceKind: "task",
        resourceId: created.id,
        before: null,
        after: undoRepository?.taskSnapshot(created.id)
      });
      return created;
    },
    updateNote: (request) => {
      const before = undoRepository?.taskSnapshot(request.id) ?? null;
      const updated = repository.updateNote(autoTaggedNoteUpdate(repository, settingsRepository, request));
      recordUndo({
        actionKind: "note.update",
        label: "Edit note",
        resourceKind: "task",
        resourceId: request.id,
        before,
        after: undoRepository?.taskSnapshot(request.id)
      });
      return updated;
    },
    deleteNote: (request) => {
      const before = undoRepository?.taskSnapshot(request.id) ?? null;
      const deleted = repository.deleteNote(request);
      recordUndo({
        actionKind: "note.delete",
        label: "Delete note",
        resourceKind: "task",
        resourceId: request.id,
        before,
        after: null
      });
      return deleted;
    },
    suggestNoteLinks: (request) => repository.suggestLinkTargets(request),
    listBrokenNoteLinks: (request) => repository.listBrokenNoteLinks(request),
    listEntityLinks: (request) => repository.listEntityLinks(request),
    search: (request) => {
      const settings = settingsRepository?.get();
      const mode = request.mode ?? settings?.semanticSearchMode ?? "lexical";
      const modelId = settings?.embeddingModelId ?? "hcb-local-hash-384";
      const semanticInstalled =
        settings?.semanticSearchModels.find((model) => model.id === modelId)?.installed ?? modelId === "hcb-local-hash-384";

      if ((mode === "semantic" || mode === "hybrid") && settings?.semanticSearchEnabled !== true) {
        const lexical = repository.search({ ...request, mode: "lexical" });
        return {
          ...lexical,
          diagnostics: {
            mode,
            semanticEnabled: false,
            indexedCount: 0,
            staleCount: 0,
            modelId,
            fallbackReason: "semantic-disabled" as const
          }
        };
      }

      return repository.search({ ...request, mode, embeddingModelId: modelId, semanticInstalled });
    },
    cleanupDuplicates: (request) => {
      const cleanupGroupId = `duplicates:${request.kind}:${request.winnerId}:${Date.now()}`;
      const ids = [request.winnerId, ...new Set(request.loserIds)];
      const before = ids.map((id) => ({ id, snapshot: snapshotFor(request.kind, id) }));
      const result = cleanupDuplicateGroup(repository, request, queueRemoteMutations());
      repository.markDuplicateCleanupMutations({
        kind: request.kind,
        winnerId: request.winnerId,
        loserIds: request.loserIds,
        cleanupGroupId
      });
      recordUndoGroup({
        actionKind: "duplicates.cleanup",
        label: "Merge duplicate group",
        resourceId: `${request.kind}:${request.winnerId}`,
        changes: before.map(({ id, snapshot }) => ({
          actionKind: "duplicates.cleanup",
          label: "Merge duplicate group",
          resourceKind: resourceKindFor(request.kind),
          resourceId: id,
          before: snapshot,
          after: snapshotFor(request.kind, id)
        }))
      });
      return result;
    }
  };
}

function jsonValue(value: unknown): JsonValue {
  return value === undefined ? null : value as JsonValue;
}

function autoTagRules(settingsRepository?: LocalSettingsRepository) {
  return settingsRepository?.get().autoTagRules ?? [];
}

function autoTaggedTaskCreate(
  settingsRepository: LocalSettingsRepository | undefined,
  request: TaskCreateRequest
): TaskCreateRequest {
  const applied = applyAutoTagRules(autoTagRules(settingsRepository), {
    kind: "task",
    title: request.title,
    body: request.notes ?? "",
    explicitTags: request.tags,
    existingTags: []
  });

  return { ...request, title: applied.title, notes: applied.body, tags: applied.tags };
}

function autoTaggedTaskUpdate(
  repository: LocalPlannerRepository,
  settingsRepository: LocalSettingsRepository | undefined,
  request: TaskUpdateRequest
): TaskUpdateRequest {
  const existing = repository.getTask(request.id);
  const title = request.title ?? existing.title;
  const body = request.notes ?? existing.notes ?? "";
  const applied = applyAutoTagRules(autoTagRules(settingsRepository), {
    kind: "task",
    title,
    body,
    explicitTags: request.tags ?? [],
    existingTags: request.tags === undefined ? existing.tags ?? [] : []
  });
  const tagged: TaskUpdateRequest = { ...request, tags: applied.tags };

  if (request.title !== undefined || applied.title !== existing.title) {
    tagged.title = applied.title;
  }

  if (request.notes !== undefined || applied.body !== (existing.notes ?? "")) {
    tagged.notes = applied.body;
  }

  return tagged;
}

function autoTaggedNoteCreate(
  settingsRepository: LocalSettingsRepository | undefined,
  request: NoteCreateRequest
): NoteCreateRequest {
  const applied = applyAutoTagRules(autoTagRules(settingsRepository), {
    kind: "note",
    title: request.title,
    body: request.body ?? "",
    explicitTags: request.tags,
    existingTags: []
  });

  return { ...request, title: applied.title, body: applied.body, tags: applied.tags };
}

function autoTaggedNoteUpdate(
  repository: LocalPlannerRepository,
  settingsRepository: LocalSettingsRepository | undefined,
  request: NoteUpdateRequest
): NoteUpdateRequest {
  const existing = repository.getNote(request.id);
  const title = request.title ?? existing.title;
  const body = request.body ?? existing.body ?? "";
  const applied = applyAutoTagRules(autoTagRules(settingsRepository), {
    kind: "note",
    title,
    body,
    explicitTags: request.tags ?? [],
    existingTags: request.tags === undefined ? existing.tags ?? [] : []
  });
  const tagged: NoteUpdateRequest = { ...request, tags: applied.tags };

  if (request.title !== undefined || applied.title !== existing.title) {
    tagged.title = applied.title;
  }

  if (request.body !== undefined || applied.body !== (existing.body ?? "")) {
    tagged.body = applied.body;
  }

  return tagged;
}

function autoTaggedEventCreate(
  settingsRepository: LocalSettingsRepository | undefined,
  request: CalendarEventCreateRequest
): CalendarEventCreateRequest {
  const applied = applyAutoTagRules(autoTagRules(settingsRepository), {
    kind: "event",
    title: request.title,
    body: request.notes ?? "",
    explicitTags: request.tags,
    existingTags: [],
    requestedEventColorId: request.colorId,
    hcbKind: request.hcbKind ?? null
  });

  return {
    ...request,
    title: applied.title,
    notes: applied.body,
    tags: applied.tags,
    ...(applied.eventColorId === undefined ? {} : { colorId: applied.eventColorId })
  };
}

function autoTaggedEventUpdate(
  repository: LocalPlannerRepository,
  settingsRepository: LocalSettingsRepository | undefined,
  request: CalendarEventUpdateRequest
): CalendarEventUpdateRequest {
  const existing = repository.getCalendarEvent(request.id);
  const title = request.title ?? existing.title;
  const body = request.notes ?? existing.notes ?? "";
  const applied = applyAutoTagRules(autoTagRules(settingsRepository), {
    kind: "event",
    title,
    body,
    explicitTags: request.tags ?? [],
    existingTags: request.tags === undefined ? existing.tags ?? [] : [],
    existingEventColorId: existing.colorId ?? null,
    requestedEventColorId: request.colorId,
    hcbKind: request.hcbKind ?? existing.hcbKind ?? null
  });
  const tagged: CalendarEventUpdateRequest = { ...request, tags: applied.tags };

  if (request.title !== undefined || applied.title !== existing.title) {
    tagged.title = applied.title;
  }

  if (request.notes !== undefined || applied.body !== (existing.notes ?? "")) {
    tagged.notes = applied.body;
  }

  if (applied.eventColorId !== undefined) {
    tagged.colorId = applied.eventColorId;
  }

  return tagged;
}

function cleanupDuplicateGroup(
  repository: LocalPlannerRepository,
  request: DuplicateCleanupRequest,
  queued: boolean
) {
  if (request.kind === "task") {
    const tasks = [request.winnerId, ...request.loserIds].map((id) => repository.getTask(id));
    const winner = tasks[0];
    repository.updateTask({
      id: request.winnerId,
      notes: mergeText(tasks.map((task) => task.notes ?? ""), 10_000),
      priority: highestPriority(tasks.map((task) => task.priority)),
      tags: uniqueText(tasks.flatMap((task) => task.tags ?? [])),
      durationMinutes: maxNullable(tasks.map((task) => task.durationMinutes ?? null)),
      snoozeUntil: minIso(tasks.map((task) => task.snoozeUntil ?? null))
    });
    for (const loserId of request.loserIds) {
      repository.deleteTask({ id: loserId });
    }
    return {
      id: winner.id,
      kind: request.kind,
      loserIds: request.loserIds,
      queued,
      revision: new Date().toISOString()
    };
  }

  if (request.kind === "event") {
    const events = [request.winnerId, ...request.loserIds].map((id) => repository.getCalendarEvent(id));
    const winner = events[0];
    repository.updateCalendarEvent({
      id: request.winnerId,
      notes: mergeText(events.map((event) => event.notes ?? ""), 20_000),
      guestEmails: uniqueText(events.flatMap((event) => event.guestEmails ?? [])),
      reminderMinutes: uniqueNumbers(events.flatMap((event) => event.reminderMinutes ?? [])),
      tags: uniqueText(events.flatMap((event) => event.tags ?? [])),
      colorId: winner.colorId ?? events.find((event) => event.colorId)?.colorId ?? null
    });
    for (const loserId of request.loserIds) {
      repository.deleteCalendarEvent({ id: loserId });
    }
    return {
      id: winner.id,
      kind: request.kind,
      loserIds: request.loserIds,
      queued,
      revision: new Date().toISOString()
    };
  }

  const notes = [request.winnerId, ...request.loserIds].map((id) => repository.getNote(id));
  const winner = notes[0];
  repository.updateNote({
    id: request.winnerId,
    body: mergeText(notes.map((note) => note.body ?? ""), 50_000),
    tags: uniqueText(notes.flatMap((note) => note.tags ?? []))
  });
  for (const loserId of request.loserIds) {
    repository.deleteNote({ id: loserId });
  }
  return {
    id: winner.id,
    kind: request.kind,
    loserIds: request.loserIds,
    queued,
    revision: new Date().toISOString()
  };
}

function mergeText(values: readonly string[], maxLength: number): string {
  const merged = values
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index)
    .join("\n\n--- merged duplicate ---\n\n");
  return merged.length <= maxLength ? merged : merged.slice(0, maxLength);
}

function uniqueText(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function uniqueNumbers(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function maxNullable(values: ReadonlyArray<number | null>): number | null {
  const numbers = values.filter((value): value is number => typeof value === "number" && value >= 0);
  return numbers.length === 0 ? null : Math.max(...numbers);
}

function minIso(values: ReadonlyArray<string | null>): string | null {
  const dates = values.filter((value): value is string => Boolean(value));
  return dates.length === 0 ? null : dates.sort()[0] ?? null;
}

type TaskPriority = NonNullable<ReturnType<LocalPlannerRepository["getTask"]>["priority"]>;

function highestPriority(values: ReadonlyArray<TaskPriority | null | undefined>): TaskPriority {
  const order = { none: 0, low: 1, medium: 2, high: 3 };
  let best: TaskPriority = "none";
  for (const value of values) {
    const priority: TaskPriority = value ?? "none";
    if (order[priority] > order[best]) {
      best = priority;
    }
  }
  return best;
}
