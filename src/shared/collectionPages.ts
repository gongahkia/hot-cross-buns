import type { TaskSummary } from "./ipc/contracts";

export interface CollectionPage<T> {
  items: T[];
  page: { limit: number; totalKnown: number; nextCursor?: string };
}

export type TaskBoardSort = "myOrder" | "date" | "deadline" | "starred" | "title";
export interface TaskBoardRequest {
  listId?: string;
  locateTaskId?: string;
  starred?: boolean;
  sort?: TaskBoardSort;
  completedOpen?: boolean;
  collapsedTaskIds?: string[];
  cursor?: string;
  limit?: number;
}
export type TaskBoardRow = { kind: "task" | "child"; task: TaskSummary } | { kind: "completed"; count: number };
export interface TaskBoardPage extends CollectionPage<TaskBoardRow> { rootCount: number; completedRootCount: number; locatedIndex?: number | null; revealParentId?: string; revealCompleted?: boolean }
