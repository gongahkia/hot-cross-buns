import type { TaskDraft } from "./TaskInspectorBody";

export function canSaveTaskDraft(draft: TaskDraft, mutationPending: boolean): boolean {
  return draft.title.trim().length > 0 && draft.listId.length > 0 && !mutationPending;
}
