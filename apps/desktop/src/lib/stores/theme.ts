import { writable } from 'svelte/store';

export type ThemeChoice = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'hotcrossbuns-theme';

function getStoredTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch {
    // localStorage unavailable
  }
  return 'system';
}

function getSystemPreference(): 'light' | 'dark' {
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

function applyTheme(choice: ThemeChoice) {
  if (typeof document === 'undefined') return;
  const resolved = choice === 'system' ? getSystemPreference() : choice;
  document.documentElement.dataset.theme = resolved;
}

export const theme = writable<ThemeChoice>(getStoredTheme());

/** Resolved theme (never 'system') for components that need to know the actual mode */
export const resolvedTheme = writable<'light' | 'dark'>(
  getStoredTheme() === 'system' ? getSystemPreference() : (getStoredTheme() as 'light' | 'dark')
);

export function initTheme() {
  const initial = getStoredTheme();
  applyTheme(initial);

  theme.subscribe((choice) => {
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      // ignore
    }
    applyTheme(choice);
    resolvedTheme.set(choice === 'system' ? getSystemPreference() : choice);
  });

  // Listen for OS theme changes when set to 'system'
  if (typeof window !== 'undefined') {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    mql.addEventListener('change', () => {
      let current: ThemeChoice = 'system';
      const unsub = theme.subscribe((v) => (current = v));
      unsub();
      if (current === 'system') {
        applyTheme('system');
        resolvedTheme.set(getSystemPreference());
      }
    });
  }
}

export function cycleTheme() {
  theme.update((current) => {
    if (current === 'system') return 'dark';
    if (current === 'dark') return 'light';
    return 'system';
  });
}
