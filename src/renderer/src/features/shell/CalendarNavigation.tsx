import { createContext, useCallback, useContext, useEffect, useRef, useState, type Dispatch, type SetStateAction, type ReactNode } from "react";
import type { CalendarViewId } from "../core/coreViewModels";
import { calendarCurrentDayKey } from "../core/screens/calendar/calendarDateUtils";
import { PaneIdentity, usePanePreference } from "./panePreferences";

const CalendarNavigationContext = createContext<ReturnType<typeof useCalendarNavigationState> | null>(null);

function useCalendarNavigationState(timeZone: string) {
  const [activeViewId, setActiveViewId] = usePanePreference<CalendarViewId>("calendar.view", "agenda");
  const [calendarAnchorDate, setAnchorDate] = usePanePreference("calendar.date", () => calendarCurrentDayKey(timeZone));
  const [rollingWindow, setRollingWindow] = usePanePreference<{ view: CalendarViewId; anchor: string; start: string } | null>("calendar.window", null);
  const calendarWindowStart = rollingWindow?.view === activeViewId && rollingWindow.anchor === calendarAnchorDate ? rollingWindow.start : undefined;
  const setCalendarAnchorDate = useCallback<Dispatch<SetStateAction<string>>>((value) => {
    setRollingWindow(null); setAnchorDate(value);
  }, [setAnchorDate, setRollingWindow]);
  const setCalendarWindow = useCallback((start: string, anchor: string) => {
    setRollingWindow({ view: activeViewId, anchor, start }); setAnchorDate(anchor);
  }, [activeViewId, setAnchorDate, setRollingWindow]);
  const [multiDayCount, setMultiDayCount] = usePanePreference("calendar.days", 3);
  const [showWeekends, setShowWeekends] = usePanePreference("calendar.weekends", true);
  const [showWeekNumbers, setShowWeekNumbers] = usePanePreference("calendar.weekNumbers", true);
  const [showDeclinedEvents, setShowDeclinedEvents] = usePanePreference("calendar.declined", true);
  const [todayKey, setTodayKey] = useState(() => calendarCurrentDayKey(timeZone));
  const previousTimeZone = useRef(timeZone);

  useEffect(() => {
    const previous = previousTimeZone.current;
    previousTimeZone.current = timeZone;
    if (previous !== timeZone) {
      setCalendarAnchorDate((day) => day === calendarCurrentDayKey(previous) ? calendarCurrentDayKey(timeZone) : day);
    }
    const updateToday = () => setTodayKey(calendarCurrentDayKey(timeZone));
    updateToday();
    const timer = window.setInterval(updateToday, 60_000);
    window.addEventListener("focus", updateToday);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", updateToday); };
  }, [timeZone, setCalendarAnchorDate]);

  return { calendarWindowStart, setCalendarWindow, activeViewId, setActiveViewId, calendarAnchorDate, setCalendarAnchorDate, multiDayCount, setMultiDayCount, todayKey, showWeekends, setShowWeekends, showWeekNumbers, setShowWeekNumbers, showDeclinedEvents, setShowDeclinedEvents };
}

function CalendarNavigationState({ children, timeZone }: { children: ReactNode; timeZone: string }) {
  const navigation = useCalendarNavigationState(timeZone);
  return <CalendarNavigationContext.Provider value={navigation}>{children}</CalendarNavigationContext.Provider>;
}

export function CalendarNavigationProvider({ children, paneId, timeZone }: { children: ReactNode; paneId: string; timeZone: string }) {
  return <PaneIdentity.Provider value={paneId}><CalendarNavigationState key={paneId} timeZone={timeZone}>{children}</CalendarNavigationState></PaneIdentity.Provider>;
}

export function useCalendarNavigation() {
  const navigation = useContext(CalendarNavigationContext);
  if (!navigation) throw new Error("Calendar navigation requires its workspace provider.");
  return navigation;
}
