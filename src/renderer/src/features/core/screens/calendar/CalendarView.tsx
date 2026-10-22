import { CalendarEventMenuProvider } from "./CalendarEventMenu";
import { useCalendarRangeLoader } from "./useCalendarRangeLoader";
import { useCalendarNavigation } from "../../../shell/CalendarNavigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CalendarEventCompletionScope, CalendarEventDetail } from "@shared/ipc/contracts";
import { AlertTriangle, X } from "lucide-react";
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
  calendarMonthOffset,
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

function calendarRangeAllowedByRetention(
  range: { start: string; end: string },
  daysBack: number,
  timeZone: string
): boolean {
  if (daysBack <= 0) {
    return true;
  }

  const oldestDay = calendarAddUtcDays(calendarCurrentDayKey(timeZone), -daysBack);
  return range.end > `${oldestDay}T00:00:00.000Z`;
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

  function shiftCalendarAnchor(direction: -1 | 1): void {
    calendarNavigationStartedAt.current = rendererNow();
    setCalendarAnchorDate((current) => {
      if (activeViewId === "month") {
        const next = calendarAddUtcMonths(current, direction);
        const nextRange = calendarMonthRange(next, source.settings.defaultTimeZone);
        const offset = calendarMonthOffset(calendarCurrentDayKey(source.settings.defaultTimeZone), next);

        if (
          !calendarRangeAllowedByRetention(
            nextRange,
            source.settings.eventRetentionDaysBack,
            source.settings.defaultTimeZone
          ) ||
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

  function scrollCalendarWindow(direction: -1 | 1): void {
    const first = activeViewId === "month" ? calendarDayKey(calendarMonthWeeks[0].days[0])
      : activeViewId === "week" ? calendarDayKey(calendarWeekDays[0]) : calendarAnchorDate;
    const next = calendarAddUtcDays(first, direction * (activeViewId === "month" ? 7 : 1));
    const last = calendarAddUtcDays(next, activeViewId === "month" ? 41 : activeViewId === "week" ? 6 : activeViewId === "multiDay" ? multiDayCount - 1 : 0);
    const range = calendarDaysRange([next, last], source.settings.defaultTimeZone);
    const anchor = activeViewId === "month" ? calendarAddUtcDays(next, 14) : next;
    if (!calendarRangeAllowedByRetention(range, source.settings.eventRetentionDaysBack, source.settings.defaultTimeZone) ||
      (activeViewId === "month" && calendarMonthOffset(todayKey, anchor) > source.settings.monthScrollFutureMonths)) return;
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

  const { error: calendarRangeError, clearError: clearCalendarRangeError } = useCalendarRangeLoader(
    calendarVisibleRange,
    source.dataState !== "loading" && source.dataState !== "stale" &&
      (source.hasCachedData || (source.dataState !== "offline" && source.dataState !== "error")) &&
      calendarRangeAllowedByRetention(calendarVisibleRange, source.settings.eventRetentionDaysBack, source.settings.defaultTimeZone),
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
    <div data-testid="calendar-view" data-range-start={calendarVisibleRange.start} data-range-end={calendarVisibleRange.end} data-visible-event-count={calendarAgendaEvents.length} className="calendar-workspace flex h-full min-h-0 flex-col">
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
        shareAvailabilityOpen={shareAvailabilityOpen}
        shareAvailabilityVisible={shareAvailabilityVisible}
        smartRescheduleOpen={smartRescheduleOpen}
        visibleCalendarViewIds={visibleCalendarViewIds}
      />

      {calendarActionError || calendarRangeError ? (
        <StatusBanner
          action={
            <IconButton
              icon={X}
              label="Dismiss calendar interaction error"
              onClick={() => { setCalendarActionError(undefined); clearCalendarRangeError(); }}
              variant="ghost"
            />
          }
          description={calendarActionError ?? calendarRangeError!}
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
