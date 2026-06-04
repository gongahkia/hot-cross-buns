import type { CalendarEventSummary, NoteListSummary, TaskSummary } from "@shared/ipc/contracts";
import type { CalendarEventViewModel, NoteViewModel, TaskViewModel } from "../coreViewModels";
import {
  buildCalendarEventDayIndex,
  compareTimelineRows,
  dayView,
  eventsForDate,
  monthWeeks,
  nextUpTimelineItem,
  scheduledTaskBlockConflicts,
  scheduledTaskBlockViewModel,
  stableCalendarEventViewModel,
  stableProjectedTaskCalendarEventViewModel,
  stableTaskCalendarEventViewModel,
  weekDays
} from "./calendarViewModels";
import { dayKey, shortDateTime, startOfUtcDay, syncLabel, timeLabel } from "./dateFormat";
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
  pruneViewModelCache(options.taskViewModelCache, snapshot.tasks);
  pruneViewModelCache(options.calendarEventViewModelCache, snapshot.events);
  const taskListsById = Object.fromEntries(snapshot.taskLists.map((list) => [list.id, list]));
  const childTasksByParentId = groupChildTasks(snapshot.tasks);
  const tasks = snapshot.tasks.map((task) =>
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
          options.calendarEventViewModelCache
        )
      ];
    }

    return [
      stableCalendarEventViewModel(
        event,
        calendarTitleById[event.calendarId],
        calendarTimeZoneById[event.calendarId] ?? null,
        calendarBackgroundColorById[event.calendarId] ?? null,
        calendarForegroundColorById[event.calendarId] ?? null,
        snapshot.settings.calendarEventColorOverrides,
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
  const scheduledTaskIds = new Set(baseScheduledTaskBlocks.map((block) => block.taskId));
  const rootTasks = tasks.filter((task) => task.parentId === null);
  const openTasks = rootTasks.filter((task) => task.status === "open");
  const openDatedTasks = openTasks.filter((task) => task.dueDate !== null);
  const openUndatedTasks = openTasks.filter((task) => task.dueDate === null);
  const notes = openUndatedTasks.map((task) => taskBackedNoteViewModel(task));
  const noteLists = taskBackedNoteLists(snapshot.taskLists, notes);
  const unscheduledOpenTasks = openDatedTasks.filter((task) => !scheduledTaskIds.has(task.id));
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
        options.calendarEventViewModelCache
      )
    );
  const calendarItems = [...events, ...taskCalendarEvents];
  const eventDayIndex = buildCalendarEventDayIndex(calendarItems);
  const now = new Date();
  const today = startOfUtcDay(now);
  const todayKey = dayKey(today);
  const todayEvents = eventsForDate(eventDayIndex, today).filter(
    (event) => !scheduledEventIds.has(event.eventId) && !scheduledEventIds.has(event.id)
  );
  const baseTodayScheduledBlocks = baseScheduledTaskBlocks
    .filter((block) => block.startsAt.slice(0, 10) === todayKey)
    .sort(
      (left, right) =>
        left.startsAt.localeCompare(right.startsAt) ||
        left.endsAt.localeCompare(right.endsAt) ||
        left.id.localeCompare(right.id)
    );
  const nextUp = nextUpTimelineItem(todayEvents, baseTodayScheduledBlocks, now);
  const scheduledTaskBlocks = baseScheduledTaskBlocks.map((block) => ({
    ...block,
    isNextUp: nextUp?.kind === "scheduledTaskBlock" && nextUp.itemId === block.id
  }));
  const scheduledTaskBlocksById = Object.fromEntries(
    scheduledTaskBlocks.map((block) => [block.id, block])
  );
  const todayScheduledBlocks = scheduledTaskBlocks
    .filter((block) => block.startsAt.slice(0, 10) === todayKey)
    .sort(
      (left, right) =>
        left.startsAt.localeCompare(right.startsAt) ||
        left.endsAt.localeCompare(right.endsAt) ||
        left.id.localeCompare(right.id)
    );
  const taskFilterViewModels = taskFilters(
    openDatedTasks,
    completedTasks,
    hiddenTasks,
    deletedTasks,
    snapshot.taskLists
  );
  const resourceCounts = {
    calendarEvents: snapshot.diagnosticsSummary?.cache.eventCount ?? snapshot.resourceCounts.calendarEvents,
    notes: snapshot.diagnosticsSummary?.cache.noteCount ?? snapshot.resourceCounts.notes,
    tasks: snapshot.diagnosticsSummary?.cache.taskCount ?? snapshot.resourceCounts.tasks
  };
  const todayTimedRows = [
    ...todayEvents.map((event) => ({
      kind: "event" as const,
      itemId: event.id,
      startsAt: event.startsAt,
      endsAt: event.endsAt
    })),
    ...todayScheduledBlocks.map((block) => ({
      kind: "scheduledTaskBlock" as const,
      itemId: block.id,
      startsAt: block.startsAt,
      endsAt: block.endsAt
    }))
  ].sort(compareTimelineRows);
  const todayTimelineRows = [
    ...todayTimedRows.slice(0, 10).map(({ kind, itemId }) => ({ kind, itemId })),
    ...unscheduledOpenTasks.slice(0, 5).map((task) => ({ kind: "task" as const, itemId: task.id }))
  ].slice(0, 15);
  const conflictCount = scheduledTaskBlocks.filter((block) => block.conflictCount > 0).length;

  return {
    appearanceReady: options.appearanceReady,
    calendarAgendaEvents: calendarItems,
    calendarDayView: dayView(eventDayIndex),
    calendarEventsById: eventsById,
    calendarMonthWeeks: monthWeeks(eventDayIndex),
    calendarSources: snapshot.calendars,
    calendarWeekDays: weekDays(eventDayIndex),
    dataState: options.state,
    errorMessage: options.errorMessage,
    getSearchViewModel: () => idleSearchViewModel(),
    getScheduledTaskBlockById: (blockId) => scheduledTaskBlocksById[blockId] ?? null,
    getTaskById: (taskId) => taskById[taskId] ?? missingTask(taskId),
    getTaskFilterViewModel: (filterId) =>
      taskFilterViewModels.find((filter) => filter.id === filterId) ?? taskFilterViewModels[0],
    hasCachedData: hasSnapshotData(snapshot),
    initialNotes: notes,
    noteLists,
    ensureCalendarRange: options.ensureCalendarRange,
    isOffline: options.state === "offline" || snapshot.syncStatus.offline === true,
    isStale: options.state === "stale" || snapshot.syncStatus.stale === true,
    largeTaskWindow: tasks,
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
    moveTask: options.moveTask,
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
    taskLists: snapshot.taskLists,
    todayViewModel: {
      metrics: [
        { id: "open", label: "Open tasks", value: String(openDatedTasks.length) },
        { id: "scheduled", label: "Scheduled", value: String(scheduledTaskBlocks.length) },
        { id: "conflicts", label: "Conflicts", value: String(conflictCount) },
        { id: "events", label: "Events", value: String(events.length) },
        { id: "sync", label: "Sync", value: syncLabel(snapshot.syncStatus) }
      ],
      focusTasks: unscheduledOpenTasks.slice(0, 6),
      currentTimeLabel: timeLabel(now.toISOString(), snapshot.settings.defaultTimeZone),
      conflictCount,
      schedule: snapshot.scheduleSuggestion,
      nextUp,
      timelineRows: todayTimelineRows
    }
  };
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

function taskBackedNoteViewModel(task: TaskViewModel): NoteViewModel {
  const body = task.detail.trim();

  return {
    id: task.id,
    listId: task.listId,
    listTitle: task.list,
    title: task.title,
    body,
    preview: body.length > 0 ? body : "Empty task note",
    updatedLabel: task.updatedAt ? shortDateTime(task.updatedAt) : "Unknown"
  };
}

function taskBackedNoteLists(
  taskLists: CoreDataSnapshot["taskLists"],
  notes: NoteViewModel[]
): NoteListSummary[] {
  const noteCountsByList = new Map<string, number>();

  for (const note of notes) {
    noteCountsByList.set(note.listId, (noteCountsByList.get(note.listId) ?? 0) + 1);
  }

  return taskLists.map((list) => ({
    id: list.id,
    title: list.title,
    updatedAt: list.updatedAt,
    noteCount: noteCountsByList.get(list.id) ?? 0
  }));
}
