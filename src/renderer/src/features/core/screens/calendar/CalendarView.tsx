import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { CalendarEventUpdateRequest } from "@shared/ipc/contracts";
import { AlertTriangle, CalendarClock, CalendarPlus, ChevronLeft, ChevronRight, Save, Trash2, X } from "lucide-react";
import type { PlannerActionId } from "../../../../actions/plannerActions";
import { useInspector } from "../../../../components/Inspector";
import { Button, IconButton, StatusBanner } from "../../../../components/primitives";
import { rendererNow, reportRendererTimingSince } from "../../../../hooks/useRenderTiming";
import { useCoreViewModelSource } from "../../coreViewModelSource";
import type { CalendarEventViewModel, CalendarViewId } from "../../coreViewModels";
import {
  CacheStatePanel,
  SectionChrome,
  addUtcDaysIso,
  dateInputValue,
  dateRangeInputToInclusiveIsoRange,
  defaultTaskListId,
  scheduleRendererFrame,
  startOfUtcDayIso
} from "../../coreScreenShared";
import { CalendarAgendaView } from "./CalendarAgendaView";
import { CalendarEventForm } from "./CalendarEventForm";
import {
  CalendarStatusStrip,
  ShareAvailabilityPanel
} from "./CalendarSidebar";
import { DayView, MultiDayView, WeekView } from "./CalendarTimelineView";
import { MonthView } from "./MonthView";
import {
  buildCalendarEventDayIndex,
  calendarAddUtcDays,
  calendarAddUtcMonths,
  calendarAvailabilitySnippet,
  calendarDateTitleFromIso,
  calendarDayViewForDate,
  calendarEventsForDay,
  calendarMonthOffset,
  calendarMonthTitle,
  calendarMonthWeeksForDate,
  calendarRangeDaysForDate,
  calendarRangeTitle,
  calendarTodayKey,
  calendarViewLabel,
  calendarWeekDaysForDate,
  sortedCalendarTimeBlocks,
  visibleCalendarEvent
} from "./calendarGrid";
import {
  calendarDraftRangeLabel,
  calendarEventDraftsEqual,
  calendarEventPayload,
  defaultCalendarId,
  editCalendarDraft,
  newCalendarDraft
} from "./drafts";
import type { CalendarCreateMode, CalendarCreateSeed, CalendarEventDraft, CalendarTimeBlock } from "./types";

function CalendarTabButton({
  actionId,
  active,
  children,
  onClick
}: {
  actionId: PlannerActionId;
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}): JSX.Element {
  return (
    <Button
      aria-selected={active}
      data-action-id={actionId}
      onClick={onClick}
      role="tab"
      size="sm"
      variant={active ? "secondary" : "ghost"}
    >
      {children}
    </Button>
  );
}

function calendarViewActionId(viewId: CalendarViewId): PlannerActionId {
  return `calendar.view.${viewId}` as PlannerActionId;
}

export function CalendarView({
  visibleCalendarIds
}: {
  visibleCalendarIds: ReadonlySet<string>;
}): JSX.Element {
  const source = useCoreViewModelSource();
  const {
    close: closeInspector,
    current: currentInspector,
    open: openInspector,
    update: updateInspector
  } = useInspector();
  const [activeViewId, setActiveViewId] = useState<CalendarViewId>("agenda");
  const [calendarAnchorDate, setCalendarAnchorDate] = useState(calendarTodayKey);
  const [multiDayCount, setMultiDayCount] = useState(3);
  const [shareAvailabilityOpen, setShareAvailabilityOpen] = useState(true);
  const [availabilityTitle, setAvailabilityTitle] = useState("Meeting");
  const [availabilityDurationMinutes, setAvailabilityDurationMinutes] = useState(30);
  const [availabilityCalendarId, setAvailabilityCalendarId] = useState(() => defaultCalendarId(source));
  const [availabilitySlots, setAvailabilitySlots] = useState<CalendarTimeBlock[]>([]);
  const [availabilityHoldPending, setAvailabilityHoldPending] = useState(false);
  const [draft, setDraftState] = useState<CalendarEventDraft | null>(null);
  const [createMode, setCreateModeState] = useState<CalendarCreateMode>("event");
  const [createTaskListId, setCreateTaskListIdState] = useState(() => defaultTaskListId(source));
  const [formError, setFormError] = useState<string | undefined>();
  const [calendarActionError, setCalendarActionError] = useState<string | undefined>();
  const [availabilityStartDate, setAvailabilityStartDate] = useState(() =>
    dateInputValue(startOfUtcDayIso(new Date()))
  );
  const [availabilityEndDate, setAvailabilityEndDate] = useState(() =>
    dateInputValue(addUtcDaysIso(startOfUtcDayIso(new Date()), 6))
  );
  const [availabilityCalendarIds, setAvailabilityCalendarIds] = useState<string[]>([]);
  const [availabilityText, setAvailabilityText] = useState("");
  const [availabilityError, setAvailabilityError] = useState<string | undefined>();
  const [availabilityBusyBlockCount, setAvailabilityBusyBlockCount] = useState<number | null>(null);
  const [availabilityPending, setAvailabilityPending] = useState(false);
  const calendarNavigationStartedAt = useRef<number | null>(null);
  const calendarDraftRef = useRef<CalendarEventDraft | null>(draft);
  const calendarDraftBaselineRef = useRef<CalendarEventDraft | null>(draft);
  const calendarInspectorDirtyRef = useRef(false);
  const calendarInspectorInstanceRef = useRef(0);
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
  const availableCalendarIds = useMemo(
    () => new Set(source.calendarSources.map((calendar) => calendar.id)),
    [source.calendarSources]
  );
  const visibleCalendarEvents = useMemo(
    () =>
      source.calendarAgendaEvents.filter((event) =>
        visibleCalendarEvent(event, visibleCalendarIds)
      ),
    [source.calendarAgendaEvents, visibleCalendarIds]
  );
  const visibleCalendarViewIds = useMemo(() => {
    const hidden = new Set(source.settings.hiddenCalendarViewModes);
    const visible = (["agenda", "day", "multiDay", "week", "month"] as CalendarViewId[]).filter(
      (viewId) => !hidden.has(viewId)
    );

    return visible.length > 0 ? visible : (["month"] as CalendarViewId[]);
  }, [source.settings.hiddenCalendarViewModes]);
  const visibleEventDayIndex = useMemo(
    () => buildCalendarEventDayIndex(visibleCalendarEvents),
    [visibleCalendarEvents]
  );
  const calendarDay = useMemo(
    () => calendarDayViewForDate(visibleEventDayIndex, calendarAnchorDate, "day"),
    [calendarAnchorDate, visibleEventDayIndex]
  );
  const calendarWeekDays = useMemo(
    () => calendarWeekDaysForDate(visibleEventDayIndex, calendarAnchorDate),
    [calendarAnchorDate, visibleEventDayIndex]
  );
  const calendarMultiDayDays = useMemo(
    () => calendarRangeDaysForDate(visibleEventDayIndex, calendarAnchorDate, multiDayCount),
    [calendarAnchorDate, multiDayCount, visibleEventDayIndex]
  );
  const calendarMonthWeeks = useMemo(
    () => calendarMonthWeeksForDate(visibleEventDayIndex, calendarAnchorDate),
    [calendarAnchorDate, visibleEventDayIndex]
  );
  const calendarAgendaEvents = useMemo(
    () => calendarEventsForDay(visibleEventDayIndex, calendarAnchorDate),
    [calendarAnchorDate, visibleEventDayIndex]
  );
  const selectedAvailabilityCalendarIds = availabilityCalendarIds.filter((calendarId) =>
    availableCalendarIds.has(calendarId)
  );
  const availabilityRange = dateRangeInputToInclusiveIsoRange(availabilityStartDate, availabilityEndDate);
  const canExportAvailability =
    selectedAvailabilityCalendarIds.length > 0 &&
    availabilityRange !== null &&
    Date.parse(availabilityRange.end) > Date.parse(availabilityRange.start) &&
    !availabilityPending;
  const shareAvailabilityVisible = activeViewId !== "agenda";
  const calendarRangeLabel =
    activeViewId === "month"
      ? calendarMonthTitle(calendarAnchorDate)
      : activeViewId === "week"
        ? calendarRangeTitle(calendarWeekDays)
        : activeViewId === "multiDay"
          ? calendarRangeTitle(calendarMultiDayDays)
          : calendarDateTitleFromIso(calendarAnchorDate);
  const previousRangeLabel =
    activeViewId === "month"
      ? "Previous month"
      : activeViewId === "week"
        ? "Previous week"
        : activeViewId === "multiDay"
          ? `Previous ${multiDayCount} days`
          : "Previous day";
  const nextRangeLabel =
    activeViewId === "month"
      ? "Next month"
      : activeViewId === "week"
        ? "Next week"
        : activeViewId === "multiDay"
          ? `Next ${multiDayCount} days`
          : "Next day";
  const availabilitySnippet = useMemo(
    () =>
      calendarAvailabilitySnippet({
        durationMinutes: availabilityDurationMinutes,
        slots: availabilitySlots,
        timeZone: source.settings.defaultTimeZone,
        title: availabilityTitle
      }),
    [availabilityDurationMinutes, availabilitySlots, availabilityTitle, source.settings.defaultTimeZone]
  );

  function setCreateMode(mode: CalendarCreateMode): void {
    createModeRef.current = mode;
    setCreateModeState(mode);

    if (mode === "birthday") {
      setDraft((current) => {
        if (!current) {
          return current;
        }

        const startsAt = startOfUtcDayIso(current.startsAt);
        return {
          ...current,
          allDay: true,
          startsAt,
          endsAt: addUtcDaysIso(startsAt, 1),
          repeatFrequency: "yearly",
          repeatInterval: "1"
        };
      });
    }
  }

  function setCreateTaskListId(listId: string): void {
    createTaskListIdRef.current = listId;
    setCreateTaskListIdState(listId);
  }

  function setCalendarView(viewId: CalendarViewId): void {
    if (!visibleCalendarViewIds.includes(viewId)) {
      return;
    }

    calendarNavigationStartedAt.current = rendererNow();
    setActiveViewId(viewId);
  }

  function shiftCalendarAnchor(direction: -1 | 1): void {
    calendarNavigationStartedAt.current = rendererNow();
    setCalendarAnchorDate((current) => {
      if (activeViewId === "month") {
        const next = calendarAddUtcMonths(current, direction);
        const offset = calendarMonthOffset(calendarTodayKey(), next);

        if (
          offset < -source.settings.monthScrollPastMonths ||
          offset > source.settings.monthScrollFutureMonths
        ) {
          return current;
        }

        return next;
      }

      if (activeViewId === "week") {
        return calendarAddUtcDays(current, direction * 7);
      }

      if (activeViewId === "multiDay") {
        return calendarAddUtcDays(current, direction * multiDayCount);
      }

      return calendarAddUtcDays(current, direction);
    });
  }

  function resetCalendarAnchor(): void {
    calendarNavigationStartedAt.current = rendererNow();
    setCalendarAnchorDate(calendarTodayKey());
  }

  useEffect(() => {
    if (!visibleCalendarViewIds.includes(activeViewId)) {
      setCalendarView(visibleCalendarViewIds[0]);
    }
  }, [activeViewId, visibleCalendarViewIds]);

  useEffect(() => {
    function handleCalendarCommand(event: Event): void {
      const detail = (event as CustomEvent<{ action: string; viewId?: CalendarViewId }>).detail;

      if (detail?.action === "new-event") {
        openCreate();
      }

      if (detail?.action === "set-view" && detail.viewId) {
        setCalendarView(detail.viewId);
      }
    }

    window.addEventListener("hcb:calendar-command", handleCalendarCommand);
    return () => window.removeEventListener("hcb:calendar-command", handleCalendarCommand);
  }, [source]);

  useEffect(() => {
    if (availabilityCalendarIds.length > 0 || source.calendarSources.length === 0) {
      return;
    }

    const selectedCalendarIds = source.calendarSources
      .filter((calendar) => calendar.selected)
      .map((calendar) => calendar.id);

    setAvailabilityCalendarIds(
      selectedCalendarIds.length > 0
        ? selectedCalendarIds
        : source.calendarSources.map((calendar) => calendar.id)
    );
  }, [availabilityCalendarIds.length, source.calendarSources]);

  useEffect(() => {
    if (source.calendarSources.length === 0) {
      setAvailabilityCalendarId("");
      return;
    }

    if (availabilityCalendarId && source.calendarSources.some((calendar) => calendar.id === availabilityCalendarId)) {
      return;
    }

    setAvailabilityCalendarId(defaultCalendarId(source));
  }, [availabilityCalendarId, source, source.calendarSources]);

  useEffect(() => {
    scheduleRendererFrame(() => {
      reportRendererTimingSince("calendar.navigate", calendarNavigationStartedAt.current, {
        anchor: calendarAnchorDate,
        view: activeViewId,
        eventCount: visibleCalendarEvents.length
      });
      calendarNavigationStartedAt.current = null;
    });
  }, [activeViewId, calendarAnchorDate, visibleCalendarEvents.length]);

  useEffect(() => {
    if (currentInspector?.kind !== "event" || !draft) {
      return;
    }

    const dirty = !calendarEventDraftsEqual(draft, calendarDraftBaselineRef.current);
    calendarInspectorDirtyRef.current = dirty;
    updateInspector({
      actions: eventInspectorActions(draft),
      body: eventInspectorBody(draft),
      dirty,
      subtitle: eventInspectorSubtitle(draft),
      title: eventInspectorTitle(draft)
    });
  }, [
    currentInspector?.kind,
    draft,
    formError,
    source.calendarSources,
    source.taskLists,
    createMode,
    createTaskListId,
    source.settings.defaultTimeZone,
    updateInspector
  ]);

  useEffect(() => {
    if (createTaskListIdRef.current || source.taskLists.length === 0) {
      return;
    }

    setCreateTaskListId(defaultTaskListId(source));
  }, [source.taskLists]);

  if (
    (source.dataState === "loading" ||
      source.dataState === "offline" ||
      source.dataState === "error") &&
    !source.hasCachedData
  ) {
    return <CacheStatePanel title="Calendar" />;
  }

  function canReplaceEventInspector(): boolean {
    return currentInspector?.kind !== "event" || !calendarInspectorDirtyRef.current;
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

  function eventInspectorBody(nextDraft: CalendarEventDraft): ReactNode {
    return (
      <CalendarEventForm
        calendars={source.calendarSources}
        createMode={createMode}
        defaultTimeZone={source.settings.defaultTimeZone}
        draft={nextDraft}
        error={formError}
        key={calendarInspectorInstanceRef.current}
        onCreateModeChange={setCreateMode}
        setDraft={(next) => setDraft(next)}
        setTaskListId={setCreateTaskListId}
        taskListId={createTaskListId}
        taskLists={source.taskLists}
      />
    );
  }

  function eventInspectorActions(nextDraft: CalendarEventDraft): ReactNode {
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

  function openEventInspector(nextDraft: CalendarEventDraft): void {
    calendarInspectorInstanceRef.current += 1;
    calendarDraftBaselineRef.current = nextDraft;
    calendarDraftRef.current = nextDraft;
    calendarInspectorDirtyRef.current = false;
    setFormError(undefined);
    setDraft(nextDraft);
    openInspector({
      actions: eventInspectorActions(nextDraft),
      body: eventInspectorBody(nextDraft),
      dirty: false,
      id: nextDraft.id ?? "new",
      kind: "event",
      onConfirmClose: () => !calendarInspectorDirtyRef.current,
      subtitle: eventInspectorSubtitle(nextDraft),
      title: eventInspectorTitle(nextDraft)
    });
  }

  function openCreate(seed?: CalendarCreateSeed): void {
    if (!canReplaceEventInspector()) {
      return;
    }

    setCreateMode("event");
    setCreateTaskListId(defaultTaskListId(source));
    openEventInspector(newCalendarDraft(source, seed));
  }

  function openEdit(event: CalendarEventViewModel): void {
    if (!canReplaceEventInspector()) {
      return;
    }

    setCreateMode("event");
    openEventInspector(editCalendarDraft(event));
  }

  async function closeEventInspectorAfterMutation(): Promise<void> {
    calendarDraftBaselineRef.current = null;
    calendarDraftRef.current = null;
    calendarInspectorDirtyRef.current = false;
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

  function toggleAvailabilityCalendar(calendarId: string, selected: boolean): void {
    setAvailabilityCalendarIds((current) => {
      const next = new Set(current);

      if (selected) {
        next.add(calendarId);
      } else {
        next.delete(calendarId);
      }

      return Array.from(next);
    });
  }

  async function exportAvailability(): Promise<void> {
    if (!canExportAvailability || availabilityRange === null) {
      setAvailabilityError("Choose at least one calendar and a valid date range.");
      return;
    }

    setAvailabilityPending(true);
    setAvailabilityError(undefined);

    const result = await window.hcb?.calendar.exportAvailability({
      calendarIds: selectedAvailabilityCalendarIds,
      start: availabilityRange.start,
      end: availabilityRange.end,
      format: "text"
    });

    setAvailabilityPending(false);

    if (!result?.ok) {
      setAvailabilityError(result?.error.message ?? "Availability export failed.");
      return;
    }

    setAvailabilityText(result.data.text);
    setAvailabilityBusyBlockCount(result.data.busyBlockCount);
  }

  function copyAvailability(): void {
    if (!availabilityText) {
      return;
    }

    void navigator.clipboard?.writeText(availabilityText);
  }

  function addAvailabilitySlot(slot: CalendarTimeBlock): void {
    setAvailabilityError(undefined);
    setAvailabilitySlots((current) => {
      if (current.some((candidate) => candidate.id === slot.id)) {
        return current;
      }

      return sortedCalendarTimeBlocks([...current, slot]);
    });
  }

  function removeAvailabilitySlot(slotId: string): void {
    setAvailabilitySlots((current) => current.filter((slot) => slot.id !== slotId));
  }

  function copyAvailabilitySnippet(): void {
    if (availabilitySlots.length === 0) {
      return;
    }

    void navigator.clipboard?.writeText(availabilitySnippet);
  }

  async function createAvailabilityHolds(): Promise<void> {
    if (availabilitySlots.length === 0) {
      setAvailabilityError("Select at least one time block.");
      return;
    }

    if (!availabilityCalendarId) {
      setAvailabilityError("Choose a calendar.");
      return;
    }

    setAvailabilityHoldPending(true);
    setAvailabilityError(undefined);

    for (const slot of sortedCalendarTimeBlocks(availabilitySlots)) {
      const result = await window.hcb?.calendar.create({
        allDay: false,
        calendarId: availabilityCalendarId,
        endsAt: slot.endsAt,
        guestEmails: [],
        location: "",
        notes: "Availability hold",
        recurrence: null,
        reminderMinutes: [],
        startsAt: slot.startsAt,
        title: availabilityTitle.trim() || "Hold"
      });

      if (!result?.ok) {
        setAvailabilityHoldPending(false);
        setAvailabilityError(result?.error.message ?? "Hold write failed.");
        return;
      }
    }

    setAvailabilityHoldPending(false);
    setAvailabilitySlots([]);
    source.refresh();
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto pb-1">
          <span className="inline-flex shrink-0 items-center gap-2 text-[var(--text-sm)] font-semibold text-text-secondary">
            <CalendarClock aria-hidden="true" size={15} />
            View
          </span>
          <div className="flex min-w-0 items-center gap-1 rounded-hcbMd border border-border bg-bg-secondary p-1" role="tablist" aria-label="Calendar views">
            {visibleCalendarViewIds.map((viewId) => (
              <CalendarTabButton
                actionId={calendarViewActionId(viewId)}
                active={viewId === activeViewId}
                key={viewId}
                onClick={() => setCalendarView(viewId)}
              >
                {calendarViewLabel(viewId)}
              </CalendarTabButton>
            ))}
          </div>
          <div
            aria-label="Calendar range navigation"
            className="flex shrink-0 items-center gap-1 rounded-hcbMd border border-border bg-bg-secondary p-1"
            role="group"
          >
            <IconButton
              icon={ChevronLeft}
              label={previousRangeLabel}
              onClick={() => shiftCalendarAnchor(-1)}
              size="sm"
              variant="ghost"
            />
            <Button
              aria-label="Return calendar to today"
              className="min-w-32 max-w-48 truncate px-2"
              onClick={resetCalendarAnchor}
              size="sm"
              title="Return to today"
              variant="ghost"
            >
              <span className="truncate">{calendarRangeLabel}</span>
            </Button>
            <IconButton
              icon={ChevronRight}
              label={nextRangeLabel}
              onClick={() => shiftCalendarAnchor(1)}
              size="sm"
              variant="ghost"
            />
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          <Button data-action-id="calendar.create" onClick={() => openCreate()} size="sm" variant="primary">
            <CalendarPlus aria-hidden="true" size={14} />
            New event
          </Button>
          {shareAvailabilityVisible ? (
            <Button
              aria-expanded={shareAvailabilityOpen}
              onClick={() => setShareAvailabilityOpen((open) => !open)}
              size="sm"
              variant={shareAvailabilityOpen ? "secondary" : "ghost"}
            >
              <CalendarPlus aria-hidden="true" size={14} />
              Share availability
            </Button>
          ) : null}
          <CalendarStatusStrip
            source={source}
            visibleCalendarCount={visibleCalendarIds.size}
            visibleEventCount={visibleCalendarEvents.length}
          />
        </div>
      </div>

      {calendarActionError ? (
        <StatusBanner
          action={
            <IconButton
              icon={X}
              label="Dismiss calendar interaction error"
              onClick={() => setCalendarActionError(undefined)}
              variant="ghost"
            />
          }
          description={calendarActionError}
          icon={AlertTriangle}
          title="Calendar interaction not saved"
          tone="warning"
        />
      ) : null}

      <SectionChrome
        title="Calendar"
        sidebar={
          shareAvailabilityVisible && shareAvailabilityOpen ? (
            <ShareAvailabilityPanel
              calendarId={availabilityCalendarId}
              calendars={source.calendarSources}
              durationMinutes={availabilityDurationMinutes}
              error={availabilityError}
              onCalendarChange={setAvailabilityCalendarId}
              onClose={() => setShareAvailabilityOpen(false)}
              onCopySnippet={copyAvailabilitySnippet}
              onCreateHolds={() => void createAvailabilityHolds()}
              onDurationChange={setAvailabilityDurationMinutes}
              onEndDateChange={setAvailabilityEndDate}
              onExportAvailability={() => void exportAvailability()}
              onRemoveSlot={removeAvailabilitySlot}
              onStartDateChange={setAvailabilityStartDate}
              onTitleChange={setAvailabilityTitle}
              pending={availabilityHoldPending}
              exportBusyBlockCount={availabilityBusyBlockCount}
              exportPending={availabilityPending}
              exportText={availabilityText}
              pendingHoldCount={source.syncStatus.pendingMutationCount}
              slots={availabilitySlots}
              snippet={availabilitySnippet}
              startDate={availabilityStartDate}
              timeZone={source.settings.defaultTimeZone}
              title={availabilityTitle}
              endDate={availabilityEndDate}
            />
          ) : undefined
        }
      >
        <div className="h-full min-h-0 overflow-auto pr-1">
          {activeViewId === "agenda" ? (
            <CalendarAgendaView
              events={calendarAgendaEvents}
              label={calendarDateTitleFromIso(calendarAnchorDate)}
              onOpen={openEdit}
            />
          ) : null}
          {activeViewId === "day" ? (
            <DayView
              availabilityMode={false}
              availabilitySlots={[]}
              day={calendarDay}
              onAddAvailabilitySlot={addAvailabilitySlot}
              onCreate={openCreate}
              onMoveEvent={moveCalendarEvent}
              onOpen={openEdit}
              onResizeEvent={resizeCalendarEvent}
              visibleCalendarIds={visibleCalendarIds}
            />
          ) : null}
          {activeViewId === "multiDay" ? (
            <MultiDayView
              availabilityMode={false}
              availabilitySlots={[]}
              dayCount={multiDayCount}
              days={calendarMultiDayDays}
              onAddAvailabilitySlot={addAvailabilitySlot}
              onCreate={openCreate}
              onDayCountChange={setMultiDayCount}
              onMoveEvent={moveCalendarEvent}
              onOpen={openEdit}
              onResizeEvent={resizeCalendarEvent}
              visibleCalendarIds={visibleCalendarIds}
            />
          ) : null}
          {activeViewId === "week" ? (
            <WeekView
              availabilityMode={false}
              availabilitySlots={[]}
              days={calendarWeekDays}
              onAddAvailabilitySlot={addAvailabilitySlot}
              onCreate={openCreate}
              onMoveEvent={moveCalendarEvent}
              onOpen={openEdit}
              onResizeEvent={resizeCalendarEvent}
              visibleCalendarIds={visibleCalendarIds}
            />
          ) : null}
          {activeViewId === "month" ? (
            <MonthView
              weeks={calendarMonthWeeks}
              onCreate={openCreate}
              onOpen={openEdit}
              visibleCalendarIds={visibleCalendarIds}
            />
          ) : null}
        </div>
      </SectionChrome>
    </div>
  );
}
