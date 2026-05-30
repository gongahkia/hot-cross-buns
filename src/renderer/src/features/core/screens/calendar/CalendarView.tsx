import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { IconButton, StatusBanner } from "../../../../components/primitives";
import { rendererNow, reportRendererTimingSince } from "../../../../hooks/useRenderTiming";
import { useCoreViewModelSource } from "../../coreViewModelSource";
import type { CalendarViewId } from "../../coreViewModels";
import {
  CacheStatePanel,
  SectionChrome,
  scheduleRendererFrame
} from "../../coreScreenShared";
import { CalendarAgendaView } from "./CalendarAgendaView";
import { CalendarHeader } from "./CalendarHeader";
import { ShareAvailabilityPanel } from "./CalendarSidebar";
import { DayView, MultiDayView, WeekView } from "./CalendarTimelineView";
import { MonthView } from "./MonthView";
import {
  buildCalendarEventDayIndex,
  calendarAddUtcDays,
  calendarAddUtcMonths,
  calendarDateTitleFromIso,
  calendarDayViewForDate,
  calendarEventsForDay,
  calendarMonthOffset,
  calendarMonthTitle,
  calendarMonthWeeksForDate,
  calendarRangeDaysForDate,
  calendarRangeTitle,
  calendarTodayKey,
  calendarWeekDaysForDate,
  visibleCalendarEvent
} from "./calendarGrid";
import { useCalendarAvailability } from "./useCalendarAvailability";
import { useCalendarEventInspector } from "./useCalendarEventInspector";

export function CalendarView({
  visibleCalendarIds
}: {
  visibleCalendarIds: ReadonlySet<string>;
}): JSX.Element {
  const source = useCoreViewModelSource();
  const [activeViewId, setActiveViewId] = useState<CalendarViewId>("agenda");
  const [calendarAnchorDate, setCalendarAnchorDate] = useState(calendarTodayKey);
  const [multiDayCount, setMultiDayCount] = useState(3);
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
    availabilitySnippet,
    availabilityStartDate,
    availabilityText,
    availabilityTitle,
    copyAvailabilitySnippet,
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
    moveCalendarEvent,
    openCreate,
    openEdit,
    resizeCalendarEvent,
    setCalendarActionError
  } = useCalendarEventInspector(source);
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
      const detail = (event as CustomEvent<{ action: string; eventId?: string; viewId?: CalendarViewId }>).detail;

      if (detail?.action === "new-event") {
        openCreate();
      }

      if (detail?.action === "open-event" && detail.eventId) {
        const calendarEvent = source.calendarEventsById[detail.eventId];

        if (calendarEvent) {
          setCalendarAnchorDate(calendarEvent.startsAt.slice(0, 10));
          openEdit(calendarEvent);
        }
      }

      if (detail?.action === "set-view" && detail.viewId) {
        setCalendarView(detail.viewId);
      }
    }

    window.addEventListener("hcb:calendar-command", handleCalendarCommand);
    return () => window.removeEventListener("hcb:calendar-command", handleCalendarCommand);
  }, [source]);

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

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <CalendarHeader
        activeViewId={activeViewId}
        calendarRangeLabel={calendarRangeLabel}
        nextRangeLabel={nextRangeLabel}
        onCreate={() => openCreate()}
        onResetRange={resetCalendarAnchor}
        onSetView={setCalendarView}
        onShiftRange={shiftCalendarAnchor}
        onToggleShareAvailability={() => setShareAvailabilityOpen((open) => !open)}
        previousRangeLabel={previousRangeLabel}
        shareAvailabilityOpen={shareAvailabilityOpen}
        shareAvailabilityVisible={shareAvailabilityVisible}
        source={source}
        visibleCalendarCount={visibleCalendarIds.size}
        visibleCalendarViewIds={visibleCalendarViewIds}
      />

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
