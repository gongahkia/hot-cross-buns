import { colorThemes, type Theme } from './themes.ts';

const baseFontOptions = [
  ['sohne', 'Sohne', "'Sohne', 'Helvetica Neue', Arial, sans-serif", 300],
  ['dm-sans', 'DM Sans', "'DM Sans', system-ui, sans-serif", 400],
  ['lora', 'Lora', "'Lora', Georgia, serif", 400],
  ['system', 'System', "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", 400],
  ['arial', 'Arial', 'Arial, Helvetica, sans-serif', 400],
  ['helvetica', 'Helvetica Neue', "'Helvetica Neue', Helvetica, Arial, sans-serif", 400],
  ['avenir', 'Avenir', 'Avenir, Arial, sans-serif', 400],
  ['futura', 'Futura', 'Futura, Arial, sans-serif', 400],
  ['gill-sans', 'Gill Sans', "'Gill Sans', Arial, sans-serif", 400],
  ['trebuchet', 'Trebuchet MS', "'Trebuchet MS', Arial, sans-serif", 400],
  ['verdana', 'Verdana', 'Verdana, Arial, sans-serif', 400],
  ['tahoma', 'Tahoma', 'Tahoma, Arial, sans-serif', 400],
  ['georgia', 'Georgia', 'Georgia, serif', 400],
  ['baskerville', 'Baskerville', 'Baskerville, Georgia, serif', 400],
  ['palatino', 'Palatino', "Palatino, 'Palatino Linotype', Georgia, serif", 400],
  ['times', 'Times New Roman', "'Times New Roman', Times, serif", 400],
  ['garamond', 'Garamond', 'Garamond, Georgia, serif', 400],
  ['charter', 'Charter', 'Charter, Georgia, serif', 400],
  ['menlo', 'Menlo', 'Menlo, Consolas, monospace', 400],
  ['monaco', 'Monaco', 'Monaco, Consolas, monospace', 400],
  ['courier', 'Courier New', "'Courier New', Courier, monospace", 400],
] as const;

// Google Fonts monospace families in popularity order, captured 2026-10-13.
// The same families are hosted locally in public/fonts/mono.
export const rawFontOptions = [
  ['robotomono', 'Roboto Mono'],
  ['jetbrainsmono', 'JetBrains Mono'],
  ['inconsolata', 'Inconsolata'],
  ['sourcecodepro', 'Source Code Pro'],
  ['ibmplexmono', 'IBM Plex Mono'],
  ['dmmono', 'DM Mono'],
  ['spacemono', 'Space Mono'],
  ['geistmono', 'Geist Mono'],
  ['courierprime', 'Courier Prime'],
  ['firacode', 'Fira Code'],
  ['googlesanscode', 'Google Sans Code'],
  ['sharetechmono', 'Share Tech Mono'],
  ['ubuntumono', 'Ubuntu Mono'],
  ['vt323', 'VT323'],
  ['cutivemono', 'Cutive Mono'],
  ['ptmono', 'PT Mono'],
  ['firamono', 'Fira Mono'],
  ['anonymouspro', 'Anonymous Pro'],
  ['redhatmono', 'Red Hat Mono'],
  ['cousine', 'Cousine'],
] as const;
export const fontOptions = [
  ...baseFontOptions,
  ...rawFontOptions.map(([id, name]) => [id, name, `'${name}', ui-monospace, SFMono-Regular, Consolas, monospace`, 400] as const),
] as const;
export type AppFont = (typeof fontOptions)[number][0];

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

const FONT_KEY = 'hito-font';
const THEME_KEY = 'hito-theme';
const DATE_FORMAT_KEY = 'hito-date-format';
const storedPreference = (key: string) => typeof localStorage === 'undefined' ? null : localStorage.getItem(key) ?? localStorage.getItem(key.replace('hito-', 'jing-'));

export type HolidayMode = 'saved' | 'view';
export type PastUnfinishedScope = 'visible' | 'all';
export type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6;
const isTimeZone = (value: string) => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } };
export const getTimeZone = () => { const value = storedPreference('hito-time-zone'); return value && isTimeZone(value) ? value : 'Asia/Singapore'; };
export const setTimeZone = (value: string) => { if (!isTimeZone(value)) throw new Error('Invalid time zone'); localStorage.setItem('hito-time-zone', value); };
export const getWeekStart = (): WeekStart => { const value = Number(storedPreference('hito-week-start')); return Number.isInteger(value) && value >= 0 && value <= 6 && storedPreference('hito-week-start') !== null ? value as WeekStart : 1; };
export const setWeekStart = (value: WeekStart) => localStorage.setItem('hito-week-start', String(value));
export const getHolidayCountry = () => storedPreference('hito-holiday-country') ?? 'SG';
export const setHolidayCountry = (value: string) => localStorage.setItem('hito-holiday-country', value);
export const getHolidayMode = (): HolidayMode => storedPreference('hito-holiday-mode') === 'view' ? 'view' : 'saved';
export const setHolidayMode = (value: HolidayMode) => localStorage.setItem('hito-holiday-mode', value);
export const getHolidaysEnabled = () => storedPreference('hito-holidays-enabled') === 'true';
export const setHolidaysEnabled = (value: boolean) => localStorage.setItem('hito-holidays-enabled', String(value));
export const getPastUnfinishedScope = (): PastUnfinishedScope => storedPreference('hito-past-unfinished-scope') === 'all' ? 'all' : 'visible';
export const setPastUnfinishedScope = (value: PastUnfinishedScope) => localStorage.setItem('hito-past-unfinished-scope', value);

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

export function getFont(): AppFont {
  const stored = storedPreference(FONT_KEY);
  return fontOptions.find(([id]) => id === stored)?.[0] ?? 'sohne';
}

export function setFont(value: AppFont) {
  localStorage.setItem(FONT_KEY, value);
  applyFont(value);
}

export function getTheme(): Theme {
  const stored = storedPreference(THEME_KEY);
  return stored === 'day' || stored === 'night' || colorThemes.some(theme => theme.id === stored) ? stored as Theme : 'day';
}

export function setTheme(value: Theme) {
  localStorage.setItem(THEME_KEY, value);
  applyTheme(value);
}

export function applyStoredAppearance() {
  applyFont(getFont());
  applyTheme(getTheme());
}

function applyFont(value: AppFont) {
  const option = fontOptions.find(([id]) => id === value) ?? fontOptions[0];
  document.documentElement.dataset.font = option[0];
  document.documentElement.style.setProperty('--app-font', option[2]);
  document.documentElement.style.setProperty('--app-font-weight', String(option[3]));
}

const themeVariables = ['paper', 'ink', 'muted', 'line', 'soft', 'surface', 'field', 'date-bg', 'tag-bg', 'tag-ink', 'tag-selected', 'selection', 'focus', 'link', 'checkbox', 'primary', 'primary-hover', 'primary-ink', 'danger', 'backdrop'] as const;
const channels = (hex: string) => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
function luminance(hex: string) {
  const rgb = channels(hex).map(channel => channel / 255);
  const luminance = rgb.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * luminance[0] + 0.7152 * luminance[1] + 0.0722 * luminance[2];
}
function contrastRatio(first: string, second: string) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}
function blendHex(first: string, second: string, portion: number) {
  const other = channels(second);
  return `#${channels(first).map((channel, index) => Math.round(channel * portion + other[index] * (1 - portion)).toString(16).padStart(2, '0')).join('')}`;
}
function readableAccent(accent: string, ink: string, paper: string, surface: string) {
  for (let portion = 1; portion >= 0; portion -= 0.05) {
    const candidate = blendHex(accent, ink, portion);
    if (contrastRatio(candidate, paper) >= 4.5 && contrastRatio(candidate, surface) >= 4.5) return candidate;
  }
  return ink;
}
function contrastText(hex: string) {
  return contrastRatio(hex, '#111318') >= contrastRatio(hex, '#ffffff') ? '#111318' : '#ffffff';
}
function applyTheme(value: Theme) {
  const root = document.documentElement;
  root.dataset.theme = value;
  root.style.colorScheme = value === 'night' || colorThemes.find(theme => theme.id === value)?.mode === 'dark' ? 'dark' : 'light';
  for (const variable of themeVariables) root.style.removeProperty(`--${variable}`);
  const palette = colorThemes.find(theme => theme.id === value);
  if (!palette) return;
  const [paper, ink, surface, accent] = palette.colors;
  const mix = (a: string, b: string, percent: number) => `color-mix(in srgb, ${a} ${percent}%, ${b})`;
  const accessibleAccent = readableAccent(accent, ink, paper, surface);
  const vars: Record<(typeof themeVariables)[number], string> = {
    paper, ink, surface, link: accessibleAccent, focus: accessibleAccent, 'tag-selected': accessibleAccent, primary: accessibleAccent,
    muted: mix(ink, paper, 68), line: mix(ink, paper, 20), soft: mix(ink, paper, 9), field: mix(surface, paper, 78),
    'date-bg': mix(accent, paper, 15), 'tag-bg': mix(ink, paper, 10), 'tag-ink': mix(ink, paper, 75),
    selection: mix(accent, paper, 34), checkbox: mix(ink, paper, 56), 'primary-hover': mix(accessibleAccent, ink, 82),
    'primary-ink': contrastText(accessibleAccent),
    danger: palette.mode === 'dark' ? '#ff9b91' : '#a53b3b',
    backdrop: palette.mode === 'dark' ? '#000000aa' : '#20202055',
  };
  for (const [key, color] of Object.entries(vars)) root.style.setProperty(`--${key}`, color);
}
