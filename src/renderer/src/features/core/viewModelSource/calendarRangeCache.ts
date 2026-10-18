export interface CachedRange { start: string; end: string }

export const maximumCalendarRanges = 6;

/** Keep recent windows individually: merging adjacent months would grow forever. */
export function retainCalendarRange(ranges: readonly CachedRange[], range: CachedRange): CachedRange[] {
  return [...ranges.filter((item) => item.start !== range.start || item.end !== range.end), range].slice(-maximumCalendarRanges);
}

export function inCalendarRanges(item: { startsAt: string; endsAt: string }, ranges: readonly CachedRange[]): boolean {
  return ranges.some((range) => item.startsAt < range.end && item.endsAt > range.start);
}
