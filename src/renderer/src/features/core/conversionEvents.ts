import type { TaskDraft } from "./inspectors/TaskInspectorBody";
import type { CalendarEventDraft } from "./screens/calendar/types";

export type ConvertItemKind = "event" | "task" | "note";
export type ConvertSourceAction = "keep" | "replace";

export interface ConvertSourceCleanup {
  id: string;
  kind: ConvertItemKind;
}

export interface ConvertCommandDetail {
  cleanup?: ConvertSourceCleanup;
  target: ConvertItemKind;
  taskDraft?: Partial<Omit<TaskDraft, "mode">> | TaskDraft;
  noteDraft?: {
    body: string;
    id?: string;
    listId?: string;
    listTitle?: string;
    replaceSource?: boolean;
    tags?: string[];
    title: string;
  };
  eventDraft?: Partial<CalendarEventDraft>;
}

export function conversionCleanup(
  kind: ConvertItemKind,
  id: string,
  target: ConvertItemKind | "birthday",
  recurring = false
): ConvertSourceCleanup | null {
  const replace = window.confirm(
    `Convert this ${recurring ? "recurring event series" : kind} to a ${target}? The new item keeps its title and notes. The original ${recurring ? "series" : kind} will be removed only after the replacement saves successfully.`
  );

  return replace ? { id, kind } : null;
}

export function dispatchConvertCommand(detail: ConvertCommandDetail): void {
  window.dispatchEvent(new CustomEvent("hcb:convert-command", { detail }));
}
