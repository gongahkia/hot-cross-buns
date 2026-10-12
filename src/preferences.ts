export type AppFont = 'sohne' | 'dm-sans' | 'lora' | 'system';
export type Theme = 'day' | 'night';

const FONT_KEY = 'jing-font';
const THEME_KEY = 'jing-theme';
const fonts = new Set<AppFont>(['sohne', 'dm-sans', 'lora', 'system']);

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
