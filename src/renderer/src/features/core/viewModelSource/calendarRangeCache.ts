export interface CachedRange { start: string; end: string }

export const maximumCalendarRanges = 6;

/** Keep recent windows individually: merging adjacent months would grow forever. */
export function retainCalendarRange(ranges: readonly CachedRange[], range: CachedRange): CachedRange[] {
  return [...ranges.filter((item) => item.start !== range.start || item.end !== range.end), range].slice(-maximumCalendarRanges);
}

export function inCalendarRanges(item: { startsAt: string; endsAt: string }, ranges: readonly CachedRange[]): boolean {
  return ranges.some((range) => item.startsAt < range.end && item.endsAt > range.start);
}

export function taskInCalendarRanges(task: { dueAt?: string | null }, ranges: readonly CachedRange[]): boolean {
  if (!task.dueAt) return false;
  const day = task.dueAt.slice(0, 10);
  return ranges.some((range) => day >= new Date(Date.parse(range.start) - 86400_000).toISOString().slice(0, 10) && day < new Date(Date.parse(range.end) + 86400_000).toISOString().slice(0, 10));
}

export function retainedLoadedRanges(loaded: readonly CachedRange[], requested: readonly CachedRange[]): CachedRange[] {
  return requested.filter((range) => loaded.some((cached) => cached.start <= range.start && cached.end >= range.end));
}
