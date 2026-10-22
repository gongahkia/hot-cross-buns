import { InspectorItemToolbar, copyInspectorText, type InspectorEntryKind } from "../../../../components/Inspector/InspectorItemToolbar";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { CalendarEventCompletionScope, CalendarEventUpdateRequest } from "@shared/ipc/contracts";
import { useInspector } from "../../../../components/Inspector";
import { Button } from "../../../../components/primitives";
import {
  conversionCleanup,
  dispatchConvertCommand,
  type ConvertSourceCleanup
} from "../../conversionEvents";
import { copiedTitle } from "../../copyLabels";
import type { CoreViewModelSource } from "../../coreViewModelSource";
import type { CalendarEventViewModel } from "../../coreViewModels";
import {
  addUtcDaysIso,
  dateInputValue,
  defaultTaskListId,
  startOfUtcDayIso
} from "../../coreScreenShared";
import { CalendarRecurrenceDialog } from "./CalendarRecurrenceDialog";
import type { CalendarEventRange } from "./calendarGesture";
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
  cleanup?: ConvertSourceCleanup;
  createMode?: CalendarCreateMode;
  draft?: Partial<CalendarEventDraft>;
  taskListId?: string;
}

export function useCalendarEventInspector(source: CoreViewModelSource): {
  calendarActionError: string | undefined;
  changeCalendarEventTime: (event: CalendarEventViewModel, range: CalendarEventRange) => void;
  interactionDialog: ReactNode;
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
  const ownerId = useRef(`event-inspector-${Math.random().toString(36).slice(2)}`);
  const [draft, setDraftState] = useState<CalendarEventDraft | null>(null);
  const [createMode, setCreateModeState] = useState<CalendarCreateMode>("event");
  const [createTaskListId, setCreateTaskListIdState] = useState(() => defaultTaskListId(source));
  const [formError, setFormError] = useState<string | undefined>();
  const [calendarInspectorMode, setCalendarInspectorModeState] = useState<"view" | "edit">("edit");
  const [calendarActionError, setCalendarActionError] = useState<string | undefined>();
  const [timeChange, setTimeChange] = useState<{ event: CalendarEventViewModel; range: CalendarEventRange } | null>(null);
  const timeWritePending = useRef(false);
  const [recurrenceOperation, setRecurrenceOperation] = useState<"delete" | "save" | null>(null);
  const calendarDraftRef = useRef<CalendarEventDraft | null>(draft);
  const calendarDraftBaselineRef = useRef<CalendarEventDraft | null>(draft);
  const calendarInspectorDirtyRef = useRef(false);
  const calendarInspectorInstanceRef = useRef(0);
  const calendarInspectorModeRef = useRef<"view" | "edit">("edit");
  const createModeRef = useRef<CalendarCreateMode>("event");
  const createTaskListIdRef = useRef(createTaskListId);
  const readGeneration = useRef(0);
  const saveInFlight = useRef(false);
  const savePromiseRef = useRef<Promise<boolean> | null>(null);
  const saveScopeRef = useRef<CalendarEventCompletionScope | undefined>(undefined);
  const recurrencePromptRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const conversionCleanupRef = useRef<ConvertSourceCleanup | null>(null);
  const setDraft = useCallback<Dispatch<SetStateAction<CalendarEventDraft | null>>>((next) => {
    const current = calendarDraftRef.current;
    const resolved = typeof next === "function" ? next(current) : next;
    calendarDraftRef.current = resolved;
    calendarInspectorDirtyRef.current = !calendarEventDraftsEqual(resolved, calendarDraftBaselineRef.current);
    setDraftState(resolved);
  }, []);

  function setCalendarInspectorMode(mode: "view" | "edit"): void {
    calendarInspectorModeRef.current = mode;
    setCalendarInspectorModeState(mode);
  }

  function applyCreateModeToDraft(nextDraft: CalendarEventDraft, mode: CalendarCreateMode): CalendarEventDraft {
    if (mode !== "birthday") {
      return { ...nextDraft, hcbKind: undefined };
    }

    const startsAt = startOfUtcDayIso(nextDraft.startsAt);
    return {
      ...nextDraft,
      hcbKind: "birthday",
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

    setDraft((current) => current ? applyCreateModeToDraft(current, mode) : current);
  }

  function setCreateTaskListId(listId: string): void {
    createTaskListIdRef.current = listId;
    setCreateTaskListIdState(listId);
  }

  useEffect(() => {
    if (currentInspector?.kind !== "event" || currentInspector.ownerId !== ownerId.current || !draft) {
      return;
    }

    const dirty =
      calendarInspectorMode === "edit" &&
      !calendarEventDraftsEqual(draft, calendarDraftBaselineRef.current);
    calendarInspectorDirtyRef.current = dirty;
    updateInspector({
      actions: null,
      toolbar: eventInspectorToolbar(draft),
      onSave: saveDraft,
      saving,
      saveError: formError,
      body: eventInspectorBody(draft, calendarInspectorMode),
      dirty,
      hideHeader: eventInspectorHidesHeader(draft, calendarInspectorMode),
      subtitle: eventInspectorSubtitle(draft),
      title: eventInspectorTitle(draft)
    });
  }, [
    currentInspector?.kind,
    currentInspector?.ownerId,
    draft,
    formError,
    calendarInspectorMode,
    source.calendarSources,
    source.taskLists,
    createMode,
    createTaskListId,
    source.settings.defaultTimeZone,
    source.settings.calendarEventColorOverrides,
    recurrenceOperation,
    saving,
    updateInspector
  ]);

  useEffect(() => {
    if (createTaskListIdRef.current || source.taskLists.length === 0) {
      return;
    }

    setCreateTaskListId(defaultTaskListId(source));
  }, [source, source.taskLists]);

  async function canReplaceEventInspector(): Promise<boolean> {
    return currentInspector?.kind !== "event" || currentInspector.ownerId !== ownerId.current || await saveDraft();
  }

  function eventInspectorToolbar(nextDraft: CalendarEventDraft): ReactNode {
    const kind = nextDraft.hcbKind === "birthday" ? "birthday" : nextDraft.mode === "create" ? createModeRef.current : "event";
    return <InspectorItemToolbar kind={kind} persisted={nextDraft.mode === "edit"} busy={saving}
      onKindChange={async (target: InspectorEntryKind) => {
        if (nextDraft.mode === "edit" && !await saveDraft()) return;
        const live = calendarDraftRef.current;
        if (!live) return;
        if (target === "task" || target === "note") { convertEventDraft(live, target); return; }
        if (live.mode === "edit" && !window.confirm(target === "birthday" ? "Change this event into an all-day birthday that repeats every year? Its title and notes will be kept." : "Change this birthday into an event? Its title, notes and yearly schedule will be kept.")) return;
        setCreateMode(target);
        if (live.mode === "edit") await saveDraft();
      }}
      onCopy={() => copyInspectorText(calendarDraftRef.current?.title ?? "", calendarDraftRef.current?.notes ?? "")}
      onDuplicate={async () => { if (await saveDraft() && calendarDraftRef.current) { duplicateEventDraftValue(calendarDraftRef.current); await saveDraft(); } }}
      onDelete={async () => { if (calendarDraftRef.current?.id) await deleteDraft(); else await cancelEventInspector(); }} />;
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
    return `${calendar?.title ?? "Calendar"} · ${calendarDraftRangeLabel(nextDraft, nextDraft.timeZone ?? calendar?.timeZone ?? source.settings.defaultTimeZone)}`;
  }

  function eventInspectorBody(
    nextDraft: CalendarEventDraft,
    mode = calendarInspectorModeRef.current
  ): ReactNode {
    const body = nextDraft.mode === "edit" && mode === "view"
      ? (
        <CalendarEventDetails
          calendars={source.calendarSources}
          defaultTimeZone={source.settings.defaultTimeZone}
          draft={nextDraft}
          eventColorOverrides={source.settings.calendarEventColorOverrides}
          key={`view-${calendarInspectorInstanceRef.current}`}
          rules={source.settings.autoTagRules}
          showTitle={false}
          source={source}
        />
      )
      : (
      <CalendarEventForm
        calendars={source.calendarSources}
        createMode={createModeRef.current}
        defaultTimeZone={source.settings.defaultTimeZone}
        draft={nextDraft}
        error={formError}
        eventColorOverrides={source.settings.calendarEventColorOverrides}
        key={calendarInspectorInstanceRef.current}
        onCreateModeChange={setCreateMode}
        rules={source.settings.autoTagRules}
        setDraft={(next) => setDraft(next)}
        setTaskListId={setCreateTaskListId}
        taskListId={createTaskListId}
        taskLists={source.taskLists}
      />
      );

    return <>{body}{recurrenceScopeDialog()}</>;
  }

  function recurrenceScopeDialog(): ReactNode {
    if (!recurrenceOperation) {
      return null;
    }

    return <CalendarRecurrenceDialog deleting={recurrenceOperation === "delete"}
      onChoose={(scope) => void continueRecurrenceOperation(scope)}
      onCancel={() => { setRecurrenceOperation(null); recurrencePromptRef.current = false; }} />;
  }

  function eventInspectorHidesHeader(
    nextDraft: CalendarEventDraft,
    mode = calendarInspectorModeRef.current
  ): boolean {
    return false;
  }

  function openEventInspector(
    nextDraft: CalendarEventDraft,
    mode: "view" | "edit" = "edit"
  ): void {
    calendarInspectorInstanceRef.current += 1;
    const instance = calendarInspectorInstanceRef.current;
    saveScopeRef.current = undefined;
    recurrencePromptRef.current = false;
    calendarDraftBaselineRef.current = nextDraft;
    calendarDraftRef.current = nextDraft;
    calendarInspectorDirtyRef.current = false;
    setCalendarInspectorMode(mode);
    setRecurrenceOperation(null);
    setFormError(undefined);
    setDraft(nextDraft);
    openInspector({
      ownerId: ownerId.current,
      actions: null,
      toolbar: eventInspectorToolbar(nextDraft),
      onSave: saveDraft,
      onDiscard: cancelEventInspector,
      saving: false,
      saveError: undefined,
      body: eventInspectorBody(nextDraft, mode),
      dirty: false,
      hideHeader: eventInspectorHidesHeader(nextDraft, mode),
      id: nextDraft.id ?? "new",
      kind: "event",
      onConfirmClose: () => instance !== calendarInspectorInstanceRef.current ? true : saveDraft(),
      subtitle: eventInspectorSubtitle(nextDraft),
      title: eventInspectorTitle(nextDraft)
    });
  }

  async function openCreate(seed?: CalendarCreateSeed, options: CalendarCreateOptions = {}): Promise<void> {
    ++readGeneration.current;
    if (!await canReplaceEventInspector()) {
      return;
    }

    const nextMode = options.draft?.hcbKind === "birthday" ? "birthday" : options.createMode ?? "event";
    const nextDraft = applyCreateModeToDraft({
      ...newCalendarDraft(source, seed),
      ...options.draft,
      mode: "create"
    }, nextMode);

    setCreateModeValue(nextMode);
    setCreateTaskListId(options.taskListId ?? defaultTaskListId(source));
    conversionCleanupRef.current = options.cleanup ?? null;
    openEventInspector(nextDraft, "edit");
    if (options.cleanup) await saveDraft();
  }

  async function openEdit(event: CalendarEventViewModel): Promise<void> {
    const generation = ++readGeneration.current;
    if (!await canReplaceEventInspector()) return;
    const open = (complete: CalendarEventViewModel): void => {
      if (generation !== readGeneration.current) return;
      setCreateMode("event");
      conversionCleanupRef.current = null;
      openEventInspector(editCalendarDraft(complete), "edit");
    };
    if (!event.detailsTruncated) { open(event); return; }
    void window.hcb!.calendar.get({ id: event.eventId ?? event.id }).then((result) => {
      if (generation !== readGeneration.current) return;
      if (!result.ok) { setCalendarActionError(result.error.message); return; }
      open({ ...event, notes: result.data.notes ?? result.data.description ?? "", detailsTruncated: false });
    }).catch(() => { if (generation === readGeneration.current) setCalendarActionError("Calendar event could not be opened."); });
  }

  function duplicateEventDraftValue(sourceDraft: CalendarEventDraft): void {
    const nextMode: CalendarCreateMode = isBirthdayLikeDraft(sourceDraft) ? "birthday" : "event";
    const nextDraft = applyCreateModeToDraft({
      ...sourceDraft,
      completedAt: null,
      conference: null,
      guests: "",
      id: undefined,
      mode: "create",
      mutationState: undefined,
      title: copiedTitle(sourceDraft.title, "Untitled event")
    }, nextMode);

    setCreateModeValue(nextMode);
    setCreateTaskListId(defaultTaskListId(source));
    conversionCleanupRef.current = null;
    openEventInspector(nextDraft, "edit");
  }

  function convertEventDraft(sourceDraft: CalendarEventDraft, target: "task" | "note"): void {
    const cleanup = sourceDraft.id ? conversionCleanup("event", sourceDraft.id, target, recurringDraft(sourceDraft)) : undefined;
    if (cleanup === null) return;

    if (target === "task") {
      dispatchConvertCommand({
        cleanup,
        target,
        taskDraft: {
          title: sourceDraft.title,
          notes: sourceDraft.notes,
          dueDate: dateInputValue(sourceDraft.startsAt),
          listId: defaultTaskListId(source),
          priority: "none",
          plannedStart: sourceDraft.allDay ? null : sourceDraft.startsAt,
          plannedEnd: sourceDraft.allDay ? null : sourceDraft.endsAt,
          durationMinutes: null,
          lockedSchedule: false,
          tags: sourceDraft.tags
        }
      });
      return;
    }

    dispatchConvertCommand({
      cleanup,
      target,
      noteDraft: {
        title: sourceDraft.title,
        body: eventNoteBody(
          sourceDraft,
          source.calendarSources.find((calendarSource) => calendarSource.id === sourceDraft.calendarId)?.timeZone ??
            source.settings.defaultTimeZone
        ),
        tags: sourceDraft.tags,
        listId: defaultTaskListId(source)
      }
    });
  }

  function isBirthdayLikeDraft(candidate: CalendarEventDraft): boolean {
    if (candidate.hcbKind === "birthday") {
      return true;
    }

    const frequency =
      candidate.repeatFrequency === "custom" ? candidate.repeatCustomFrequency : candidate.repeatFrequency;

    return (
      candidate.allDay &&
      frequency === "yearly" &&
      candidate.location.trim() === "" &&
      candidate.notes.trim() === "" &&
      candidate.guests.trim() === "" &&
      candidate.conference === null
    );
  }

  async function closeEventInspectorAfterMutation(): Promise<void> {
    discardEventInspectorState();
    saveInFlight.current = false;
    await closeInspector();
    source.refresh();
  }

  async function cleanupConvertedSource(): Promise<string | null> {
    const cleanup = conversionCleanupRef.current;

    if (!cleanup) {
      return null;
    }

    conversionCleanupRef.current = null;

    if (cleanup.kind === "event") {
      const result = await window.hcb?.calendar.delete({ id: cleanup.id });
      return result?.ok ? null : result?.error.message ?? "Original event was not removed.";
    }

    if (cleanup.kind === "note") {
      const result = await window.hcb?.notes.delete({ id: cleanup.id });
      return result?.ok ? null : result?.error.message ?? "Original note was not removed.";
    }

    const result = await window.hcb?.tasks.delete({ id: cleanup.id });
    return result?.ok ? null : result?.error.message ?? "Original task was not removed.";
  }

  function discardEventInspectorState(): void {
    calendarDraftBaselineRef.current = null;
    calendarDraftRef.current = null;
    calendarInspectorDirtyRef.current = false;
    conversionCleanupRef.current = null;
    setCalendarInspectorMode("edit");
    setRecurrenceOperation(null);
    setDraft(null);
    setCreateMode("event");
    setFormError(undefined);
  }

  async function continueRecurrenceOperation(scope: CalendarEventCompletionScope): Promise<void> {
    const operation = recurrenceOperation;
    setRecurrenceOperation(null);
    recurrencePromptRef.current = false;
    if (operation === "delete") {
      await deleteDraft(scope);
      return;
    }
    if (operation === "save") {
      saveScopeRef.current = scope;
      await saveDraft(scope);
    }
  }

  async function saveDraft(recurrenceScope = saveScopeRef.current): Promise<boolean> {
    while (savePromiseRef.current) if (!await savePromiseRef.current) return false;
    const live = calendarDraftRef.current;
    if (!live) return true;
    if (calendarEventDraftsEqual(live, calendarDraftBaselineRef.current) && !(live.mode === "create" && live.title.trim())) return true;
    if (recurrencePromptRef.current) return false;
    saveInFlight.current = true;
    setSaving(true);
    const pending = performSaveDraft(recurrenceScope).catch(() => {
      setFormError("Could not save. Your edits are still here; try again.");
      return false;
    }).finally(() => { saveInFlight.current = false; setSaving(false); });
    savePromiseRef.current = pending;
    let saved: boolean;
    try { saved = await pending; } finally { if (savePromiseRef.current === pending) savePromiseRef.current = null; }
    if (saved && !calendarEventDraftsEqual(calendarDraftRef.current, calendarDraftBaselineRef.current)) return saveDraft(recurrenceScope);
    return saved;
  }

  async function performSaveDraft(recurrenceScope?: CalendarEventCompletionScope): Promise<boolean> {
    const currentDraft = calendarDraftRef.current;

    if (!currentDraft) {
      return false;
    }

    if (currentDraft.mode === "edit" && calendarDraftBaselineRef.current && recurringDraft(calendarDraftBaselineRef.current) && !recurrenceScope) {
      recurrencePromptRef.current = true;
      setRecurrenceOperation("save");
      return false;
    }

    const payload = calendarEventPayload(currentDraft);

    if (!payload.title) {
      setFormError("Title is required.");
      return false;
    }

    if (currentDraft.mode === "create" && createModeRef.current === "task") {
      const listId = createTaskListIdRef.current || defaultTaskListId(source);

      if (!listId) {
        setFormError("Choose a task list.");
        return false;
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
        tags: currentDraft.tags
      });

      if (!saved) {
        setFormError(source.taskMutationError ?? "Task write failed.");
        return false;
      }

      await closeEventInspectorAfterMutation();
      return true;
    }

    if (!Number.isFinite(Date.parse(payload.startsAt)) || !Number.isFinite(Date.parse(payload.endsAt)) || Date.parse(payload.endsAt) <= Date.parse(payload.startsAt)) {
      setFormError("Choose an end time after the start time.");
      return false;
    }

    if (!payload.calendarId) {
      setFormError("Choose a calendar.");
      return false;
    }

    const isBirthdayDraft =
      currentDraft.hcbKind === "birthday" ||
      (currentDraft.mode === "create" && createModeRef.current === "birthday");
    const writePayload =
      isBirthdayDraft
        ? {
            ...payload,
            allDay: true,
            startsAt: startOfUtcDayIso(currentDraft.startsAt),
            endsAt: addUtcDaysIso(startOfUtcDayIso(currentDraft.startsAt), 1),
            hcbKind: "birthday" as const,
            guestEmails: [],
            recurrence: {
              frequency: "yearly" as const,
              interval: 1,
              endsOn: null,
              count: null
            },
            recurrenceLines: ["RRULE:FREQ=YEARLY;INTERVAL=1"]
          }
        : payload;

    const result =
      currentDraft.mode === "create"
        ? await window.hcb?.calendar.create(writePayload)
        : await window.hcb?.calendar.update({
            id: currentDraft.id ?? "",
            ...(recurrenceScope ? { scope: recurrenceScope } : {}),
            ...writePayload
          } satisfies CalendarEventUpdateRequest);

    if (!result?.ok) {
      setFormError(result?.error.message ?? "Calendar event write failed.");
      return false;
    }

    const baseline: CalendarEventDraft = { ...currentDraft, mode: "edit", id: result.data.id };
    const live: CalendarEventDraft = { ...calendarDraftRef.current!, mode: "edit", id: result.data.id };
    calendarDraftBaselineRef.current = baseline;
    if (currentDraft.mode === "create") saveScopeRef.current = "series";
    setDraft(live);
    setFormError(undefined);
    updateInspector({ id: result.data.id });
    const cleanupError = await cleanupConvertedSource();
    if (cleanupError) setFormError(`The new item was saved, but ${cleanupError}`);
    source.refresh();
    return true;
  }

  async function deleteDraft(recurrenceScope?: CalendarEventCompletionScope): Promise<void> {
    await savePromiseRef.current;
    const currentDraft = calendarDraftRef.current;

    if (!currentDraft?.id) {
      return;
    }

    if (recurringDraft(currentDraft) && !recurrenceScope) {
      setRecurrenceOperation("delete");
      return;
    }

    const result = await window.hcb?.calendar.delete({
      id: currentDraft.id,
      ...(recurrenceScope ? { scope: recurrenceScope } : {}),
      ...(currentDraft.originalStartAt ? { originalStartAt: currentDraft.originalStartAt } : {})
    });

    if (!result?.ok) {
      setFormError(result?.error.message ?? "Calendar event delete failed.");
      return;
    }

    await closeEventInspectorAfterMutation();
  }

  async function cancelEventInspector(): Promise<void> {
    await savePromiseRef.current;
    discardEventInspectorState();
    await closeInspector();
  }

  async function commitCalendarEventTime(event: CalendarEventViewModel, range: CalendarEventRange, scope?: CalendarEventCompletionScope): Promise<void> {
    if (timeWritePending.current) return;
    timeWritePending.current = true;
    try {
      // Close/save an existing editor before writing a gesture over its record.
      if (!await closeInspector()) return;
      const block = source.scheduledTaskBlocks.find((candidate) => candidate.calendarEventId === (event.eventId ?? event.id));
      if (block) {
        if (range.allDay) { setCalendarActionError("Scheduled tasks need a timed block. Move this block within the time grid."); return; }
        const saved = await source.moveScheduledTaskBlock({ id: block.id, startsAt: range.startsAt,
          durationMinutes: Math.round((Date.parse(range.endsAt) - Date.parse(range.startsAt)) / 60000) });
        setCalendarActionError(saved ? undefined : "Scheduled task could not be moved. Try again.");
        return;
      }
      const request = { id: event.eventId ?? event.id, ...range, ...(scope ? { scope } : {}),
        timeChangeOrigin: { startsAt: event.startsAt, endsAt: event.endsAt, allDay: event.allDay },
        ...(event.originalStartAt ? { originalStartAt: event.originalStartAt } : {}) };
      const result = await window.hcb?.calendar.update(request);
      if (!result?.ok) { setCalendarActionError(result?.error.message ?? "Calendar event update failed."); return; }
      setCalendarActionError(undefined);
      source.refresh();
    } catch { setCalendarActionError("Calendar event update failed. Try again."); }
    finally { timeWritePending.current = false; }
  }

  function changeCalendarEventTime(event: CalendarEventViewModel, range: CalendarEventRange): void {
    if (event.sourceKind === "task" || timeWritePending.current) return;
    if (event.originalStartAt || event.recurringEventId || event.recurrenceRule || event.recurrenceLines.length) { setTimeChange({ event, range }); return; }
    void commitCalendarEventTime(event, range);
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

    changeCalendarEventTime(event, { startsAt, endsAt, allDay });
  }

  function resizeCalendarEvent(eventId: string, endsAt: string): void {
    const event = source.calendarEventsById[eventId];
    if (!event || Date.parse(endsAt) <= Date.parse(event.startsAt)) return;
    changeCalendarEventTime(event, { startsAt: event.startsAt, endsAt, allDay: event.allDay });
  }

  return {
    calendarActionError,
    changeCalendarEventTime,
    interactionDialog: timeChange ? <CalendarRecurrenceDialog onCancel={() => setTimeChange(null)} onChoose={(scope) => {
      const pending = timeChange; setTimeChange(null); void commitCalendarEventTime(pending.event, pending.range, scope);
    }} /> : null,
    moveCalendarEvent,
    openCreate,
    openEdit,
    resizeCalendarEvent,
    setCalendarActionError
  };
}

function eventNoteBody(sourceDraft: CalendarEventDraft, timeZone: string): string {
  return [
    sourceDraft.notes.trim(),
    `Event: ${calendarDraftRangeLabel(sourceDraft, timeZone)}`,
    sourceDraft.location.trim() ? `Location: ${sourceDraft.location.trim()}` : ""
  ].filter(Boolean).join("\n\n");
}

function recurringDraft(draft: CalendarEventDraft): boolean {
  return draft.recurrenceLines.length > 0 ||
    draft.repeatFrequency !== "none" ||
    !!draft.recurringEventId ||
    !!draft.originalStartAt ||
    (!!draft.eventId && draft.eventId !== draft.id);
}
