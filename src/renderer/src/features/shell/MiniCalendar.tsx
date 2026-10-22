import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, ChevronUp, Undo2 } from "lucide-react";
import {
  calendarAddUtcDays, calendarAddUtcMonths, calendarDateFromIsoDate,
  calendarDateTitleFromIso, calendarMonthTitle, calendarWeekdayLabel
} from "../core/screens/calendar/calendarDateUtils";
import { useCalendarNavigation } from "./CalendarNavigation";

export function MiniCalendar({ onSelectDate }: { onSelectDate: (date: string) => void }): JSX.Element {
  const { calendarAnchorDate, activeViewId, multiDayCount, todayKey, showWeekNumbers } = useCalendarNavigation();
  const weekStart = calendarAddUtcDays(calendarAnchorDate, -calendarDateFromIsoDate(calendarAnchorDate).getUTCDay());
  const rangeStart = activeViewId === "week" ? weekStart : calendarAnchorDate;
  const rangeEnd = calendarAddUtcDays(rangeStart, activeViewId === "week" ? 6 : activeViewId === "multiDay" ? multiDayCount - 1 : 0);
  const anchorMonth = `${(activeViewId === "week" || activeViewId === "multiDay" ? rangeEnd : calendarAnchorDate).slice(0, 7)}-01`;
  const [displayedMonth, setDisplayedMonth] = useState(anchorMonth);
  const [focusedDay, setFocusedDay] = useState(calendarAnchorDate);
  const grid = useRef<HTMLTableElement>(null);
  const pendingFocus = useRef(false);
  const monthStart = calendarDateFromIsoDate(displayedMonth);
  const firstDay = calendarAddUtcDays(displayedMonth, -monthStart.getUTCDay());
  const weeks = Array.from({ length: 6 }, (_, week) => Array.from({ length: 7 }, (_, day) => calendarAddUtcDays(firstDay, week * 7 + day)));

  useEffect(() => {
    setDisplayedMonth(anchorMonth);
    setFocusedDay(calendarAnchorDate);
  }, [anchorMonth, calendarAnchorDate, activeViewId, multiDayCount]);
  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    grid.current?.querySelector<HTMLButtonElement>(`[data-date="${focusedDay}"]`)?.focus();
  }, [focusedDay, displayedMonth]);

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, day: string) {
    const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    const weekday = calendarDateFromIsoDate(day).getUTCDay();
    const next = offset !== undefined ? calendarAddUtcDays(day, offset)
      : event.key === "Home" ? calendarAddUtcDays(day, -weekday)
      : event.key === "End" ? calendarAddUtcDays(day, 6 - weekday)
      : event.key === "PageUp" ? calendarAddUtcMonths(day, -1)
      : event.key === "PageDown" ? calendarAddUtcMonths(day, 1) : null;
    if (!next) return;
    event.preventDefault();
    pendingFocus.current = true;
    setFocusedDay(next);
    setDisplayedMonth(`${next.slice(0, 7)}-01`);
  }

  function browseMonth(offset: number) {
    const next = calendarAddUtcMonths(displayedMonth, offset);
    setDisplayedMonth(next);
    setFocusedDay(next);
  }

  return (
    <section data-week-numbers={showWeekNumbers} className="mini-calendar" aria-label="Mini calendar">
      <div className="mini-calendar-header">
        <h2 aria-live="polite">{calendarMonthTitle(displayedMonth)}</h2>
        {displayedMonth.slice(0, 7) !== todayKey.slice(0, 7) ? (
          <button aria-label="Mini calendar: return to today" title="Return to today" onClick={() => { setDisplayedMonth(`${todayKey.slice(0, 7)}-01`); onSelectDate(todayKey); }} type="button"><Undo2 size={15} /></button>
        ) : null}
        <button aria-label="Mini calendar: previous month" onClick={() => browseMonth(-1)} type="button"><ChevronUp size={16} /></button>
        <button aria-label="Mini calendar: next month" onClick={() => browseMonth(1)} type="button"><ChevronDown size={16} /></button>
      </div>
      <table ref={grid} aria-label={calendarMonthTitle(displayedMonth)}>
        <thead><tr>{showWeekNumbers ? <th scope="col"><span className="sr-only">Week</span></th> : null}{weeks[0].map((day) => <th scope="col" key={day} title={calendarWeekdayLabel(calendarDateFromIsoDate(day), "long")}>{calendarWeekdayLabel(calendarDateFromIsoDate(day)).slice(0, 2)}</th>)}</tr></thead>
        <tbody>{weeks.map((week) => <tr key={week[0]}>
          {showWeekNumbers ? <th scope="row" className="mini-calendar-week" aria-label={`Week ${weekNumber(week[0])}`}>{weekNumber(week[0])}</th> : null}
          {week.map((day) => <td key={day} data-in-range={activeViewId !== "month" && day >= rangeStart && day <= rangeEnd}>
            <button
              aria-label={calendarDateTitleFromIso(day)}
              aria-current={day === todayKey ? "date" : undefined}
              aria-pressed={day === calendarAnchorDate}
              className="mini-calendar-day"
              data-date={day}
              data-outside={day.slice(0, 7) !== displayedMonth.slice(0, 7)}
              onClick={() => onSelectDate(day)}
              onFocus={() => setFocusedDay(day)}
              onKeyDown={(event) => moveFocus(event, day)}
              tabIndex={day === focusedDay ? 0 : -1}
              type="button"
            >{Number(day.slice(8))}</button>
          </td>)}
        </tr>)}</tbody>
      </table>
    </section>
  );
}

// Sunday-start week numbers, matching the reference and the main calendar.
export function weekNumber(day: string): number {
  const date = calendarDateFromIsoDate(day);
  const end = calendarDateFromIsoDate(calendarAddUtcDays(day, 6));
  const yearStart = new Date(Date.UTC(end.getUTCFullYear(), 0, 1));
  return Math.floor((date.getTime() - yearStart.getTime()) / 604_800_000 + yearStart.getUTCDay() / 7) + 1;
}
