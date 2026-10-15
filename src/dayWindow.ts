export type DayWindow = number | 'month';

export function shiftDate(date: string, amount: number) {
  const day = new Date(`${date}T12:00:00`);
  day.setDate(day.getDate() + amount);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

export function datesInWindow(selectedDate: string, window: DayWindow): string[] {
  const selected = new Date(`${selectedDate}T12:00:00`);
  const start = window === 7 ? shiftDate(selectedDate, -((selected.getDay() + 6) % 7)) : selectedDate;
  const count = window === 'month'
    ? new Date(selected.getFullYear(), selected.getMonth() + 1, 0).getDate() - selected.getDate() + 1
    : window;
  return Array.from({ length: count }, (_, index) => shiftDate(start, index));
}
