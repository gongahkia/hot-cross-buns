import type { ScratchpadMapping, ScratchpadMoveMode } from './scratchpad';

export type Theme = 'day' | 'night';

export const dateFormatOptions = [
  ['long', '13 October 2026'], ['long-us', 'October 13, 2026'],
  ['long-weekday', 'Tuesday, 13 October 2026'], ['long-weekday-us', 'Tuesday, October 13, 2026'],
  ['short', '13 Oct 2026'], ['short-us', 'Oct 13, 2026'],
  ['short-weekday', 'Tue, 13 Oct 2026'], ['short-weekday-us', 'Tue, Oct 13, 2026'],
  ['iso', '2026-10-13'], ['iso-dots', '2026.10.13'],
  ['day-first', '13/10/2026'], ['month-first', '10/13/2026'],
  ['day-first-dots', '13.10.2026'], ['day-first-dashes', '13-10-2026'],
  ['month-first-dashes', '10-13-2026'],
  ['short-day-first', '13/10/26'], ['short-month-first', '10/13/26'],
  ['ordinal', '13th October 2026'], ['ordinal-us', 'October 13th, 2026'],
  ['compact', '20261013'],
] as const;
export type DateFormat = (typeof dateFormatOptions)[number][0];

const THEME_KEY = 'shio-pan-theme';
const DATE_FORMAT_KEY = 'shio-pan-date-format';
const storedPreference = (key: string) => typeof localStorage === 'undefined' ? null : localStorage.getItem(key);

export type HolidayMode = 'saved' | 'view';
export type PastUnfinishedScope = 'visible' | 'all';
export type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6;
const isTimeZone = (value: string) => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } };
export const getTimeZone = () => { const value = storedPreference('shio-pan-time-zone'); return value && isTimeZone(value) ? value : 'Asia/Singapore'; };
export const setTimeZone = (value: string) => { if (!isTimeZone(value)) throw new Error('Invalid time zone'); localStorage.setItem('shio-pan-time-zone', value); };
export const getWeekStart = (): WeekStart => { const value = Number(storedPreference('shio-pan-week-start')); return Number.isInteger(value) && value >= 0 && value <= 6 && storedPreference('shio-pan-week-start') !== null ? value as WeekStart : 1; };
export const setWeekStart = (value: WeekStart) => localStorage.setItem('shio-pan-week-start', String(value));
export const getHolidayCountry = () => storedPreference('shio-pan-holiday-country') ?? 'SG';
export const setHolidayCountry = (value: string) => localStorage.setItem('shio-pan-holiday-country', value);
export const getHolidayMode = (): HolidayMode => storedPreference('shio-pan-holiday-mode') === 'view' ? 'view' : 'saved';
export const setHolidayMode = (value: HolidayMode) => localStorage.setItem('shio-pan-holiday-mode', value);
export const getHolidaysEnabled = () => storedPreference('shio-pan-holidays-enabled') === 'true';
export const setHolidaysEnabled = (value: boolean) => localStorage.setItem('shio-pan-holidays-enabled', String(value));
export const getPastUnfinishedScope = (): PastUnfinishedScope => storedPreference('shio-pan-past-unfinished-scope') === 'all' ? 'all' : 'visible';
export const setPastUnfinishedScope = (value: PastUnfinishedScope) => localStorage.setItem('shio-pan-past-unfinished-scope', value);
export const getScratchpadMapping = (): ScratchpadMapping => {
  const value = storedPreference('shio-pan-scratchpad-mapping');
  return value === 'items' || value === 'single' ? value : 'details';
};
export const setScratchpadMapping = (value: ScratchpadMapping) => localStorage.setItem('shio-pan-scratchpad-mapping', value);
export const getScratchpadMoveMode = (): ScratchpadMoveMode => storedPreference('shio-pan-scratchpad-move-mode') === 'ask' ? 'ask' : 'cut';
export const setScratchpadMoveMode = (value: ScratchpadMoveMode) => localStorage.setItem('shio-pan-scratchpad-move-mode', value);

export function getDateFormat(): DateFormat {
  const stored = storedPreference(DATE_FORMAT_KEY);
  return dateFormatOptions.find(([id]) => id === stored)?.[0] ?? 'long';
}

export function setDateFormat(value: DateFormat) {
  localStorage.setItem(DATE_FORMAT_KEY, value);
}

export function formatDateHeading(value: string, format: DateFormat) {
  if (format === 'iso') return value;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  const intl = (options: Intl.DateTimeFormatOptions, locale = 'en-GB') => date.toLocaleDateString(locale, options);
  if (format === 'long') return intl({ day: 'numeric', month: 'long', year: 'numeric' });
  if (format === 'long-us') return intl({ day: 'numeric', month: 'long', year: 'numeric' }, 'en-US');
  if (format === 'long-weekday') return intl({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (format === 'long-weekday-us') return intl({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }, 'en-US');
  if (format === 'short') return intl({ day: 'numeric', month: 'short', year: 'numeric' });
  if (format === 'short-us') return intl({ day: 'numeric', month: 'short', year: 'numeric' }, 'en-US');
  if (format === 'short-weekday') return intl({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  if (format === 'short-weekday-us') return intl({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }, 'en-US');
  const dd = String(day).padStart(2, '0'), mm = String(month).padStart(2, '0'), yy = String(year).slice(-2);
  const ordinal = `${day}${day % 100 >= 11 && day % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th'}`;
  const monthName = intl({ month: 'long' });
  switch (format) {
    case 'iso-dots': return `${year}.${mm}.${dd}`;
    case 'day-first': return `${dd}/${mm}/${year}`;
    case 'month-first': return `${mm}/${dd}/${year}`;
    case 'day-first-dots': return `${dd}.${mm}.${year}`;
    case 'day-first-dashes': return `${dd}-${mm}-${year}`;
    case 'month-first-dashes': return `${mm}-${dd}-${year}`;
    case 'short-day-first': return `${dd}/${mm}/${yy}`;
    case 'short-month-first': return `${mm}/${dd}/${yy}`;
    case 'ordinal': return `${ordinal} ${monthName} ${year}`;
    case 'ordinal-us': return `${monthName} ${ordinal}, ${year}`;
    case 'compact': return `${year}${mm}${dd}`;
  }
}

export function getTheme(): Theme {
  const stored = storedPreference(THEME_KEY);
  return stored === 'night' ? 'night' : 'day';
}

export function setTheme(value: Theme) {
  localStorage.setItem(THEME_KEY, value);
  applyTheme(value);
}

export function applyStoredAppearance() {
  applyTheme(getTheme());
}

function applyTheme(value: Theme) {
  const root = document.documentElement;
  root.dataset.theme = value;
  root.style.colorScheme = value === 'night' ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', value === 'night' ? '#011627' : '#f2f1ed');
}

