import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { CalendarViewId } from "../core/coreViewModels";
import { calendarCurrentDayKey } from "../core/screens/calendar/calendarDateUtils";
import { PaneIdentity, usePanePreference } from "./panePreferences";

const CalendarNavigationContext = createContext<ReturnType<typeof useCalendarNavigationState> | null>(null);

function useCalendarNavigationState(timeZone: string) {
  const [activeViewId, setActiveViewId] = usePanePreference<CalendarViewId>("calendar.view", "agenda");
  const [calendarAnchorDate, setCalendarAnchorDate] = usePanePreference("calendar.date", () => calendarCurrentDayKey(timeZone));
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

  return { activeViewId, setActiveViewId, calendarAnchorDate, setCalendarAnchorDate, multiDayCount, setMultiDayCount, todayKey, showWeekends, setShowWeekends, showWeekNumbers, setShowWeekNumbers, showDeclinedEvents, setShowDeclinedEvents };
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
