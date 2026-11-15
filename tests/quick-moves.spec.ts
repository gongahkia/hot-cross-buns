import { runCommand, selectSearchResult } from './commands';
import { expect, test, type Page } from '@playwright/test';

async function documentIn(page: Page) {
  return page.evaluate(() => new Promise<{ days: Array<{ date: string; items: Array<{ text: string; span?: { through?: string }; repeat?: { series?: string }; replaces?: { series: string; on: string }; details: Array<{ text: string }> }> }> }>((resolve, reject) => {
    const request = indexedDB.open('hot-cross-buns-v1');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const entry = db.transaction('state').objectStore('state').get('current');
      entry.onsuccess = () => { db.close(); resolve(entry.result.document); };
      entry.onerror = () => { db.close(); reject(entry.error); };
    };
  }));
}

async function importJournal(page: Page, raw: string) {
  // UTC is still November 15; the journal's default Singapore zone is November 16.
  await page.clock.install({ time: new Date('2026-11-15T17:30:00Z') });
  await page.goto('/');
  await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(raw) });
  await expect(page.getByRole('status').filter({ hasText: 'TODO.txt imported.' })).toBeVisible();
}

async function openMove(page: Page, title: string, date = '2026-11-16') {
  await page.locator(`[data-journal-date="${date}"]`).getByRole('button', { name: 'More actions for ' + title, exact: true }).click();
  await page.getByRole('button', { name: 'Move ' + title, exact: true }).click();
}

test('quick today brings an older item forward and undo restores its original date', async ({ page }) => {
  await importJournal(page, '2026-11-10\n\nReview notes\n- [ ] Keep the context\n');
  await runCommand(page, 'Open search');
  await page.getByRole('combobox', { name: 'Search commands and journal' }).fill('Review notes');
  await selectSearchResult(page, 'Review notes');
  await openMove(page, 'Review notes', '2026-11-10');
  await page.getByRole('button', { name: 'Move Review notes to today', exact: true }).click();
  await expect.poll(async () => (await documentIn(page)).days[0].date).toBe('2026-11-16');
  expect((await documentIn(page)).days[0].items[0].details[0].text).toBe('Keep the context');
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await documentIn(page)).days[0].date).toBe('2026-11-10');
});

test('quick tomorrow keeps the full span and details across reload and export', async ({ page }) => {
  await importJournal(page, '2026-11-16\n\nTrip\n  @span: all-day through 2026-11-18\n- [ ] Pack bag\n');
  await openMove(page, 'Trip');
  await expect(page.getByRole('button', { name: 'Move Trip to today', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Move Trip to tomorrow', exact: true }).click();
  await expect.poll(async () => (await documentIn(page)).days[0].date).toBe('2026-11-17');
  expect((await documentIn(page)).days[0].items[0].span?.through).toBe('2026-11-19');
  await page.reload();
  await runCommand(page, 'Download TODO.txt');
  await expect(page.getByLabel('TODO.txt preview')).toContainText('2026-11-17\n\nTrip\n  @span: all-day through 2026-11-19\n- [ ] Pack bag');
});

test('quick moves ask for recurrence scope before changing a series', async ({ page }) => {
  await importJournal(page, '2026-11-16\n\nDaily review\n  @repeat: daily; series review\n');
  const before = await documentIn(page);
  await openMove(page, 'Daily review');
  await page.getByRole('button', { name: 'Move Daily review to tomorrow', exact: true }).click();
  const scope = page.getByRole('dialog', { name: 'Choose recurring edit scope', exact: true });
  await expect(scope).toBeVisible();
  expect(await documentIn(page)).toEqual(before);
  await scope.getByRole('button', { name: 'This item', exact: true }).click();
  await expect.poll(async () => (await documentIn(page)).days.length).toBe(2);
  const saved = await documentIn(page);
  expect(saved.days[0].items[0].repeat?.series).toBe('review');
  expect(saved.days[1].date).toBe('2026-11-17');
  expect(saved.days[1].items[0].replaces).toEqual({ series: 'review', on: '2026-11-16' });
});

test('quick tomorrow stays reachable on a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await importJournal(page, '2026-11-16\n\nPhone task\n');
  await openMove(page, 'Phone task');
  const tomorrow = page.getByRole('button', { name: 'Move Phone task to tomorrow', exact: true });
  await expect(tomorrow).toBeInViewport();
  await tomorrow.click();
  await expect.poll(async () => (await documentIn(page)).days[0].date).toBe('2026-11-17');
});
