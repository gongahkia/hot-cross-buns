import { calendarAddUtcDays, calendarMonthOffset } from "./calendarGrid";
import { calendarDayRange } from "./calendarViewportRange";

export function calendarNavigationLimit(range: { start: string; end: string }, anchor: string, view: string,
  settings: { eventRetentionDaysBack: number; monthScrollFutureMonths: number; defaultTimeZone: string }, today: string) {
  const days = settings.eventRetentionDaysBack;
  if (days > 0 && range.end <= calendarDayRange(calendarAddUtcDays(today, -days), settings.defaultTimeZone).start) {
    return { direction: -1, message: `Earlier dates are outside the ${days} ${days === 1 ? "day" : "days"} of calendar history kept on this device. Change retention in Settings to load more history.` } as const;
  }
  if (view === "month" && calendarMonthOffset(today, anchor) > settings.monthScrollFutureMonths) {
    return { direction: 1, message: `Month navigation is limited to ${settings.monthScrollFutureMonths} months ahead. You can change this limit in Settings.` } as const;
  }
  return null;
}
