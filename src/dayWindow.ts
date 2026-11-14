export type DateSpan = { from: string; to: string };

function dateString(day: Date) {
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

export function shiftDate(date: string, amount: number) {
  const day = new Date(`${date}T12:00:00`);
  day.setDate(day.getDate() + amount);
  return dateString(day);
}

export function datesInWeek(selectedDate: string, weekStartsOn = 1): string[] {
  const selected = new Date(`${selectedDate}T12:00:00`);
  const first = shiftDate(selectedDate, -((selected.getDay() - weekStartsOn + 7) % 7));
  return Array.from({ length: 7 }, (_, index) => shiftDate(first, index));
}

export function weekRange(selectedDate: string, weekStartsOn = 1): DateSpan {
  const dates = datesInWeek(selectedDate, weekStartsOn);
  return { from: dates[0], to: dates[6] };
}

export function datesInRange({ from, to }: DateSpan): string[] {
  const dates: string[] = [];
  const first = new Date(`${from}T12:00:00`);
  const last = new Date(`${to}T12:00:00`);
  if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime())) return dates;
  for (let day = first; day <= last; day.setDate(day.getDate() + 1)) dates.push(dateString(day));
  return dates;
}

export function shiftRange(range: DateSpan, amount: number): DateSpan {
  return { from: shiftDate(range.from, amount), to: shiftDate(range.to, amount) };
}
