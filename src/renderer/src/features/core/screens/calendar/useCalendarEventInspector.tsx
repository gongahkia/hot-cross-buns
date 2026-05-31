import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { CalendarEventUpdateRequest } from "@shared/ipc/contracts";
import { Pencil, Save, Trash2, X } from "lucide-react";
import { useInspector } from "../../../../components/Inspector";
import { Button } from "../../../../components/primitives";
import type { CoreViewModelSource } from "../../coreViewModelSource";
import type { CalendarEventViewModel } from "../../coreViewModels";
import {
  addUtcDaysIso,
  dateInputValue,
  defaultTaskListId,
  startOfUtcDayIso
} from "../../coreScreenShared";
import { CalendarEventDetails, CalendarEventForm } from "./CalendarEventForm";
import {
  calendarDraftRangeLabel,
  calendarEventDraftsEqual,
  calendarEventPayload,
  editCalendarDraft,
  newCalendarDraft
} from "./drafts";
import type { CalendarCreateMode, CalendarCreateSeed, CalendarEventDraft } from "./types";

interface CalendarCreateOptions {
  createMode?: CalendarCreateMode;
  draft?: Partial<CalendarEventDraft>;
  taskListId?: string;
}

export function useCalendarEventInspector(source: CoreViewModelSource): {
  calendarActionError: string | undefined;
  moveCalendarEvent: (eventId: string, startsAt: string, allDay: boolean) => void;
  openCreate: (seed?: CalendarCreateSeed, options?: CalendarCreateOptions) => void;
  openEdit: (event: CalendarEventViewModel) => void;
  resizeCalendarEvent: (eventId: string, endsAt: string) => void;
  setCalendarActionError: Dispatch<SetStateAction<string | undefined>>;
} {
  const {
    close: closeInspector,
    current: currentInspector,
    open: openInspector,
    update: updateInspector
  } = useInspector();
  const [draft, setDraftState] = useState<CalendarEventDraft | null>(null);
  const [createMode, setCreateModeState] = useState<CalendarCreateMode>("event");
  const [createTaskListId, setCreateTaskListIdState] = useState(() => defaultTaskListId(source));
  const [formError, setFormError] = useState<string | undefined>();
  const [calendarInspectorMode, setCalendarInspectorModeState] = useState<"view" | "edit">("edit");
  const [calendarActionError, setCalendarActionError] = useState<string | undefined>();
  const calendarDraftRef = useRef<CalendarEventDraft | null>(draft);
  const calendarDraftBaselineRef = useRef<CalendarEventDraft | null>(draft);
  const calendarInspectorDirtyRef = useRef(false);
  const calendarInspectorInstanceRef = useRef(0);
  const calendarInspectorModeRef = useRef<"view" | "edit">("edit");
  const createModeRef = useRef<CalendarCreateMode>("event");
  const createTaskListIdRef = useRef(createTaskListId);
  const setDraft = useCallback<Dispatch<SetStateAction<CalendarEventDraft | null>>>((next) => {
    setDraftState((current) => {
      const resolved =
        typeof next === "function"
          ? (next as (value: CalendarEventDraft | null) => CalendarEventDraft | null)(current)
          : next;

      calendarDraftRef.current = resolved;
      calendarInspectorDirtyRef.current = !calendarEventDraftsEqual(
        resolved,
        calendarDraftBaselineRef.current
      );

      return resolved;
    });
  }, []);

  function setCalendarInspectorMode(mode: "view" | "edit"): void {
    calendarInspectorModeRef.current = mode;
    setCalendarInspectorModeState(mode);
  }

  function applyCreateModeToDraft(nextDraft: CalendarEventDraft, mode: CalendarCreateMode): CalendarEventDraft {
    if (mode !== "birthday") {
      return nextDraft;
    }

    const startsAt = startOfUtcDayIso(nextDraft.startsAt);
    return {
      ...nextDraft,
      allDay: true,
      startsAt,
      endsAt: addUtcDaysIso(startsAt, 1),
      repeatFrequency: "yearly",
      repeatCustomFrequency: "yearly",
      repeatEndMode: "never",
      repeatCount: "",
      repeatEndsOn: "",
      repeatInterval: "1"
    };
  }

  function setCreateModeValue(mode: CalendarCreateMode): void {
    createModeRef.current = mode;
    setCreateModeState(mode);
  }

  function setCreateMode(mode: CalendarCreateMode): void {
    setCreateModeValue(mode);

    if (mode === "birthday") {
      setDraft((current) => {
        if (!current) {
          return current;
        }

        return applyCreateModeToDraft(current, mode);
      });
    }
  }

  function setCreateTaskListId(listId: string): void {
    createTaskListIdRef.current = listId;
    setCreateTaskListIdState(listId);
  }

  useEffect(() => {
    if (currentInspector?.kind !== "event" || !draft) {
      return;
    }

    const dirty =
      calendarInspectorMode === "edit" &&
      !calendarEventDraftsEqual(draft, calendarDraftBaselineRef.current);
    calendarInspectorDirtyRef.current = dirty;
    updateInspector({
      actions: eventInspectorActions(draft, calendarInspectorMode),
      body: eventInspectorBody(draft, calendarInspectorMode),
      dirty,
      subtitle: eventInspectorSubtitle(draft),
      title: eventInspectorTitle(draft)
    });
  }, [
    currentInspector?.kind,
    draft,
    formError,
    calendarInspectorMode,
    source.calendarSources,
    source.taskLists,
    createMode,
    createTaskListId,
    source.settings.defaultTimeZone,
    source.settings.calendarEventColorOverrides,
    updateInspector
  ]);

  useEffect(() => {
    if (createTaskListIdRef.current || source.taskLists.length === 0) {
      return;
    }

    setCreateTaskListId(defaultTaskListId(source));
  }, [source, source.taskLists]);

  function canReplaceEventInspector(): boolean {
    return (
      currentInspector?.kind !== "event" ||
      calendarInspectorModeRef.current !== "edit" ||
      !calendarInspectorDirtyRef.current
    );
  }

  function eventInspectorTitle(nextDraft: CalendarEventDraft): string {
    if (nextDraft.mode === "create") {
      if (createModeRef.current === "task") {
        return "New task";
      }

      if (createModeRef.current === "birthday") {
        return "New birthday";
      }
    }

    return nextDraft.mode === "edit" ? nextDraft.title || "Event" : "New event";
  }

  function eventInspectorSubtitle(nextDraft: CalendarEventDraft): string {
    const calendar = source.calendarSources.find((calendarSource) => calendarSource.id === nextDraft.calendarId);
    return `${calendar?.title ?? "Calendar"} · ${calendarDraftRangeLabel(nextDraft)}`;
  }

  function eventInspectorBody(
    nextDraft: CalendarEventDraft,
    mode = calendarInspectorModeRef.current
  ): ReactNode {
    if (nextDraft.mode === "edit" && mode === "view") {
      return (
        <CalendarEventDetails
          calendars={source.calendarSources}
          defaultTimeZone={source.settings.defaultTimeZone}
          draft={nextDraft}
          eventColorOverrides={source.settings.calendarEventColorOverrides}
          key={`view-${calendarInspectorInstanceRef.current}`}
        />
      );
    }

    return (
      <CalendarEventForm
        calendars={source.calendarSources}
        createMode={createModeRef.current}
        defaultTimeZone={source.settings.defaultTimeZone}
        draft={nextDraft}
        error={formError}
        eventColorOverrides={source.settings.calendarEventColorOverrides}
        key={calendarInspectorInstanceRef.current}
        onCreateModeChange={setCreateMode}
        setDraft={(next) => setDraft(next)}
        setTaskListId={setCreateTaskListId}
        taskListId={createTaskListId}
        taskLists={source.taskLists}
      />
    );
  }

  function eventInspectorActions(
    nextDraft: CalendarEventDraft,
    mode = calendarInspectorModeRef.current
  ): ReactNode {
    if (nextDraft.mode === "edit" && mode === "view") {
      return (
        <div className="flex w-full items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button onClick={() => void deleteDraft()} size="sm" variant="danger">
              <Trash2 aria-hidden="true" size={14} />
              Delete event
            </Button>
            <Button onClick={() => setCalendarInspectorMode("edit")} size="sm" variant="secondary">
              <Pencil aria-hidden="true" size={14} />
              Edit
            </Button>
          </div>
          <Button onClick={() => void cancelEventInspector()} size="sm" variant="ghost">
            <X aria-hidden="true" size={14} />
            Close
          </Button>
        </div>
      );
    }

    return (
      <>
        {nextDraft.mode === "edit" ? (
          <Button onClick={() => void deleteDraft()} size="sm" variant="danger">
            <Trash2 aria-hidden="true" size={14} />
            Delete event
          </Button>
        ) : null}
        <Button onClick={() => void cancelEventInspector()} size="sm" variant="ghost">
          <X aria-hidden="true" size={14} />
          Cancel
        </Button>
        <Button onClick={() => void saveDraft()} size="sm" variant="primary">
          <Save aria-hidden="true" size={14} />
          Save
        </Button>
      </>
    );
  }

  function openEventInspector(
    nextDraft: CalendarEventDraft,
    mode: "view" | "edit" = nextDraft.mode === "edit" ? "view" : "edit"
  ): void {
    calendarInspectorInstanceRef.current += 1;
    calendarDraftBaselineRef.current = nextDraft;
    calendarDraftRef.current = nextDraft;
    calendarInspectorDirtyRef.current = false;
    setCalendarInspectorMode(mode);
    setFormError(undefined);
    setDraft(nextDraft);
    openInspector({
      actions: eventInspectorActions(nextDraft, mode),
      body: eventInspectorBody(nextDraft, mode),
      dirty: false,
      id: nextDraft.id ?? "new",
      kind: "event",
      onConfirmClose: () =>
        calendarInspectorModeRef.current !== "edit" || !calendarInspectorDirtyRef.current,
      subtitle: eventInspectorSubtitle(nextDraft),
      title: eventInspectorTitle(nextDraft)
    });
  }

  function openCreate(seed?: CalendarCreateSeed, options: CalendarCreateOptions = {}): void {
    if (!canReplaceEventInspector()) {
      return;
    }

    const nextMode = options.createMode ?? "event";
    const nextDraft = applyCreateModeToDraft({
      ...newCalendarDraft(source, seed),
      ...options.draft,
      mode: "create"
    }, nextMode);

    setCreateModeValue(nextMode);
    setCreateTaskListId(options.taskListId ?? defaultTaskListId(source));
    openEventInspector(nextDraft, "edit");
  }

  function openEdit(event: CalendarEventViewModel): void {
    if (!canReplaceEventInspector()) {
      return;
    }

    setCreateMode("event");
    openEventInspector(editCalendarDraft(event), "view");
  }

  async function closeEventInspectorAfterMutation(): Promise<void> {
    calendarDraftBaselineRef.current = null;
    calendarDraftRef.current = null;
    calendarInspectorDirtyRef.current = false;
    setCalendarInspectorMode("edit");
    setDraft(null);
    setCreateMode("event");
    setFormError(undefined);
    await closeInspector();
    source.refresh();
  }

  async function saveDraft(): Promise<void> {
    const currentDraft = calendarDraftRef.current;

    if (!currentDraft) {
      return;
    }

    const payload = calendarEventPayload(currentDraft);

    if (!payload.title) {
      setFormError("Title is required.");
      return;
    }

    if (currentDraft.mode === "create" && createModeRef.current === "task") {
      const listId = createTaskListIdRef.current || defaultTaskListId(source);

      if (!listId) {
        setFormError("Choose a task list.");
        return;
      }

      const saved = await source.createTask({
        title: payload.title,
        notes: currentDraft.notes,
        dueDate: dateInputValue(currentDraft.startsAt),
        listId,
        parentId: null,
        priority: "none",
        plannedStart: null,
        plannedEnd: null,
        durationMinutes: null,
        lockedSchedule: false,
        tags: []
      });

      if (!saved) {
        setFormError(source.taskMutationError ?? "Task write failed.");
        return;
      }

      await closeEventInspectorAfterMutation();
      return;
    }

    if (!payload.calendarId) {
      setFormError("Choose a calendar.");
      return;
    }

    const writePayload =
      currentDraft.mode === "create" && createModeRef.current === "birthday"
        ? {
            ...payload,
            allDay: true,
            startsAt: startOfUtcDayIso(currentDraft.startsAt),
            endsAt: addUtcDaysIso(startOfUtcDayIso(currentDraft.startsAt), 1),
            recurrence: {
              frequency: "yearly" as const,
              interval: 1,
              endsOn: null,
              count: null
            }
          }
        : payload;

    const result =
      currentDraft.mode === "create"
        ? await window.hcb?.calendar.create(writePayload)
        : await window.hcb?.calendar.update({
            id: currentDraft.id ?? "",
            ...writePayload
          } satisfies CalendarEventUpdateRequest);

    if (!result?.ok) {
      setFormError(result?.error.message ?? "Calendar event write failed.");
      return;
    }

    await closeEventInspectorAfterMutation();
  }

  async function deleteDraft(): Promise<void> {
    const currentDraft = calendarDraftRef.current;

    if (!currentDraft?.id) {
      return;
    }

    const result = await window.hcb?.calendar.delete({ id: currentDraft.id });

    if (!result?.ok) {
      setFormError(result?.error.message ?? "Calendar event delete failed.");
      return;
    }

    await closeEventInspectorAfterMutation();
  }

  async function cancelEventInspector(): Promise<void> {
    calendarDraftBaselineRef.current = null;
    calendarDraftRef.current = null;
    calendarInspectorDirtyRef.current = false;
    setCalendarInspectorMode("edit");
    setDraft(null);
    setCreateMode("event");
    setFormError(undefined);
    await closeInspector();
  }

  async function updateCalendarEventTime(
    request: Pick<CalendarEventUpdateRequest, "id" | "startsAt" | "endsAt" | "allDay">
  ): Promise<void> {
    const result = await window.hcb?.calendar.update(request);

    if (!result?.ok) {
      setCalendarActionError(result?.error.message ?? "Calendar event update failed.");
      return;
    }

    setCalendarActionError(undefined);
    source.refresh();
  }

  function moveCalendarEvent(eventId: string, startsAt: string, allDay: boolean): void {
    const event = source.calendarEventsById[eventId];

    if (!event) {
      return;
    }

    const durationMs = Math.max(5 * 60 * 1000, Date.parse(event.endsAt) - Date.parse(event.startsAt));
    const endsAt = allDay
      ? addUtcDaysIso(startsAt, Math.max(1, Math.round(durationMs / (24 * 60 * 60 * 1000))))
      : new Date(Date.parse(startsAt) + durationMs).toISOString();

    void updateCalendarEventTime({
      id: event.id,
      startsAt,
      endsAt,
      allDay
    });
  }

  function resizeCalendarEvent(eventId: string, endsAt: string): void {
    const event = source.calendarEventsById[eventId];

    if (!event || Date.parse(endsAt) <= Date.parse(event.startsAt)) {
      return;
    }

    void updateCalendarEventTime({
      id: event.id,
      endsAt
    });
  }

  return {
    calendarActionError,
    moveCalendarEvent,
    openCreate,
    openEdit,
    resizeCalendarEvent,
    setCalendarActionError
  };
}
