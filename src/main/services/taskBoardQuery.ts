import type Database from "better-sqlite3";
import type { TaskBoardPage, TaskBoardRequest, TaskBoardRow } from "@shared/collectionPages";
import type { TaskSummary } from "@shared/ipc/contracts";

type RecordValue = Record<string, any>;

/** Page a flattened tree in SQLite; neither bodies nor offscreen rows cross IPC. */
export function taskBoardPage(db: Database.Database, input: TaskBoardRequest, settings: RecordValue, mapTask: (row: RecordValue) => TaskSummary): TaskBoardPage {
  const limit = Math.max(1, Math.min(200, Math.floor(Number(input.limit)) || 100));
  const parsedOffset = Number(input.cursor ?? 0);
  const offset = Number.isSafeInteger(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;
  const parameters = {
    listId: input.listId ?? null,
    starred: input.starred ? 1 : 0,
    stars: JSON.stringify(settings.starredTaskIds ?? []),
    starTimes: JSON.stringify(settings.starredTaskAt ?? {}),
    collapsed: JSON.stringify(input.collapsedTaskIds ?? [])
  };
  const roots = `WITH roots AS (
    SELECT id,status,sort_order,due_at,title,updated_at,created_at FROM tasks
    WHERE parent_id IS NULL AND status IN ('active','completed') AND (@listId IS NULL OR list_id=@listId)
      AND (@starred=0 OR (status='active' AND id IN (SELECT value FROM json_each(@stars))))
  )`;
  const counts = db.prepare(`${roots} SELECT root.status,COUNT(*) AS roots,
    SUM(1 + CASE WHEN root.id IN (SELECT value FROM json_each(@collapsed)) THEN 0 ELSE
      (SELECT COUNT(*) FROM tasks child WHERE child.parent_id=root.id AND child.status IN ('active','completed')) END) AS rows
    FROM roots root GROUP BY root.status`).all(parameters) as Array<{ status: string; roots: number; rows: number }>;
  const active = counts.find((count) => count.status === "active");
  const completed = counts.find((count) => count.status === "completed");
  const activeRows = active?.rows ?? 0;
  const completedRoots = completed?.roots ?? 0;
  const headerRows = completedRoots ? 1 : 0;
  const total = activeRows + headerRows + (input.completedOpen ? completed?.rows ?? 0 : 0);
  const items: TaskBoardRow[] = [];
  const orders = {
    myOrder: "root.sort_order IS NULL,root.sort_order,root.created_at,root.id",
    date: "root.updated_at DESC,root.id",
    deadline: "root.due_at IS NULL,root.due_at,root.id",
    starred: "COALESCE((SELECT CAST(value AS REAL) FROM json_each(@starTimes) WHERE key=root.id),0) DESC,root.id",
    title: "root.title COLLATE NOCASE,root.id"
  };
  const read = (status: string, pageOffset: number, pageLimit: number): void => {
    if (pageLimit <= 0) return;
    const rows = db.prepare(`${roots}, tree AS (
      SELECT id,id AS rootId,0 AS depth FROM roots WHERE status=@status
      UNION ALL
      SELECT child.id,root.id,1 FROM roots root JOIN tasks child ON child.parent_id=root.id
      WHERE root.status=@status AND child.status IN ('active','completed') AND root.id NOT IN (SELECT value FROM json_each(@collapsed))
    )
    SELECT task.id,list.account_id AS accountId,task.list_id AS listId,task.title,substr(task.notes,1,240) AS notes,
      task.status,task.priority,task.due_at AS dueAt,task.parent_id AS parentId,task.planned_start AS plannedStart,
      task.planned_end AS plannedEnd,task.duration_minutes AS durationMinutes,task.locked_schedule AS lockedSchedule,
      task.snooze_until AS snoozeUntil,task.tags_json AS tags,task.sort_order AS sortOrder,task.updated_at AS updatedAt,
      (SELECT COUNT(*) FROM tasks child WHERE child.parent_id=task.id AND child.status IN ('active','completed')) AS subtaskCount,
      (SELECT COUNT(*) FROM tasks child WHERE child.parent_id=task.id AND child.status='completed') AS completedSubtaskCount,
      tree.depth
    FROM tree JOIN tasks task ON task.id=tree.id JOIN roots root ON root.id=tree.rootId JOIN task_lists list ON list.id=task.list_id
    ORDER BY ${status === "completed" ? orders.date : orders[input.sort ?? "myOrder"] ?? orders.myOrder},tree.depth,task.sort_order IS NULL,task.sort_order,task.created_at,task.id
    LIMIT @limit OFFSET @offset`).all({ ...parameters, status, limit: pageLimit, offset: pageOffset }) as RecordValue[];
    items.push(...rows.map((row): TaskBoardRow => ({ kind: row.depth ? "child" : "task", task: { ...mapTask(row), subtaskCount: row.subtaskCount, completedSubtaskCount: row.completedSubtaskCount } })));
  };
  if (offset < activeRows) read("active", offset, Math.min(limit, activeRows - offset));
  if (headerRows && offset <= activeRows && offset + limit > activeRows) items.push({ kind: "completed", count: completedRoots });
  if (input.completedOpen && items.length < limit) read("completed", Math.max(0, offset - activeRows - headerRows), limit - items.length);
  return { items, rootCount: active?.roots ?? 0, completedRootCount: completedRoots, page: { limit, totalKnown: total, ...(offset + limit < total ? { nextCursor: String(offset + limit) } : {}) } };
}
