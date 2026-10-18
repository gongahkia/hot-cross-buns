import type { CalendarEventSummary, TaskSummary } from "./ipc/contracts";

export interface NativePlanningCounts {
  dayStart: string;
  overdueTasks: number;
  todayTasks: number;
  tomorrowTasks: number;
  todayEvents: number;
  tomorrowEvents: number;
  todayEventsComplete: boolean;
}

export interface NativePlanningData {
  tasks: TaskSummary[];
  notificationTasks: TaskSummary[];
  events: CalendarEventSummary[];
  counts: NativePlanningCounts;
}
