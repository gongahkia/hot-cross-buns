import type { NoteDetail, NoteSummary } from "@shared/ipc/contracts";
import type { NoteViewModel } from "../coreViewModels";
import { shortDateTime } from "./dateFormat";
import { buildNotePreview } from "../notesParsing";

export function noteViewModel(note: NoteDetail | NoteSummary): NoteViewModel {
  const body = "body" in note ? note.body : note.preview ?? "";

  return {
    id: note.id,
    listId: note.listId,
    listTitle: note.listTitle,
    title: note.title,
    body,
    preview: buildNotePreview(body),
    tags: note.tags ?? [],
    updatedLabel: shortDateTime(note.updatedAt)
  };
}
