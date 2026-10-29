import { calendarNavigationLimit } from "./calendarNavigationLimits";
import { CalendarEventMenuProvider } from "./CalendarEventMenu";
import { useCalendarRangeLoader } from "./useCalendarRangeLoader";
import { useCalendarNavigation } from "../../../shell/CalendarNavigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CalendarEventCompletionScope, CalendarEventDetail } from "@shared/ipc/contracts";
import { AlertTriangle, X } from "@renderer/components/icons";
import { IconButton, StatusBanner } from "../../../../components/primitives";
import { rendererNow, reportRendererTimingSince } from "../../../../hooks/useRenderTiming";
import { stableCalendarEventViewModel } from "../../viewModelSource/calendarViewModels";
import { useCoreViewModelSource } from "../../coreViewModelSource";
import type { ConvertSourceCleanup } from "../../conversionEvents";
import type { CalendarDayViewModel, CalendarEventViewModel, CalendarViewId } from "../../coreViewModels";
import {
  CacheStatePanel,
  SectionChrome,
  scheduleRendererFrame
} from "../../coreScreenShared";
import { calendarDayRange, calendarDaysRange, calendarMonthRange } from "./calendarViewportRange";
import { CalendarAgendaView } from "./CalendarAgendaView";
import { CalendarViewTransition } from "./CalendarViewTransition";
import { CalendarHeader } from "./CalendarHeader";
import { CalendarSyncStatus } from "./CalendarSyncStatus";
import { ShareAvailabilityPanel, SmartReschedulePanel, type SmartSchedulePreview } from "./CalendarSidebar";
import { DayView, MultiDayView, WeekView, type SmartScheduleGhostBlock } from "./CalendarTimelineView";
import { MonthView } from "./MonthView";
import {
  buildCalendarEventDayIndex,
  calendarAddUtcDays,
  calendarAddUtcMonths,
  calendarCurrentDayKey,
  calendarDateFromIsoDate,
  calendarDateTitleFromIso,
  calendarContextualDateTitleFromIso,
  calendarDayViewForDate,
  calendarDayKey,
  calendarLocalPoint,
  calendarEventsForDay,
  calendarMonthTitle,
  calendarMonthWeeksForDate,
  calendarRangeDaysForDate,
  calendarRangeTitle,
  calendarWeekDaysForDate,
  visibleCalendarEvent
} from "./calendarGrid";
import { useCalendarAvailability } from "./useCalendarAvailability";
import { useCalendarEventInspector } from "./useCalendarEventInspector";
import { useTaskInspector } from "../tasks/useTaskInspector";
import type { CalendarCreateMode, CalendarCreateSeed, CalendarEventDraft } from "./types";

function calendarRangeForDays(days: readonly CalendarDayViewModel[], timeZone: string): { start: string; end: string } {
  return calendarDaysRange(days.map(calendarDayKey), timeZone);
}

function eventViewModelFromDetail(
  detail: CalendarEventDetail,
  source: ReturnType<typeof useCoreViewModelSource>
): CalendarEventViewModel {
  const calendar = source.calendarSources.find((candidate) => candidate.id === detail.calendarId);

  return stableCalendarEventViewModel(
    detail,
    calendar?.title ?? detail.calendarTitle,
    calendar?.timeZone ?? null,
    calendar?.backgroundColor ?? null,
    calendar?.foregroundColor ?? null,
    source.settings.calendarEventColorOverrides,
    source.activeColorTheme,
    source.settings.defaultTimeZone,
    new Map()
  );
}

function findCalendarEventBySearchId(
  eventsById: Record<string, CalendarEventViewModel>,
  eventId: string
): CalendarEventViewModel | undefined {
  return eventsById[eventId] ?? Object.values(eventsById).find((event) => event.eventId === eventId);
}

export function CalendarView({
  visibleCalendarIds
}: {
  visibleCalendarIds: ReadonlySet<string>;
}): JSX.Element {
  const source = useCoreViewModelSource();
  const { calendarWindowStart, setCalendarWindow, activeViewId, setActiveViewId, calendarAnchorDate, setCalendarAnchorDate, multiDayCount, setMultiDayCount, todayKey, showWeekends, showDeclinedEvents } = useCalendarNavigation();
  const [smartRescheduleOpen, setSmartRescheduleOpen] = useState(false);
  const [navigationNotice, setNavigationNotice] = useState<string | null>(null);
  useEffect(() => setNavigationNotice(null), [calendarAnchorDate, calendarWindowStart, activeViewId, source.settings.eventRetentionDaysBack, source.settings.monthScrollFutureMonths]);
  const [smartSchedulePreview, setSmartSchedulePreview] = useState<SmartSchedulePreview | null>(null);
  const calendarNavigationStartedAt = useRef<number | null>(null);
  const {
    addAvailabilitySlot,
    availabilityBusyBlockCount,
    availabilityCalendarId,
    availabilityDurationMinutes,
    availabilityEndDate,
    availabilityError,
    availabilityHoldPending,
    availabilityPending,
    availabilitySlots,
    availabilityStartDate,
    availabilityText,
    availabilityTitle,
    createAvailabilityHolds,
    exportAvailability,
    removeAvailabilitySlot,
    setAvailabilityCalendarId,
    setAvailabilityDurationMinutes,
    setAvailabilityEndDate,
    setAvailabilityStartDate,
    setAvailabilityTitle,
    setShareAvailabilityOpen,
    shareAvailabilityOpen
  } = useCalendarAvailability(source);
  const {
    calendarActionError,
    performCalendarEventAction,
    changeCalendarEventTime,
    interactionDialog,
    moveCalendarEvent,
    openCreate,
    openEdit,
    resizeCalendarEvent,
    setCalendarActionError
  } = useCalendarEventInspector(source);
  const taskInspector = useTaskInspector(source);
  const visibleCalendarEvents = useMemo(
    () =>
      source.calendarAgendaEvents.filter((event) =>
        visibleCalendarEvent(event, visibleCalendarIds) && (showDeclinedEvents || event.selfResponseStatus !== "declined")
      ),
    [source.calendarAgendaEvents, visibleCalendarIds, showDeclinedEvents]
  );
  const smartScheduleGhostBlocks = useMemo<SmartScheduleGhostBlock[]>(
    () => smartSchedulePreview?.suggestions.map((suggestion) => ({
      id: `${suggestion.taskId}-${suggestion.startsAt}`,
      startsAt: suggestion.startsAt,
      endsAt: suggestion.endsAt,
      stale: smartSchedulePreview.stale,
      title: suggestion.taskTitle
    })) ?? [],
    [smartSchedulePreview]
  );
  const handleSmartSchedulePreview = useCallback((preview: SmartSchedulePreview | null) => {
    setSmartSchedulePreview(preview);
  }, []);
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
    () => calendarDayViewForDate(visibleEventDayIndex, calendarAnchorDate, "day", undefined, todayKey),
    [calendarAnchorDate, visibleEventDayIndex, todayKey]
  );
  const calendarWeekDays = useMemo(
    () => calendarWindowStart ? calendarRangeDaysForDate(visibleEventDayIndex, calendarWindowStart, 7, todayKey) : calendarWeekDaysForDate(visibleEventDayIndex, calendarAnchorDate, todayKey),
    [calendarAnchorDate, calendarWindowStart, visibleEventDayIndex, todayKey]
  );
  const calendarMultiDayDays = useMemo(
    () => calendarRangeDaysForDate(visibleEventDayIndex, calendarAnchorDate, multiDayCount, todayKey),
    [calendarAnchorDate, multiDayCount, visibleEventDayIndex, todayKey]
  );
  const calendarMonthWeeks = useMemo(
    () => calendarMonthWeeksForDate(visibleEventDayIndex, calendarAnchorDate, todayKey, calendarWindowStart),
    [calendarAnchorDate, calendarWindowStart, visibleEventDayIndex, todayKey]
  );
  const calendarAgendaEvents = useMemo(
    () => calendarEventsForDay(visibleEventDayIndex, calendarAnchorDate),
    [calendarAnchorDate, visibleEventDayIndex, todayKey]
  );
  const calendarVisibleRange = useMemo(() => {
    if (activeViewId === "month") {
      return calendarRangeForDays(calendarMonthWeeks.flatMap((week) => week.days), source.settings.defaultTimeZone);
    }

    if (activeViewId === "week") {
      return calendarRangeForDays(calendarWeekDays, source.settings.defaultTimeZone);
    }

    if (activeViewId === "multiDay") {
      return calendarRangeForDays(calendarMultiDayDays, source.settings.defaultTimeZone);
    }

    return calendarDayRange(calendarAnchorDate, source.settings.defaultTimeZone);
  }, [activeViewId, calendarAnchorDate, calendarMonthWeeks, calendarMultiDayDays, calendarWeekDays, source.settings.defaultTimeZone]);
  const shareAvailabilityVisible = activeViewId === "day" || activeViewId === "multiDay" || activeViewId === "week";
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

  function setCalendarView(viewId: CalendarViewId): void {
    if (!visibleCalendarViewIds.includes(viewId)) {
      return;
    }

    calendarNavigationStartedAt.current = rendererNow();
    setActiveViewId(viewId);
  }

  const navigationSettings = { eventRetentionDaysBack: source.settings.eventRetentionDaysBack, monthScrollFutureMonths: source.settings.monthScrollFutureMonths, defaultTimeZone: source.settings.defaultTimeZone };

  function shiftedAnchor(direction: -1 | 1): string {
    return activeViewId === "month" ? calendarAddUtcMonths(calendarAnchorDate, direction)
      : calendarAddUtcDays(calendarAnchorDate, direction * (activeViewId === "week" ? 7 : activeViewId === "multiDay" ? multiDayCount : 1));
  }

  function anchorRange(anchor: string) {
    if (activeViewId === "month") return calendarMonthRange(anchor, source.settings.defaultTimeZone);
    const start = activeViewId === "week" ? calendarAddUtcDays(anchor, -calendarDateFromIsoDate(anchor).getUTCDay()) : anchor;
    const length = activeViewId === "week" ? 7 : activeViewId === "multiDay" ? multiDayCount : 1;
    return calendarDaysRange([start, calendarAddUtcDays(start, length - 1)], source.settings.defaultTimeZone);
  }

  function shiftLimit(direction: -1 | 1) {
    const anchor = shiftedAnchor(direction);
    const limit = calendarNavigationLimit(anchorRange(anchor), anchor, activeViewId, navigationSettings, todayKey);
    return limit?.direction === direction ? limit : null;
  }
  const previousLimit = shiftLimit(-1);
  const nextLimit = shiftLimit(1);
  const currentLimit = calendarNavigationLimit(calendarVisibleRange, calendarAnchorDate, activeViewId, navigationSettings, todayKey);
  const boundaryMessage = navigationNotice ?? currentLimit?.message ?? [previousLimit?.message, nextLimit?.message].filter(Boolean).join(" ");

  function shiftCalendarAnchor(direction: -1 | 1): void {
    const limit = shiftLimit(direction);
    if (limit) { setNavigationNotice(limit.message); return; }
    calendarNavigationStartedAt.current = rendererNow();
    setCalendarAnchorDate(shiftedAnchor(direction));
  }

  function scrollCalendarWindow(direction: -1 | 1): void {
    const first = activeViewId === "month" ? calendarDayKey(calendarMonthWeeks[0].days[0])
      : activeViewId === "week" ? calendarDayKey(calendarWeekDays[0]) : calendarAnchorDate;
    const next = calendarAddUtcDays(first, direction * (activeViewId === "month" ? 7 : 1));
    const last = calendarAddUtcDays(next, activeViewId === "month" ? 41 : activeViewId === "week" ? 6 : activeViewId === "multiDay" ? multiDayCount - 1 : 0);
    const range = calendarDaysRange([next, last], source.settings.defaultTimeZone);
    const anchor = activeViewId === "month" ? calendarAddUtcDays(next, 14) : next;
    const limit = calendarNavigationLimit(range, anchor, activeViewId, navigationSettings, todayKey);
    if (limit?.direction === direction) { setNavigationNotice(limit.message); return; }
    calendarNavigationStartedAt.current = rendererNow();
    setCalendarWindow(next, anchor);
  }

  function resetCalendarAnchor(): void {
    calendarNavigationStartedAt.current = rendererNow();
    setCalendarAnchorDate(calendarCurrentDayKey(source.settings.defaultTimeZone));
  }

  function openCalendarItem(calendarItem: typeof visibleCalendarEvents[number]): void {
    if (calendarItem.sourceKind === "task" && calendarItem.taskId) {
      taskInspector.selectTask(calendarItem.taskId);
      return;
    }

    openEdit(calendarItem);
  }

  async function openCalendarSearchResult(eventId: string): Promise<void> {
    const loadedEvent = findCalendarEventBySearchId(source.calendarEventsById, eventId);

    if (loadedEvent) {
      setCalendarAnchorDate(loadedEvent.allDay ? loadedEvent.startsAt.slice(0, 10) : calendarLocalPoint(loadedEvent.startsAt, source.settings.defaultTimeZone).dayKey);
      openEdit(loadedEvent);
      return;
    }

    const result = await window.hcb?.calendar.get({ id: eventId });

    if (!result?.ok) {
      setCalendarActionError("Calendar event could not be opened from search.");
      return;
    }

    const eventDate = result.data.allDay ? result.data.startsAt.slice(0, 10) : calendarLocalPoint(result.data.startsAt, source.settings.defaultTimeZone).dayKey;
    const loaded = await source.ensureCalendarRange(calendarDayRange(eventDate, source.settings.defaultTimeZone));

    if (!loaded) {
      setCalendarActionError("Calendar event context could not be loaded.");
      return;
    }

    setCalendarAnchorDate(eventDate);
    openEdit(eventViewModelFromDetail(result.data, source));
  }

  function toggleCalendarTask(taskId: string): void {
    void taskInspector.toggleTask(taskId);
  }

  function toggleCalendarEvent(eventId: string, scope?: CalendarEventCompletionScope): void {
    const event = source.calendarEventsById[eventId];

    if (event?.scheduledTaskId) {
      void (event.completedAt ? source.reopenTask(event.scheduledTaskId) : source.completeTask(event.scheduledTaskId));
      return;
    }

    if (event?.completedAt) {
      void source.reopenEvent(eventId, scope);
      return;
    }

    void source.completeEvent(eventId, scope);
  }

  useEffect(() => {
    if (!visibleCalendarViewIds.includes(activeViewId)) {
      setCalendarView(visibleCalendarViewIds[0]);
    }
  }, [activeViewId, visibleCalendarViewIds]);

  useEffect(() => {
    function handleCalendarCommand(event: Event): void {
      const detail = (event as CustomEvent<{
        action: string;
        date?: string;
        createMode?: CalendarCreateMode;
        cleanup?: ConvertSourceCleanup;
        draft?: Partial<CalendarEventDraft>;
        eventId?: string;
        seed?: CalendarCreateSeed;
        viewId?: CalendarViewId;
      }>).detail;

      if (detail?.action === "go-to-date" && detail.date && /^\d{4}-\d{2}-\d{2}$/.test(detail.date)) {
        setCalendarAnchorDate(detail.date);
      }

      if (detail?.action === "new-event") {
        openCreate(detail.seed);
      }

      if (detail?.action === "quick-add") {
        openCreate(undefined, {
          createMode: detail.createMode,
          draft: detail.draft
        });
      }

      if (detail?.action === "convert-to-event") {
        openCreate(undefined, {
          cleanup: detail.cleanup,
          createMode: "event",
          draft: detail.draft
        });
      }

      if (detail?.action === "open-event" && detail.eventId) {
        void openCalendarSearchResult(detail.eventId);
      }

      if (detail?.action === "set-view" && detail.viewId) {
        setCalendarView(detail.viewId);
      }
    }

    window.addEventListener("hcb:calendar-command", handleCalendarCommand);
    return () => window.removeEventListener("hcb:calendar-command", handleCalendarCommand);
  }, [source]);

  const { error: calendarRangeError, loading: calendarRangeLoading, retry: retryCalendarRange } = useCalendarRangeLoader(
    calendarVisibleRange,
    source.dataState !== "loading" &&
      (source.hasCachedData || (source.dataState !== "offline" && source.dataState !== "error")) &&
      currentLimit?.direction !== -1,
    source.calendarDataRevision, source.ensureCalendarRange
  );

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

  if (
    (source.dataState === "loading" ||
      source.dataState === "offline" ||
      source.dataState === "error") &&
    !source.hasCachedData
  ) {
    return <CacheStatePanel title="Calendar" />;
  }

  const availabilityMode = shareAvailabilityVisible && shareAvailabilityOpen;

  return (
    <CalendarEventMenuProvider onOpen={openCalendarItem} onAction={performCalendarEventAction}>
    <div aria-busy={calendarRangeLoading} data-testid="calendar-view" data-range-start={calendarVisibleRange.start} data-range-end={calendarVisibleRange.end} data-visible-event-count={calendarAgendaEvents.length} className="calendar-workspace flex h-full min-h-0 flex-col">
      {interactionDialog}
      <CalendarHeader
        anchorDate={calendarAnchorDate}
        onSelectDate={setCalendarAnchorDate}
        timeZone={source.settings.defaultTimeZone}
        activeViewId={activeViewId}
        calendarRangeLabel={calendarRangeLabel}
        nextRangeLabel={nextRangeLabel}
        onCreate={() => openCreate()}
        onResetRange={resetCalendarAnchor}
        onSetView={setCalendarView}
        onShiftRange={shiftCalendarAnchor}
        onToggleShareAvailability={() => {
          setSmartRescheduleOpen(false);
          setShareAvailabilityOpen((open) => !open);
        }}
        onToggleSmartReschedule={() => {
          setShareAvailabilityOpen(false);
          setSmartRescheduleOpen((open) => {
            if (open) setSmartSchedulePreview(null);
            return !open;
          });
        }}
        previousRangeLabel={previousRangeLabel}
        previousLimit={previousLimit?.message}
        nextLimit={nextLimit?.message}
        shareAvailabilityOpen={shareAvailabilityOpen}
        shareAvailabilityVisible={shareAvailabilityVisible}
        smartRescheduleOpen={smartRescheduleOpen}
        visibleCalendarViewIds={visibleCalendarViewIds}
      />

      <CalendarSyncStatus loading={calendarRangeLoading} error={calendarRangeError} onRetry={retryCalendarRange}
        sync={source.syncStatus} offline={source.isOffline} stale={source.isStale}
        hasRemote={source.calendarSources.some(calendar => calendar.accountId && calendar.accountId !== "local")} />

      {boundaryMessage ? <div className="calendar-sync-status" role="status" data-calendar-navigation-limit>
        <span>{boundaryMessage}</span>
        <button onClick={() => window.dispatchEvent(new Event("hcb:open-settings"))}>Settings</button>
      </div> : null}

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
          smartRescheduleOpen ? (
            <SmartReschedulePanel
              calendars={source.calendarSources}
              defaultTimeZone={source.settings.defaultTimeZone}
              initialDate={calendarAnchorDate}
              onApplied={() => source.refresh()}
              onClose={() => {
                setSmartSchedulePreview(null);
                setSmartRescheduleOpen(false);
              }}
              onPreviewChange={handleSmartSchedulePreview}
            />
          ) : shareAvailabilityVisible && shareAvailabilityOpen ? (
            <ShareAvailabilityPanel
              calendarId={availabilityCalendarId}
              calendars={source.calendarSources}
              durationMinutes={availabilityDurationMinutes}
              error={availabilityError}
              onCalendarChange={setAvailabilityCalendarId}
              onClose={() => setShareAvailabilityOpen(false)}
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
              slots={availabilitySlots}
              startDate={availabilityStartDate}
              timeZone={source.settings.defaultTimeZone}
              initialTitle={availabilityTitle}
              endDate={availabilityEndDate}
            />
          ) : undefined
        }
      >
        <CalendarViewTransition viewKey={`${activeViewId}:${activeViewId === "multiDay" ? multiDayCount : ""}:${showWeekends}`} disabled={source.settings.disableAnimations}>
          {activeViewId === "agenda" ? (
            <CalendarAgendaView
              eventCompletionDefaultScope={source.settings.eventCompletionDefaultScope}
              events={calendarAgendaEvents}
              label={calendarContextualDateTitleFromIso(calendarAnchorDate)}
              onOpen={openCalendarItem}
              onToggleEvent={toggleCalendarEvent}
              onToggleTask={toggleCalendarTask}
            />
          ) : null}
          {activeViewId === "day" ? (
            <DayView
              availabilityMode={availabilityMode}
              availabilitySlots={availabilitySlots}
              day={calendarDay}
              eventCompletionDefaultScope={source.settings.eventCompletionDefaultScope}
              onAddAvailabilitySlot={addAvailabilitySlot}
              onCreate={openCreate}
              onMoveEvent={moveCalendarEvent}
              onOpen={openCalendarItem}
              onResizeEvent={resizeCalendarEvent}
              onChangeEvent={changeCalendarEventTime}
              onNavigate={shiftCalendarAnchor}
              onScrollPeriod={scrollCalendarWindow}
              onToggleEvent={toggleCalendarEvent}
              onToggleTask={toggleCalendarTask}
              smartScheduleGhostBlocks={smartScheduleGhostBlocks}
              visibleCalendarIds={visibleCalendarIds}
            />
          ) : null}
          {activeViewId === "multiDay" ? (
            <MultiDayView
              availabilityMode={availabilityMode}
              availabilitySlots={availabilitySlots}
              dayCount={multiDayCount}
              days={calendarMultiDayDays}
              eventCompletionDefaultScope={source.settings.eventCompletionDefaultScope}
              onAddAvailabilitySlot={addAvailabilitySlot}
              onCreate={openCreate}
              onDayCountChange={setMultiDayCount}
              onMoveEvent={moveCalendarEvent}
              onOpen={openCalendarItem}
              onResizeEvent={resizeCalendarEvent}
              onChangeEvent={changeCalendarEventTime}
              onNavigate={shiftCalendarAnchor}
              onScrollPeriod={scrollCalendarWindow}
              onToggleEvent={toggleCalendarEvent}
              onToggleTask={toggleCalendarTask}
              smartScheduleGhostBlocks={smartScheduleGhostBlocks}
              visibleCalendarIds={visibleCalendarIds}
            />
          ) : null}
          {activeViewId === "week" ? (
            <WeekView
              availabilityMode={availabilityMode}
              availabilitySlots={availabilitySlots}
              days={showWeekends ? calendarWeekDays : calendarWeekDays.filter(day => ![0, 6].includes(calendarDateFromIsoDate(calendarDayKey(day)).getUTCDay()))}
              eventCompletionDefaultScope={source.settings.eventCompletionDefaultScope}
              onAddAvailabilitySlot={addAvailabilitySlot}
              onCreate={openCreate}
              onMoveEvent={moveCalendarEvent}
              onOpen={openCalendarItem}
              onResizeEvent={resizeCalendarEvent}
              onChangeEvent={changeCalendarEventTime}
              onNavigate={shiftCalendarAnchor}
              onScrollPeriod={scrollCalendarWindow}
              onToggleEvent={toggleCalendarEvent}
              onToggleTask={toggleCalendarTask}
              smartScheduleGhostBlocks={smartScheduleGhostBlocks}
              visibleCalendarIds={visibleCalendarIds}
            />
          ) : null}
          {activeViewId === "month" ? (
            <MonthView
              onScrollPeriod={scrollCalendarWindow}
              onChangeEvent={changeCalendarEventTime}
              eventCompletionDefaultScope={source.settings.eventCompletionDefaultScope}
              weeks={calendarMonthWeeks}
              onCreate={openCreate}
              onOpen={openCalendarItem}
              onToggleEvent={toggleCalendarEvent}
              onToggleTask={toggleCalendarTask}
              todayKey={calendarCurrentDayKey(source.settings.defaultTimeZone)}
              visibleCalendarIds={visibleCalendarIds}
            />
          ) : null}
        </CalendarViewTransition>
      </SectionChrome>
    </div>
    </CalendarEventMenuProvider>
  );
}
