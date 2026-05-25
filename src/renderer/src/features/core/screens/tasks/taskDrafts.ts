import type { TaskCreateRequest, TaskUpdateRequest } from "@shared/ipc/contracts";
import type { useCoreViewModelSource } from "../../coreViewModelSource";
import type { TaskViewModel } from "../../coreViewModels";
import type { TaskDraft } from "../../inspectors/TaskInspectorBody";

type CoreViewModelSource = ReturnType<typeof useCoreViewModelSource>;

export function defaultTaskListId(source: CoreViewModelSource): string {
  return source.taskLists[0]?.id ?? "";
}

export function newTaskDraft(
  source: CoreViewModelSource,
  seed: Partial<Omit<TaskDraft, "mode">> = {}
): TaskDraft {
  return {
    mode: "create",
    title: seed.title ?? "",
    notes: seed.notes ?? "",
    dueDate: seed.dueDate ?? "",
    listId: seed.listId ?? defaultTaskListId(source),
    parentId: seed.parentId ?? "",
    priority: seed.priority ?? "none"
  };
}

export function editTaskDraft(task: TaskViewModel): TaskDraft {
  return {
    mode: "edit",
    id: task.id,
    title: task.title,
    notes: task.detail === "Task cached locally" ? "" : task.detail,
    dueDate: task.dueDate ?? "",
    listId: task.listId,
    parentId: task.parentId ?? "",
    priority: task.priority
  };
}

export function taskCreatePayload(draft: TaskDraft): TaskCreateRequest {
  return {
    title: draft.title.trim(),
    notes: draft.notes.trim(),
    dueDate: draft.dueDate || null,
    listId: draft.listId,
    parentId: draft.parentId || null,
    priority: draft.priority
  };
}

export function taskUpdatePayload(draft: TaskDraft): TaskUpdateRequest {
  return {
    id: draft.id ?? "",
    title: draft.title.trim(),
    notes: draft.notes.trim(),
    dueDate: draft.dueDate || null,
    listId: draft.listId,
    parentId: draft.parentId || null,
    priority: draft.priority
  };
}

export function taskParentOptions(tasks: TaskViewModel[], draft: TaskDraft): TaskViewModel[] {
  return tasks.filter(
    (task) => task.id !== draft.id && task.parentId === null && task.status !== "deleted"
  );
}

export function canSaveTaskDraft(draft: TaskDraft, mutationPending: boolean): boolean {
  return draft.title.trim().length > 0 && draft.listId.length > 0 && !mutationPending;
}

export function taskInspectorTitle(draft: TaskDraft): string {
  return draft.mode === "edit" ? draft.title || "Task" : "New task";
}
