import { expect, test } from '@playwright/test';

test('renders journal data supplied by the configured frontend data source', async ({ page }) => {
  await page.route('**/api/journal?*', route => route.fulfill({ json: {
    tag: null,
    tags: [],
    today: '2026-10-09',
    days: [{
      date: '2026-10-09',
      focused_seconds: 0,
      longest_session_seconds: 0,
      session_count: 0,
      entries: [],
      events: [],
    }],
    tasks: [],
    active_session: null,
    server_time: '2026-10-09T02:00:00Z',
    next_cursor: null,
  } }));

  await page.goto('/');

  await expect(page.getByRole('button', { name: 'Start focus timer' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Focus sessions for 2026-10-09' })).toBeVisible();
});

test('persists font and timezone preferences and sends the timezone to the data source', async ({ page }) => {
  const timezones: string[] = [];
  await page.route('**/api/journal?*', route => {
    timezones.push(new URL(route.request().url()).searchParams.get('timezone') ?? '');
    return route.fulfill({ json: {
      tag: null, tags: [], today: '2026-10-09', tasks: [], active_session: null,
      server_time: '2026-10-09T02:00:00Z', next_cursor: null,
      days: [{ date: '2026-10-09', focused_seconds: 0, longest_session_seconds: 0, session_count: 0, entries: [], events: [] }],
    } });
  });
  await page.goto('/');

  await page.getByRole('navigation', { name: 'Tags' }).hover();
  await page.getByRole('button', { name: 'Open Jing settings' }).click();
  await page.getByRole('button', { name: 'Lora' }).click();
  await page.getByRole('combobox', { name: 'Timezone' }).selectOption('Asia/Tokyo');

  await expect.poll(() => timezones.at(-1)).toBe('Asia/Tokyo');
  await expect.poll(() => page.evaluate(() => ({
    font: document.documentElement.dataset.font,
    storedFont: localStorage.getItem('jing-font'),
    storedTimezone: localStorage.getItem('jing-timezone'),
  }))).toEqual({ font: 'lora', storedFont: 'lora', storedTimezone: 'Asia/Tokyo' });
});
