import type { NoteViewModel } from "../coreViewModels";

export type NoteListSelection = `list:${string}`;
export type NoteBoardSelection = "all" | "starred" | NoteListSelection;

export interface NoteViewColumn {
  description: string;
  emptyDescription: string;
  emptyTitle: string;
  id: NoteBoardSelection;
  listId?: string;
  notes: NoteViewModel[];
  title: string;
}
