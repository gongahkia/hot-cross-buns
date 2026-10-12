export type AppFont = 'sohne' | 'dm-sans' | 'lora' | 'system';
export type Theme = 'day' | 'night';

const FONT_KEY = 'jing-font';
const THEME_KEY = 'jing-theme';
const TIMEZONE_KEY = 'jing-timezone';
const fonts = new Set<AppFont>(['sohne', 'dm-sans', 'lora', 'system']);

/** Keep browser data created before the project was renamed. */
export function migrateLegacyStorage() {
  try {
    for (const oldKey of Object.keys(localStorage)) {
      if (!oldKey.startsWith('still-')) continue;
      const newKey = `jing-${oldKey.slice('still-'.length)}`;
      if (localStorage.getItem(newKey) === null) {
        const value = localStorage.getItem(oldKey);
        if (value !== null) localStorage.setItem(newKey, value);
      }
      localStorage.removeItem(oldKey);
    }
  } catch {
    // Preferences are optional; restricted storage must not stop the app loading.
  }
}

migrateLegacyStorage();

export function systemTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function isValidTimezone(value: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function getTimezone() {
  const stored = localStorage.getItem(TIMEZONE_KEY);
  return stored && isValidTimezone(stored) ? stored : systemTimezone();
}

export function setTimezone(value: string) {
  if (!isValidTimezone(value)) throw new Error('Choose a valid IANA timezone.');
  localStorage.setItem(TIMEZONE_KEY, value);
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

export function supportedTimezones() {
  const supportedValuesOf = (Intl as typeof Intl & {
    supportedValuesOf?: (key: 'timeZone') => string[];
  }).supportedValuesOf;
  const values = supportedValuesOf?.('timeZone') ?? [];
  const current = getTimezone();
  return [...new Set([current, ...values])].sort((a, b) => a.localeCompare(b));
}
