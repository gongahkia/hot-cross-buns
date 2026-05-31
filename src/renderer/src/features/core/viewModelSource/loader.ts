import type { SettingsSnapshot } from "@shared/ipc/contracts";
import { dateOnlyFromLocalDate, visibleCalendarRange } from "./dateFormat";
import { emptyGoogleStatus } from "./defaults";
import { unwrap } from "./result";
import { uniqueTasks } from "./taskViewModels";
import type { CoreDataSnapshot } from "./types";

function knownTotal(pageTotal: number | undefined, itemCount: number): number {
  return pageTotal ?? itemCount;
}

export async function loadCoreData(settingsPromise?: Promise<SettingsSnapshot>): Promise<CoreDataSnapshot> {
  if (!window.hcb) {
    throw new Error("Preload bridge is unavailable.");
  }

  const range = visibleCalendarRange();
  const settingsLoad =
    settingsPromise ?? window.hcb.settings.get().then((result) => unwrap(result, "Settings failed"));
  const [
    taskLists,
    tasks,
    hiddenTasks,
    deletedTasks,
    calendars,
    events,
    scheduledTaskBlocks,
    notes,
    settings,
    syncStatus,
    native
  ] = await Promise.all([
    window.hcb.tasks.listTaskLists({ limit: 100 }).then((result) => unwrap(result, "Task lists failed")),
    window.hcb.tasks.list({ status: "all", limit: 100 }).then((result) => unwrap(result, "Tasks failed")),
    window.hcb.tasks
      .list({ status: "hidden", limit: 100 })
      .then((result) => unwrap(result, "Hidden tasks failed")),
    window.hcb.tasks
      .list({ status: "deleted", limit: 100 })
      .then((result) => unwrap(result, "Deleted tasks failed")),
    window.hcb.calendar
      .listCalendars({ limit: 100 })
      .then((result) => unwrap(result, "Calendars failed")),
    window.hcb.calendar
      .listEvents({ start: range.start, end: range.end, limit: 250 })
      .then((result) => unwrap(result, "Calendar events failed")),
    window.hcb.calendar
      .listScheduledTaskBlocks({ start: range.start, end: range.end, limit: 250 })
      .then((result) => unwrap(result, "Scheduled task blocks failed")),
    window.hcb.notes.list({ limit: 50 }).then((result) => unwrap(result, "Notes failed")),
    settingsLoad,
    window.hcb.sync.status().then((result) => unwrap(result, "Sync status failed")),
    window.hcb.native.capabilities().then((result) => unwrap(result, "Native status failed"))
  ]);
  const scheduleDate = dateOnlyFromLocalDate(new Date());
  const scheduleSuggestion = await window.hcb.calendar
    .scheduleSuggest({
      date: scheduleDate,
      capacityMinutes: settings.todayCapacityMinutes,
      workingHours: {
        start: settings.todayWorkingHoursStart,
        end: settings.todayWorkingHoursEnd
      }
    })
    .then((result) => unwrap(result, "Schedule suggestion failed"));

  return {
    taskLists: taskLists.items,
    tasks: uniqueTasks([...tasks.items, ...hiddenTasks.items, ...deletedTasks.items]),
    calendars: calendars.items,
    events: events.items,
    scheduledTaskBlocks: scheduledTaskBlocks.items,
    scheduleSuggestion,
    notes: notes.items,
    noteLists: notes.lists,
    settings,
    syncStatus,
    googleStatus: emptyGoogleStatus,
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
}
