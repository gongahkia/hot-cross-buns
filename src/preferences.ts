export type AppFont = 'sohne' | 'dm-sans' | 'lora' | 'system';
export type Theme = 'day' | 'night';
export type DateFormat = 'long' | 'iso' | 'day-first' | 'month-first';

const FONT_KEY = 'jing-font';
const THEME_KEY = 'jing-theme';
const DATE_FORMAT_KEY = 'jing-date-format';
const fonts = new Set<AppFont>(['sohne', 'dm-sans', 'lora', 'system']);
const dateFormats = new Set<DateFormat>(['long', 'iso', 'day-first', 'month-first']);

export function getDateFormat(): DateFormat {
  const stored = localStorage.getItem(DATE_FORMAT_KEY);
  return stored && dateFormats.has(stored as DateFormat) ? stored as DateFormat : 'long';
}

export function setDateFormat(value: DateFormat) {
  localStorage.setItem(DATE_FORMAT_KEY, value);
}

export function formatDateHeading(value: string, format: DateFormat) {
  if (format === 'iso') return value;
  const [year, month, day] = value.split('-').map(Number);
  if (format === 'day-first') return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
  if (format === 'month-first') return `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`;
  return new Date(year, month - 1, day, 12).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function getFont(): AppFont {
  const stored = localStorage.getItem(FONT_KEY);
  return stored && fonts.has(stored as AppFont) ? stored as AppFont : 'sohne';
}

export function setFont(value: AppFont) {
  localStorage.setItem(FONT_KEY, value);
  document.documentElement.dataset.font = value;
}

export function getTheme(): Theme {
  return localStorage.getItem(THEME_KEY) === 'night' ? 'night' : 'day';
}

export function setTheme(value: Theme) {
  localStorage.setItem(THEME_KEY, value);
  document.documentElement.dataset.theme = value;
}

export function applyStoredAppearance() {
  document.documentElement.dataset.font = getFont();
  document.documentElement.dataset.theme = getTheme();
}
