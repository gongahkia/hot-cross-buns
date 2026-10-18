import type { CalendarEventSummary, TaskSummary } from "@shared/ipc/contracts";
import {
  resolveEffectiveColorTheme,
  resolveEffectiveThemeMode
} from "@shared/ipc/themeCatalog";
import type { CalendarEventViewModel, TaskViewModel } from "../coreViewModels";
import {
  buildCalendarEventDayIndex,
  dayView,
  monthWeeks,
  scheduledTaskBlockConflicts,
  scheduledTaskBlockViewModel,
  stableCalendarEventViewModel,
  stableProjectedTaskCalendarEventViewModel,
  stableTaskCalendarEventViewModel,
  weekDays
} from "./calendarViewModels";
import { noteViewModel } from "./noteViewModels";
import { idleSearchViewModel } from "./searchViewModels";
import { settingsSections } from "./settingsViewModels";
import { hasSnapshotData } from "./snapshot";
import {
  groupChildTasks,
  missingTask,
  stableTaskViewModel,
  taskFilters
} from "./taskViewModels";
import type {
  CoreDataSnapshot,
  CoreViewModelSource,
  CoreViewModelSourceOptions
} from "./types";

export function buildCoreViewModelSource(
  snapshot: CoreDataSnapshot,
  options: CoreViewModelSourceOptions
): CoreViewModelSource {
  const { activeColorTheme, eventsById, calendarItems, scheduledTaskBlocksById, taskById, taskFilterViewModels, notes, noteLists, scheduledTaskBlocks, lookupTasks, calendarDayView, calendarMonthWeeks, calendarWeekDays } = cachedProjection(snapshot, options);
  const resourceCounts = {
    calendarEvents: snapshot.resourceCounts.calendarEvents ?? snapshot.diagnosticsSummary?.cache.eventCount,
    notes: snapshot.resourceCounts.notes ?? snapshot.diagnosticsSummary?.cache.noteCount,
    tasks: snapshot.resourceCounts.tasks ?? snapshot.diagnosticsSummary?.cache.taskCount
  };
  return {
    taskDataRevision: options.taskDataRevision ?? 0,
    noteDataRevision: options.noteDataRevision ?? 0,
    calendarDataRevision: options.calendarDataRevision ?? 0,
    activeColorTheme,
    activeColorThemeId: activeColorTheme.id,
    appearanceReady: options.appearanceReady,
    calendarAgendaEvents: calendarItems,
    calendarDayView,
    calendarEventsById: eventsById,
    calendarMonthWeeks,
    calendarSources: snapshot.calendars,
    calendarWeekDays,
    dataState: options.state,
    errorMessage: options.errorMessage,
    getSearchViewModel: () => idleSearchViewModel(),
    getScheduledTaskBlockById: (blockId) => scheduledTaskBlocksById[blockId] ?? null,
    getTaskById: (taskId) => taskById[taskId] ?? missingTask(taskId),
    getTaskFilterViewModel: (filterId) =>
      taskFilterViewModels.find((filter) => filter.id === filterId) ?? taskFilterViewModels[0],
    hasCachedData: hasSnapshotData(snapshot),
    hydrationErrorMessage: options.hydrationErrorMessage,
    hydrationState: options.hydrationState,
    initialNotes: notes,
    noteLists,
    tags: snapshot.tags,
    ensureCalendarRange: options.ensureCalendarRange,
    isOffline: options.state === "offline" || snapshot.syncStatus.offline === true,
    isStale: options.state === "stale" || snapshot.syncStatus.stale === true,
    largeTaskWindow: lookupTasks,
    refresh: options.refresh,
    refreshGoogleStatus: options.refreshGoogleStatus,
    resourceCounts,
    setGoogleStatus: options.setGoogleStatus,
    settings: snapshot.settings,
    diagnosticsSummary: snapshot.diagnosticsSummary,
    googleStatus: snapshot.googleStatus,
    undoStatus: snapshot.undoStatus,
    native: snapshot.native,
    settingsMutationError: options.settingsMutation.error,
    settingsMutationPending: options.settingsMutation.pending,
    updateSettings: options.updateSettings,
    createTag: options.createTag,
    updateTag: options.updateTag,
    deleteTag: options.deleteTag,
    mergeTags: options.mergeTags,
    bulkApplyTags: options.bulkApplyTags,
    previewAutoTagReapply: options.previewAutoTagReapply,
    applyAutoTagReapply: options.applyAutoTagReapply,
    tagAnalytics: options.tagAnalytics,
    runRecoveryAction: options.runRecoveryAction,
    undo: options.undo,
    redo: options.redo,
    refreshUndoStatus: options.refreshUndoStatus,
    taskMutationError: options.taskMutation.error,
    taskMutationPending: options.taskMutation.pending,
    clearTaskMutationError: options.clearTaskMutationError,
    retryLastTaskMutation: options.retryLastTaskMutation,
    createTask: options.createTask,
    updateTask: options.updateTask,
    completeTask: options.completeTask,
    reopenTask: options.reopenTask,
    completeEvent: options.completeEvent,
    reopenEvent: options.reopenEvent,
    moveTask: options.moveTask,
    bulkRescheduleTasks: options.bulkRescheduleTasks,
    deleteTask: options.deleteTask,
    createTaskList: options.createTaskList,
    renameTaskList: options.renameTaskList,
    deleteTaskList: options.deleteTaskList,
    scheduleTaskBlock: options.scheduleTaskBlock,
    moveScheduledTaskBlock: options.moveScheduledTaskBlock,
    unscheduleTaskBlock: options.unscheduleTaskBlock,
    scheduledTaskBlocks,
    settingsSections: settingsSections(snapshot),
    syncStatus: snapshot.syncStatus,
    taskFilterViewModels,
    taskLists: snapshot.taskLists
  };
}

const projectionCache = new WeakMap<object, { references: unknown[]; value: ReturnType<typeof buildProjection> }>();

function cachedProjection(snapshot: CoreDataSnapshot, options: CoreViewModelSourceOptions) {
  const activeColorTheme = resolveEffectiveColorTheme(snapshot.settings, resolveEffectiveThemeMode(snapshot.settings, options.systemPrefersDark));
  const references = [snapshot.tasks, snapshot.calendarTasks, snapshot.taskLists, snapshot.events, snapshot.calendars,
    snapshot.scheduledTaskBlocks, snapshot.notes, snapshot.noteLists, snapshot.settings.defaultTimeZone,
    snapshot.settings.showCompletedInCalendarViews, JSON.stringify(snapshot.settings.selectedTaskListIds),
    JSON.stringify(snapshot.settings.calendarEventColorOverrides), JSON.stringify(activeColorTheme)];
  const cached = projectionCache.get(options.taskViewModelCache);
  if (cached && references.every((value, index) => value === cached.references[index])) return cached.value;
  const value = buildProjection(snapshot, options, activeColorTheme);
  projectionCache.set(options.taskViewModelCache, { references, value });
  return value;
}

function buildProjection(snapshot: CoreDataSnapshot, options: CoreViewModelSourceOptions, activeColorTheme: ReturnType<typeof resolveEffectiveColorTheme>) {
  const taskRecords = [...new Map([...snapshot.tasks, ...(snapshot.calendarTasks ?? [])].map((task) => [task.id, task])).values()];
  pruneViewModelCache(options.taskViewModelCache, taskRecords);
  pruneViewModelCache(options.calendarEventViewModelCache, snapshot.events);
  const taskListsById = Object.fromEntries(snapshot.taskLists.map((list) => [list.id, list]));
  const childTasksByParentId = groupChildTasks(taskRecords);
  const tasks = taskRecords.map((task) =>
    stableTaskViewModel(
      task,
      taskListsById[task.listId]?.title,
      childTasksByParentId.get(task.id) ?? [],
      options.taskViewModelCache
    )
  );
  const taskById = Object.fromEntries(tasks.map((task) => [task.id, task]));
  const calendarTitleById = Object.fromEntries(
    snapshot.calendars.map((calendar) => [calendar.id, calendar.title])
  );
  const calendarTimeZoneById = Object.fromEntries(
    snapshot.calendars.map((calendar) => [calendar.id, calendar.timeZone])
  );
  const calendarBackgroundColorById = Object.fromEntries(
    snapshot.calendars.map((calendar) => [calendar.id, calendar.backgroundColor ?? null])
  );
  const calendarForegroundColorById = Object.fromEntries(
    snapshot.calendars.map((calendar) => [calendar.id, calendar.foregroundColor ?? null])
  );
  const events = snapshot.events.flatMap((event) => {
    const linkedTask = event.linkedTaskId ? taskById[event.linkedTaskId] : undefined;

    if (event.linkedTaskId && !linkedTask) {
      return [];
    }

    if (event.linkedTaskId && linkedTask) {
      if (
        linkedTask.status !== "open" &&
        !(snapshot.settings.showCompletedInCalendarViews && linkedTask.status === "completed")
      ) {
        return [];
      }

      return [
        stableProjectedTaskCalendarEventViewModel(
          { ...event, linkedTaskId: event.linkedTaskId },
          linkedTask,
          snapshot.settings.defaultTimeZone,
          activeColorTheme,
          options.calendarEventViewModelCache
        )
      ];
    }

    if (!snapshot.settings.showCompletedInCalendarViews && event.completedAt) {
      return [];
    }

    return [
      stableCalendarEventViewModel(
        event,
        calendarTitleById[event.calendarId],
        calendarTimeZoneById[event.calendarId] ?? null,
        calendarBackgroundColorById[event.calendarId] ?? null,
        calendarForegroundColorById[event.calendarId] ?? null,
        snapshot.settings.calendarEventColorOverrides,
        activeColorTheme,
        snapshot.settings.defaultTimeZone,
        options.calendarEventViewModelCache
      )
    ];
  });
  const eventsById = Object.fromEntries(events.map((event) => [event.id, event]));
  const projectedTaskIds = new Set(events.flatMap((event) => event.taskId ? [event.taskId] : []));
  const scheduledEventIds = new Set(snapshot.scheduledTaskBlocks.map((block) => block.calendarEventId));
  const conflictTitlesByBlockId = scheduledTaskBlockConflicts(
    snapshot.scheduledTaskBlocks,
    events,
    scheduledEventIds
  );
  const baseScheduledTaskBlocks = snapshot.scheduledTaskBlocks.map((block) =>
    scheduledTaskBlockViewModel(
      block,
      calendarTitleById[block.calendarId],
      conflictTitlesByBlockId.get(block.id) ?? []
    )
  );
  const rootTasks = tasks.filter((task) => task.parentId === null);
  const openTasks = rootTasks.filter((task) => task.status === "open");
  const openDatedTasks = openTasks.filter((task) => task.dueDate !== null);
  const notes = snapshot.notes.map(noteViewModel);
  const noteLists = snapshot.noteLists;
  const completedTasks = rootTasks.filter((task) => task.status === "completed");
  const hiddenTasks = rootTasks.filter((task) => task.status === "hidden");
  const deletedTasks = rootTasks.filter((task) => task.status === "deleted");
  const selectedTaskListIds = new Set(
    snapshot.settings.selectedTaskListIds.length > 0
      ? snapshot.settings.selectedTaskListIds
      : snapshot.taskLists.map((taskList) => taskList.id)
  );
  const taskCalendarEvents = rootTasks
    .filter(taskHasDueDate)
    .filter((task) => !projectedTaskIds.has(task.id))
    .filter((task) => selectedTaskListIds.has(task.listId))
    .filter((task) =>
      task.status === "open" ||
      (snapshot.settings.showCompletedInCalendarViews && task.status === "completed")
    )
    .map((task) =>
      stableTaskCalendarEventViewModel(
        task,
        snapshot.settings.defaultTimeZone,
        activeColorTheme,
        options.calendarEventViewModelCache
      )
    );
  const calendarItems = [...events, ...taskCalendarEvents];
  const eventDayIndex = buildCalendarEventDayIndex(calendarItems);
  const scheduledTaskBlocks = baseScheduledTaskBlocks;
  const scheduledTaskBlocksById = Object.fromEntries(
    scheduledTaskBlocks.map((block) => [block.id, block])
  );
  const taskFilterViewModels = taskFilters(
    openDatedTasks,
    completedTasks,
    hiddenTasks,
    deletedTasks,
    snapshot.taskLists
  );
  return { activeColorTheme, eventsById, calendarItems, scheduledTaskBlocksById, taskById, taskFilterViewModels,
    notes, noteLists, scheduledTaskBlocks, lookupTasks: snapshot.tasks.map((task) => taskById[task.id]),
    calendarDayView: dayView(eventDayIndex, snapshot.settings.defaultTimeZone), calendarMonthWeeks: monthWeeks(eventDayIndex, snapshot.settings.defaultTimeZone), calendarWeekDays: weekDays(eventDayIndex, snapshot.settings.defaultTimeZone) };
}

function pruneViewModelCache<T extends { id: string }, V>(
  cache: Map<string, { signature: string; viewModel: V }>,
  records: readonly T[]
): void {
  if (cache.size === 0) {
    return;
  }

  const liveIds = new Set(records.map((record) => record.id));

  for (const id of cache.keys()) {
    if (!liveIds.has(id)) {
      cache.delete(id);
    }
  }
}

function taskHasDueDate(task: TaskViewModel): task is TaskViewModel & { dueDate: string } {
  return task.dueDate !== null;
}
