import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

function dateOffset(days: number) {
  const date = new Date(); date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

async function confirmTodoDownload(page: Page) {
  const preview = page.getByRole('dialog', { name: 'Download TODO.txt' });
  await expect(preview).toBeVisible();
  await preview.getByRole('button', { name: 'download' }).click();
}

async function selectJournalCalendarDate(page: Page, date: string) {
  const calendar = page.getByLabel('Choose journal date');
  await calendar.getByRole('combobox', { name: 'Choose the Year' }).selectOption(date.slice(0, 4));
  await calendar.getByRole('combobox', { name: 'Choose the Month' }).selectOption(String(Number(date.slice(5, 7)) - 1));
  await calendar.locator(`.rdp-day[data-day="${date}"] button`).click();
}

async function showThirtyOneDays(page: Page) {
  await page.getByRole('button', { name: 'Choose date' }).click();
  await selectJournalCalendarDate(page, dateOffset(0));
  await selectJournalCalendarDate(page, dateOffset(30));
  await expect(page.locator('section')).toHaveCount(31);
}

test('edits a dated journal and exports a portable TODO.txt', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New daily item' }).fill('Review paper #work');
  await page.getByRole('textbox', { name: 'New daily item' }).press('Enter');
  await page.getByRole('button', { name: 'More actions for Review paper #work' }).click();
  await page.getByRole('button', { name: 'Add detail to Review paper #work' }).click();
  await page.getByRole('textbox', { name: 'New detail for Review paper #work' }).fill('send feedback');
  await page.getByRole('textbox', { name: 'New detail for Review paper #work' }).press('Enter');
  await page.getByRole('button', { name: 'Complete Review paper #work' }).click();
  await page.getByRole('button', { name: `Expand done items for ${dateOffset(0)}` }).click();
  await page.getByRole('textbox', { name: 'Edit Review paper #work' }).press('Enter');
  await page.getByRole('textbox', { name: 'New item after current item' }).fill('Call Alex');
  await page.getByRole('textbox', { name: 'New item after current item' }).press('Enter');
  await page.reload();
  await page.getByRole('button', { name: `Expand done items for ${dateOffset(0)}` }).click();
  await expect(page.getByRole('button', { name: 'Reopen Review paper #work' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Tags' }).getByText('#work')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download TODO.txt' }).first().click();
  await confirmTodoDownload(page);
  const download = await downloadPromise;
  const text = await readFile(await download.path(), 'utf8');
  expect(text).toContain(`${dateOffset(0)}\nReview paper #work\n- [x] send feedback\n\nCall Alex\n`);
  await expect(page.getByRole('button', { name: 'Start focus timer' })).toHaveCount(0);
});

test('confirms a move to Done and offers Undo for item and last-detail completion', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New daily item' }).fill('Review notes');
  await page.getByRole('textbox', { name: 'New daily item' }).press('Enter');
  await page.getByRole('button', { name: 'Complete Review notes' }).click();
  const confirmation = page.getByRole('status', { name: 'Completion confirmation' });
  await expect(confirmation).toContainText('Moved to Done: Review notes');
  await expect(page.getByRole('button', { name: `Expand done items for ${dateOffset(0)}` })).toContainText('1');
  await confirmation.getByRole('button', { name: 'Undo completion of Review notes' }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Complete Review notes' })).toBeVisible();

  await page.getByRole('button', { name: 'More actions for Review notes' }).click();
  await page.getByRole('button', { name: 'Add detail to Review notes' }).click();
  await page.getByRole('textbox', { name: 'New detail for Review notes' }).fill('Check links');
  await page.getByRole('textbox', { name: 'New detail for Review notes' }).press('Enter');
  await page.getByRole('button', { name: 'Complete detail Check links' }).click();
  await expect(confirmation).toContainText('Moved to Done: Review notes');
});

test('completion confirmation enters and exits on dismissal or timeout', async ({ page }) => {
  test.setTimeout(15000);
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New daily item' }).fill('File report');
  await page.getByRole('textbox', { name: 'New daily item' }).press('Enter');
  await page.getByRole('button', { name: 'Complete File report' }).click();
  const confirmation = page.locator('[aria-label="Completion confirmation"]');
  await expect(confirmation).toHaveAttribute('data-phase', 'visible');
  await expect(confirmation).toHaveCSS('transition-property', 'opacity, transform');
  await confirmation.getByRole('button', { name: 'Dismiss completion confirmation' }).click();
  await expect(confirmation).toHaveAttribute('data-phase', 'leaving');
  await expect(confirmation).toHaveCount(0);

  await page.getByRole('button', { name: `Expand done items for ${dateOffset(0)}` }).click();
  await page.getByRole('button', { name: 'Reopen File report' }).click();
  await page.getByRole('button', { name: 'Complete File report' }).click();
  await expect(confirmation).toHaveAttribute('data-phase', 'visible');
  await expect(confirmation).toHaveCount(0, { timeout: 7500 });
});

test('imports, reviews conflicting items, and preserves the file baseline', async ({ page }) => {
  await page.goto('/');
  const today = dateOffset(0);
  const initial = `${today}\n\nRead article #idea\n`;
  await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(initial) });
  await expect(page.getByRole('group', { name: 'Read article #idea' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Edit Read article #idea' }).fill('Read article and annotate #idea');
  await page.getByRole('textbox', { name: 'Edit Read article #idea' }).press('Enter');
  const external = `${today}\n\nRead article and share #idea\n`;
  await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(external) });
  await expect(page.getByRole('dialog', { name: 'Review TODO.txt import' }).getByText('Read article and share #idea')).toBeVisible();
  await page.getByLabel('use file').check();
  await page.getByRole('button', { name: 'apply import' }).click();
  await expect(page.getByRole('group', { name: 'Read article and share #idea' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Read article and annotate #idea' })).toHaveCount(0);
});

test('flags malformed text and unfinished work on an earlier date', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from('2021-11-31\n- orphan\n') });
  await expect(page.getByText('Invalid date: 2021-11-31')).toBeVisible();
  const yesterday = dateOffset(-1);
  await page.getByRole('textbox', { name: 'Edit imported TODO.txt' }).fill(`${yesterday}\n\nCarry forward manually\n`);
  await page.getByRole('button', { name: 'check file' }).click();
  await expect(page.getByRole('group', { name: 'Carry forward manually' })).toBeVisible();
  const notice = page.locator('span[title="1 unfinished on this day"]');
  await expect(notice).toBeVisible();
  await expect(notice.locator('svg')).toBeVisible();
  const dateHeading = page.locator(`time[datetime="${yesterday}"]`);
  const badge = (await dateHeading.boundingBox())!;
  expect((await notice.boundingBox())!.x).toBeGreaterThan(badge.x + badge.width);
  expect(Math.abs((await notice.boundingBox())!.y - (await dateHeading.boundingBox())!.y)).toBeLessThan(20);
  await expect(page.getByText('unfinished', { exact: true })).toHaveCount(0);
});

test('offers explicit import and download even when direct file access is available', async ({ page }) => {
  await page.addInitScript(() => {
    (window as Window & { showOpenFilePicker?: () => Promise<FileSystemFileHandle[]> }).showOpenFilePicker = async () => [];
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Import TODO.txt' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download TODO.txt' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open TODO.txt' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save connected TODO.txt' })).toHaveCount(0);
});

test('doctor previews narrow repairs, requires a divider choice, and leaves the source untouched', async ({ page }) => {
  const today = dateOffset(0);
  const original = `${today}\nReview notes\n\t@REPEAT: daily\n  - [ ] check links\n`;
  await page.goto('/');
  await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(original) });
  const review = page.getByRole('dialog', { name: 'Review TODO.txt import' });
  await expect(review.getByText('Check TODO.txt import')).toBeVisible();
  await expect(review.getByLabel('Original imported TODO.txt')).toContainText('\t@REPEAT: daily');
  await expect(review.getByLabel('Edit imported TODO.txt')).toHaveValue(`${today}\nReview notes\n  @repeat: daily\n- [ ] check links\n`);
  await expect(review.getByRole('button', { name: 'apply import' })).toBeDisabled();
  await review.getByRole('button', { name: 'mark this day upcoming' }).click();
  await expect(review.getByLabel('Original imported TODO.txt')).toContainText('\t@REPEAT: daily');
  await review.getByRole('button', { name: 'apply import' }).click();
  await expect(page.getByRole('group', { name: 'Review notes' }).getByRole('button', { name: 'Complete Review notes' })).toBeVisible();
});

test('doctor asks for recurrence completion date and identity before rebuilding a successor', async ({ page }) => {
  const yesterday = dateOffset(-1);
  const today = dateOffset(0);
  const original = `${yesterday}\nWater plants\n  @repeat: daily\n\n`;
  await page.goto('/');
  await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(original) });
  const review = page.getByRole('dialog', { name: 'Review TODO.txt import' });
  await expect(review.getByText(/repeats but has no completion date/)).toBeVisible();
  await review.getByLabel('Completion date for line 2').fill(yesterday);
  await review.getByRole('button', { name: 'set completion date' }).click();
  await review.getByRole('button', { name: 'start a new series here' }).click();
  await review.getByRole('button', { name: 'apply import' }).click();
  await expect(page.locator('section').filter({ has: page.locator(`time[datetime="${today}"]`) }).getByRole('group', { name: 'Water plants' })).toBeVisible();
  const promise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download TODO.txt' }).click();
  await confirmTodoDownload(page);
  const raw = await readFile(await (await promise).path(), 'utf8');
  expect(raw).toContain(`  @completed: ${yesterday}`);
  expect(raw).toMatch(/@repeat: daily; series water-plants-[\w-]+; occurrence 2/);
});

test('an invalid imported file cannot replace existing journal data', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New daily item' }).fill('Keep this item');
  await page.getByRole('textbox', { name: 'New daily item' }).press('Enter');
  await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from('2026-02-30\nMissing date\n') });
  const review = page.getByRole('dialog', { name: 'Review TODO.txt import' });
  await expect(review.getByText('Invalid date: 2026-02-30')).toBeVisible();
  await expect(review.getByRole('button', { name: 'apply import' })).toBeDisabled();
  await review.getByRole('button', { name: 'cancel' }).click();
  await page.reload();
  await expect(page.getByRole('group', { name: 'Keep this item' })).toBeVisible();
});

test('imports and exports an empty date heading without turning it into an item', async ({ page }) => {
  const day = dateOffset(0);
  await page.goto('/');
  await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(`${day}\n`) });
  await expect(page.getByRole('dialog', { name: 'Review TODO.txt import' })).toHaveCount(0);
  await page.reload();
  const promise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download TODO.txt' }).click();
  await confirmTodoDownload(page);
  expect(await readFile(await (await promise).path(), 'utf8')).toBe(`${day}\n`);
});

test('keeps mobile lines readable and keyboard controls usable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New daily item' }).waitFor();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to journal' })).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'New daily item' })).toHaveAttribute('placeholder', 'No lines yet. Add the first one below.');

  const original = 'A long line that should wrap across the narrow screen while staying one TODO.txt line #mobile';
  await page.getByRole('textbox', { name: 'New daily item' }).fill(original);
  await page.getByRole('textbox', { name: 'New daily item' }).press('Enter');
  await expect.poll(() => page.evaluate(() => document.body.scrollWidth <= window.innerWidth)).toBe(true);
  const editor = page.getByRole('textbox', { name: `Edit ${original}` });
  await expect.poll(() => editor.evaluate(element => element.scrollHeight > 44)).toBe(true);
  await editor.fill('Accidental change');
  await editor.press('Escape');
  await expect(page.getByRole('group', { name: original })).toBeVisible();

  const more = page.getByRole('button', { name: `More actions for ${original}` });
  await more.focus();
  await more.press('Enter');
  await expect(page.getByRole('button', { name: `Add detail to ${original}` })).toBeVisible();
  await more.press('Escape');
  await expect(page.getByRole('button', { name: `Add detail to ${original}` })).toHaveCount(0);

  await page.getByRole('button', { name: 'Open search' }).click();
  await page.getByRole('searchbox', { name: 'Search journal' }).fill('no such line');
  await expect(page.getByText('No lines match this search')).toBeVisible();
});

test('recovers an edit queued just before a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New daily item' }).waitFor();
  const today = dateOffset(0);
  await page.evaluate(date => {
    localStorage.setItem('jing-todo-pending-v1', JSON.stringify({
      revision: 1000000,
      document: { days: [{ date, items: [{ id: 'recovered-item', text: 'Recovered pending line', details: [], completed: false }] }] },
    }));
  }, today);
  await page.reload();
  await expect(page.getByRole('group', { name: 'Recovered pending line' })).toBeVisible();
});

test('collapses details, sorts tasks, and styles completed work', async ({ page }) => {
  const today = dateOffset(0);
  await page.goto('/');
  await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(`${today}\n\nAlpha\n- one detail\n\nBeta\n`) });
  await expect(page.getByRole('textbox', { name: 'Edit detail one detail' })).toBeVisible();
  await page.getByRole('button', { name: 'Collapse details for Alpha' }).click();
  await expect(page.getByRole('textbox', { name: 'Edit detail one detail' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand details for Alpha' }).click();
  await expect(page.getByRole('textbox', { name: 'Edit detail one detail' })).toBeVisible();

  const source = await page.getByRole('button', { name: 'Drag to reorder Beta' }).boundingBox();
  const destination = await page.getByRole('button', { name: 'Drag to reorder Alpha' }).boundingBox();
  expect(source && destination).toBeTruthy();
  await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
  await page.mouse.down();
  await page.mouse.move(destination!.x + destination!.width / 2, destination!.y + 5, { steps: 15 });
  await page.mouse.up();
  const todaySection = page.locator('section').filter({ has: page.locator(`time[datetime="${today}"]`) });
  await expect(todaySection.getByRole('group').first()).toHaveAttribute('aria-label', 'Beta');
  await page.reload();
  await expect(todaySection.getByRole('group').first()).toHaveAttribute('aria-label', 'Beta');

  await page.getByRole('button', { name: 'Complete Alpha' }).click();
  await expect(page.getByRole('button', { name: `Expand done items for ${today}` })).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: `Expand done items for ${today}` }).click();
  await expect(page.getByRole('textbox', { name: 'Edit Alpha' })).toHaveCSS('text-decoration-line', 'line-through');
  await expect(page.getByRole('textbox', { name: 'Edit detail one detail' })).toHaveCSS('text-decoration-line', 'line-through');
  await page.reload();
  await page.getByRole('button', { name: `Expand done items for ${today}` }).click();
  await expect(page.getByRole('button', { name: 'Reopen Alpha' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Complete Beta' })).toBeVisible();
});

test('shows a styled calendar and opens move dates beside the actions', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New daily item' }).fill('Calendar task');
  await page.getByRole('textbox', { name: 'New daily item' }).press('Enter');
  await page.getByRole('button', { name: 'Previous range' }).click();
  await page.getByRole('button', { name: /; go to today$/ }).click();
  const week = new Date(`${dateOffset(0)}T12:00:00`);
  const monday = dateOffset(-((week.getDay() + 6) % 7));
  await expect(page.getByRole('button', { name: `Viewing ${monday} to ${dateOffset(6 - ((week.getDay() + 6) % 7))}; go to today` })).toBeVisible();
  await page.getByRole('button', { name: 'Choose date' }).click();
  await expect(page.locator('.rdp-root')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.rdp-root')).toHaveCount(0);

  await page.getByRole('button', { name: 'More actions for Calendar task' }).click();
  await expect(page.getByRole('button', { name: 'Move Calendar task up' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Move Calendar task' }).click();
  await expect(page.locator('.rdp-root')).toBeVisible();
  const positions = await page.evaluate(() => {
    const menu = document.querySelector('[aria-label="Actions for Calendar task"]')!.getBoundingClientRect();
    const calendar = document.querySelector('.rdp-root')!.getBoundingClientRect();
    return { menuRight: menu.right, calendarLeft: calendar.left };
  });
  expect(positions.calendarLeft).toBeGreaterThan(positions.menuRight);
  await page.locator(`.rdp-day[data-day="${dateOffset(1)}"] button`).click();
  await page.getByRole('button', { name: 'Move here' }).click();
  await expect(page.locator('section').filter({ has: page.locator(`time[datetime="${dateOffset(1)}"]`) }).getByRole('group', { name: 'Calendar task' })).toBeVisible();
});

test('drags a task onto another date heading and keeps its details', async ({ page }) => {
  const today = dateOffset(0);
  const tomorrow = dateOffset(1);
  await page.setViewportSize({ width: 1280, height: 1600 });
  await page.goto('/');
  await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(`${today}\n\nTransfer me\n- carry this note\n\nStay here\n\n${tomorrow}\n\nDestination task\n`) });
  await page.getByRole('button', { name: 'Complete Transfer me' }).click();
  await expect(page.getByRole('button', { name: `Expand done items for ${today}` })).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: `Expand done items for ${today}` }).click();
  await expect(page.getByRole('button', { name: `Collapse done items for ${today}` })).toBeVisible();
  await page.waitForTimeout(220);
  const source = await page.getByRole('button', { name: 'Drag to reorder Transfer me' }).boundingBox();
  const destination = await page.locator(`[data-drop-date="${tomorrow}"]`).boundingBox();
  expect(source && destination).toBeTruthy();
  await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
  await page.mouse.down();
  await page.mouse.move(destination!.x + destination!.width / 2, destination!.y + destination!.height / 2, { steps: 20 });
  const preview = await page.locator('[aria-label="Dragging Transfer me"]').boundingBox();
  expect(preview).toBeTruthy();
  expect(preview!.y).toBeGreaterThan(source!.y + 40);
  expect(preview!.x + preview!.width).toBeLessThanOrEqual(1280);
  await page.mouse.up();
  await expect(page.locator('[aria-label="Dragging Transfer me"]')).toHaveCount(0);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const destinationSection = page.locator('section').filter({ has: page.locator(`time[datetime="${tomorrow}"]`) });
  await destinationSection.getByRole('button', { name: `Expand done items for ${tomorrow}` }).click();
  await expect(destinationSection.getByRole('group', { name: 'Transfer me' })).toBeVisible();
  await expect(destinationSection.getByRole('button', { name: 'Reopen Transfer me' })).toBeVisible();
  await expect(destinationSection.getByRole('textbox', { name: 'Edit detail carry this note' })).toBeVisible();
  await expect(page.locator('section').filter({ has: page.locator(`time[datetime="${today}"]`) }).getByRole('group', { name: 'Transfer me' })).toHaveCount(0);

  await page.locator(`[data-drop-date="${today}"]`).scrollIntoViewIfNeeded();
  const secondSource = await page.getByRole('button', { name: 'Drag to reorder Destination task' }).boundingBox();
  const secondDestination = await page.locator(`[data-drop-date="${today}"]`).boundingBox();
  expect(secondSource && secondDestination).toBeTruthy();
  await page.mouse.move(secondSource!.x + secondSource!.width / 2, secondSource!.y + secondSource!.height / 2);
  await page.mouse.down();
  await page.mouse.move(secondDestination!.x + secondDestination!.width / 2, secondDestination!.y + secondDestination!.height / 2, { steps: 20 });
  await page.mouse.up();
  const todaySection = page.locator('section').filter({ has: page.locator(`time[datetime="${today}"]`) });
  await expect(todaySection.getByRole('group', { name: 'Destination task' })).toBeVisible();
  await page.reload();
  await destinationSection.getByRole('button', { name: `Expand done items for ${tomorrow}` }).click();
  await expect(todaySection.getByRole('group', { name: 'Destination task' })).toBeVisible();
  await expect(destinationSection.getByRole('group', { name: 'Transfer me' })).toBeVisible();
});

test('dragging an item between Upcoming and Done updates every detail', async ({ page }) => {
  const today = dateOffset(0);
  await page.goto('/');
  await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(`${today}\n\nDone anchor\n\nMove me\n- [x] first\n- [ ] second\n- [ ] third\n\nOpen anchor\n`) });
  await page.getByRole('button', { name: 'Complete Done anchor' }).click();
  await page.getByRole('button', { name: `Expand done items for ${today}` }).click();

  const dragOnto = async (source: string, target: string) => {
    const from = await page.getByRole('button', { name: `Drag to reorder ${source}` }).boundingBox();
    const to = await page.getByRole('button', { name: `Drag to reorder ${target}` }).boundingBox();
    expect(from && to).toBeTruthy();
    await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
    await page.mouse.down();
    await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 20 });
    await page.mouse.up();
  };

  await dragOnto('Move me', 'Done anchor');
  const moved = page.getByRole('group', { name: 'Move me' });
  await expect(page.getByRole('status', { name: 'Completion confirmation' })).toContainText('Moved to Done: Move me');
  await expect(moved.getByRole('button', { name: 'Reopen Move me' })).toHaveAttribute('aria-description', '3 of 3 details done');
  for (const detail of ['first', 'second', 'third']) await expect(moved.getByRole('button', { name: `Reopen detail ${detail}` })).toBeVisible();

  await dragOnto('Move me', 'Open anchor');
  await expect(page.getByRole('status', { name: 'Completion confirmation' })).toHaveCount(0);
  await expect(moved.getByRole('button', { name: 'Complete Move me' })).toHaveAttribute('aria-description', '0 of 3 details done');
  for (const detail of ['first', 'second', 'third']) await expect(moved.getByRole('button', { name: `Complete detail ${detail}` })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('group', { name: 'Move me' }).getByRole('button', { name: 'Complete Move me' })).toHaveAttribute('aria-description', '0 of 3 details done');
});

test('tracks detail progress, completes the parent, and round-trips detail markers', async ({ page }) => {
  const today = dateOffset(0);
  await page.goto('/');
  await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(`${today}\n\nProgress task\n- [x] first step\n- [ ] second step\n`) });
  const parent = page.getByRole('group', { name: 'Progress task' });
  await expect(parent.getByRole('button', { name: 'Complete Progress task' })).toHaveAttribute('aria-description', '1 of 2 details done');
  await expect(parent.getByRole('button', { name: 'Collapse details for Progress task' })).toBeVisible();
  const text = parent.getByRole('textbox', { name: 'Edit Progress task' });
  const more = parent.getByRole('button', { name: 'More actions for Progress task' });
  const toggle = parent.getByRole('button', { name: 'Collapse details for Progress task' });
  const [textBox, toggleBox, moreBox] = await Promise.all([text.boundingBox(), toggle.boundingBox(), more.boundingBox()]);
  expect(toggleBox!.x).toBeGreaterThan(textBox!.x);
  expect(toggleBox!.x + toggleBox!.width).toBeLessThanOrEqual(moreBox!.x + 1);
  await page.getByRole('button', { name: `Expand done items for ${today}` }).click();
  await parent.getByRole('button', { name: 'Complete detail second step' }).click();
  await expect(parent.getByRole('button', { name: 'Reopen Progress task' })).toBeVisible();
  await expect(text).toHaveCSS('text-decoration-line', 'line-through');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download TODO.txt' }).click();
  await confirmTodoDownload(page);
  const exported = await readFile(await (await downloadPromise).path(), 'utf8');
  expect(exported).toContain('- [x] first step\n- [x] second step');
  await page.reload();
  await page.getByRole('button', { name: `Expand done items for ${today}` }).click();
  await expect(page.getByRole('button', { name: 'Reopen detail second step' })).toBeVisible();
  await page.getByRole('button', { name: 'Reopen detail second step' }).click();
  await expect(page.getByRole('button', { name: 'Complete Progress task' })).toBeVisible();
});

test('edits a time block and recurrence, creates one next item, and keeps both in TODO.txt', async ({ page }) => {
  const today = dateOffset(0);
  const next = dateOffset(3);
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New daily item' }).fill('Water plants #home');
  await page.getByRole('textbox', { name: 'New daily item' }).press('Enter');
  await page.getByRole('button', { name: 'More actions for Water plants #home' }).click();
  await page.getByRole('button', { name: 'Set time block for Water plants #home' }).click();
  await page.getByRole('dialog', { name: 'Time block for Water plants #home' }).getByLabel('Start time').fill('09:00');
  await page.getByRole('dialog', { name: 'Time block for Water plants #home' }).getByLabel('End time').fill('09:30');
  await page.getByRole('dialog', { name: 'Time block for Water plants #home' }).getByRole('button', { name: 'save' }).click();
  const current = page.getByRole('group', { name: '09:00-09:30 Water plants #home' });
  await expect(current.getByText('09:00–09:30')).toBeVisible();
  await expect(current.getByRole('textbox', { name: 'Edit 09:00-09:30 Water plants #home' })).toHaveValue('Water plants #home');
  await current.getByRole('button', { name: 'More actions for 09:00-09:30 Water plants #home' }).click();
  await page.getByRole('button', { name: 'Set repeat for 09:00-09:30 Water plants #home' }).click();
  const editor = page.getByRole('dialog', { name: 'Repeat 09:00-09:30 Water plants #home' });
  await editor.getByLabel('Repeat rule').selectOption('after');
  await editor.getByRole('spinbutton', { name: 'Repeat interval' }).fill('3');
  await editor.getByRole('button', { name: 'save' }).click();
  await expect(current.getByText('every 3 days after completion')).toBeVisible();

  await current.getByRole('button', { name: 'Complete 09:00-09:30 Water plants #home' }).click();
  const future = page.locator('section').filter({ has: page.locator(`time[datetime="${next}"]`) }).getByRole('group', { name: '09:00-09:30 Water plants #home' });
  await expect(future.getByRole('button', { name: 'Complete 09:00-09:30 Water plants #home' })).toBeVisible();
  await expect(future.getByText('every 3 days after completion')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download TODO.txt' }).click();
  await confirmTodoDownload(page);
  const raw = await readFile(await (await downloadPromise).path(), 'utf8');
  expect(raw).toContain(`${today}\n09:00-09:30 Water plants #home\n  @repeat: every 3 days after completion`);
  expect(raw).toContain(`${next}\n\n09:00-09:30 Water plants #home\n  @repeat: every 3 days after completion`);
  await page.reload();
  await expect(future).toBeVisible();
});

test('an externally completed recurring item advances once when TODO.txt is imported', async ({ page }) => {
  const today = dateOffset(0);
  const tomorrow = dateOffset(1);
  const repeat = '  @repeat: daily; series check-filter-import; occurrence 1';
  const pending = `${today}\n\nCheck filter\n${repeat}\n- [ ] inspect it\n`;
  const completed = `${today}\nCheck filter\n${repeat}\n  @completed: ${today}\n- [x] inspect it\n\n`;
  await page.goto('/');
  const importFile = page.getByLabel('Import a TODO.txt file');
  await importFile.setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(pending) });
  await importFile.setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(completed) });
  const nextDay = page.locator('section').filter({ has: page.locator(`time[datetime="${tomorrow}"]`) });
  await expect(nextDay.getByRole('group', { name: 'Check filter' }).getByRole('button', { name: 'Complete detail inspect it' })).toBeVisible();
  await importFile.setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(completed) });
  await expect(nextDay.getByRole('group', { name: 'Check filter' })).toHaveCount(1);
});

test('custom anchored recurrence counts actual items and stops after the selected count', async ({ page }) => {
  const today = dateOffset(0);
  const secondDate = dateOffset(14);
  const thirdDate = dateOffset(28);
  await page.goto('/');
  await showThirtyOneDays(page);
  await page.getByRole('textbox', { name: 'New daily item' }).fill('Check in');
  await page.getByRole('textbox', { name: 'New daily item' }).press('Enter');
  await page.getByRole('button', { name: 'More actions for Check in' }).click();
  await page.getByRole('button', { name: 'Set repeat for Check in' }).click();
  const editor = page.getByRole('dialog', { name: 'Repeat Check in' });
  await editor.getByLabel('Repeat rule').selectOption('custom');
  await editor.getByLabel('Repeat interval').fill('2');
  await editor.getByRole('radio', { name: 'after' }).check();
  await editor.getByLabel('Repeat ends after').fill('3');
  await editor.getByRole('button', { name: 'save' }).click();
  const first = page.getByRole('group', { name: 'Check in' }).first();
  await expect(first.getByText('(1/3)')).toBeVisible();
  await first.getByRole('button', { name: 'Complete Check in' }).click();
  const second = page.locator('section').filter({ has: page.locator('time[datetime="' + secondDate + '"]') }).getByRole('group', { name: 'Check in' });
  await expect(second.getByText('(2/3)')).toBeVisible();
  await second.getByRole('button', { name: 'Complete Check in' }).click();
  const third = page.locator('section').filter({ has: page.locator('time[datetime="' + thirdDate + '"]') }).getByRole('group', { name: 'Check in' });
  await expect(third.getByText('(3/3)')).toBeVisible();
  await third.getByRole('button', { name: 'Complete Check in' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download TODO.txt' }).click();
  await confirmTodoDownload(page);
  const raw = await readFile(await (await downloadPromise).path(), 'utf8');
  expect(raw).toContain('; from ' + today + '; series ');
  expect(raw).toContain('; occurrence 3; ends after 3');
  expect(raw.match(/; occurrence \d; ends after 3/g)).toHaveLength(3);
  await page.reload();
  await expect(page.locator('time[datetime="' + thirdDate + '"]')).toBeVisible();
});

test('an edited TODO.txt completion advances a custom series only once', async ({ page }) => {
  const today = dateOffset(0);
  const next = dateOffset(14);
  const weekdayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const weekday = weekdayNames[new Date(today + 'T12:00:00Z').getUTCDay()];
  const line = '  @repeat: every 2 weeks on ' + weekday + '; from ' + today + '; series imported-series; occurrence 1; ends after 2';
  const pending = today + '\n\nCheck filter\n' + line + '\n';
  const completed = today + '\nCheck filter\n' + line + '\n  @completed: ' + today + '\n\n';
  await page.goto('/');
  await showThirtyOneDays(page);
  const input = page.getByLabel('Import a TODO.txt file');
  await input.setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(pending) });
  await input.setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(completed) });
  const successor = page.locator('section').filter({ has: page.locator('time[datetime="' + next + '"]') }).getByRole('group', { name: 'Check filter' });
  await expect(successor.getByRole('button', { name: 'Complete Check filter' })).toBeVisible();
  await input.setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(completed) });
  await expect(successor).toHaveCount(1);
  const promise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download TODO.txt' }).click();
  await confirmTodoDownload(page);
  expect(await readFile(await (await promise).path(), 'utf8')).toContain('series imported-series; occurrence 2; ends after 2');
});

test('custom monthly ordinal and end date survive the repeat editor and TODO.txt', async ({ page }) => {
  const today = dateOffset(0);
  const endDate = dateOffset(100);
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New daily item' }).fill('Committee');
  await page.getByRole('textbox', { name: 'New daily item' }).press('Enter');
  await page.getByRole('button', { name: 'More actions for Committee' }).click();
  await page.getByRole('button', { name: 'Set repeat for Committee' }).click();
  let editor = page.getByRole('dialog', { name: 'Repeat Committee' });
  await editor.getByLabel('Repeat rule').selectOption('custom');
  await editor.getByLabel('Repeat unit').selectOption('months');
  await editor.getByLabel('Monthly pattern').selectOption('weekday');
  await editor.getByLabel('Monthly ordinal').selectOption('-1');
  await editor.getByLabel('Monthly weekday').selectOption('fri');
  await editor.getByRole('button', { name: /^Schedule starts:/ }).click();
  const startCalendar = editor.getByRole('group', { name: 'Choose schedule starts' });
  await expect(startCalendar).toBeVisible();
  await startCalendar.locator(`.rdp-day[data-day="${today}"] button`).click();
  await expect(startCalendar).toHaveCount(0);
  await editor.getByRole('radio', { name: 'on' }).check();
  await editor.getByRole('button', { name: /^Repeat ends on:/ }).click();
  const endCalendar = editor.getByRole('group', { name: 'Choose repeat ends on' });
  await expect(endCalendar).toBeVisible();
  await endCalendar.getByRole('combobox', { name: 'Choose the Month' }).selectOption(String(Number(endDate.slice(5, 7)) - 1));
  await endCalendar.getByRole('combobox', { name: 'Choose the Year' }).selectOption(endDate.slice(0, 4));
  await endCalendar.locator(`.rdp-day[data-day="${endDate}"] button`).click();
  await expect(endCalendar).toHaveCount(0);
  await editor.getByRole('button', { name: 'save' }).click();
  await page.getByRole('button', { name: 'More actions for Committee' }).click();
  await page.getByRole('button', { name: 'Set repeat for Committee' }).click();
  editor = page.getByRole('dialog', { name: 'Repeat Committee' });
  await expect(editor.getByLabel('Monthly ordinal')).toHaveValue('-1');
  await expect(editor.getByLabel('Monthly weekday')).toHaveValue('fri');
  await expect(editor.getByRole('button', { name: /^Repeat ends on:/ })).toContainText(endDate.slice(0, 4));
  await editor.getByRole('button', { name: 'cancel' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download TODO.txt' }).click();
  await confirmTodoDownload(page);
  const raw = await readFile(await (await downloadPromise).path(), 'utf8');
  expect(raw).toContain('every 1 month on last fri; from ' + today);
  expect(raw).toContain('; occurrence 1; ends on ' + endDate);
});

test('date-based repeat presets serialize their selected calendar pattern', async ({ page }) => {
  const today = dateOffset(0);
  const weekdayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const weekday = weekdayNames[new Date(today + 'T12:00:00Z').getUTCDay()];
  const day = Number(today.slice(8, 10));
  const ordinal = ['first', 'second', 'third', 'fourth', 'fifth'][Math.ceil(day / 7) - 1];
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New daily item' }).fill('Preset item');
  await page.getByRole('textbox', { name: 'New daily item' }).press('Enter');
  const open = async () => {
    await page.getByRole('button', { name: 'More actions for Preset item' }).click();
    await page.getByRole('button', { name: 'Set repeat for Preset item' }).click();
    return page.getByRole('dialog', { name: 'Repeat Preset item' });
  };
  const download = async () => {
    const promise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download TODO.txt' }).click();
    await confirmTodoDownload(page);
    return readFile(await (await promise).path(), 'utf8');
  };
  let editor = await open();
  await editor.getByLabel('Repeat rule').selectOption('monthlyWeekday');
  await editor.getByRole('button', { name: 'save' }).click();
  expect(await download()).toContain('every 1 month on ' + ordinal + ' ' + weekday + '; from ' + today);
  editor = await open();
  await editor.getByLabel('Repeat rule').selectOption('yearly');
  await editor.getByRole('button', { name: 'save' }).click();
  expect(await download()).toContain('every 1 year on ' + today.slice(5) + '; from ' + today);
  editor = await open();
  await editor.getByLabel('Repeat rule').selectOption('weekdays');
  await editor.getByRole('button', { name: 'save' }).click();
  expect(await download()).toContain('every 1 week on mon, tue, wed, thu, fri; from ' + today);
});

test('custom yearly recurrence controls stay reachable on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New daily item' }).fill('Annual check');
  await page.getByRole('textbox', { name: 'New daily item' }).press('Enter');
  await page.getByRole('button', { name: 'More actions for Annual check' }).click();
  await page.getByRole('button', { name: 'Set repeat for Annual check' }).click();
  const editor = page.getByRole('dialog', { name: 'Repeat Annual check' });
  await editor.getByLabel('Repeat rule').selectOption('custom');
  await editor.getByLabel('Repeat unit').selectOption('years');
  await editor.getByLabel('Yearly pattern').selectOption('weekday');
  await editor.getByLabel('Yearly ordinal').selectOption('-1');
  await editor.getByLabel('Yearly weekday').selectOption('fri');
  await editor.getByRole('button', { name: /^Schedule starts:/ }).click();
  const calendar = editor.getByRole('group', { name: 'Choose schedule starts' });
  await expect(calendar).toBeVisible();
  const calendarBox = await calendar.boundingBox();
  expect(calendarBox!.x).toBeGreaterThanOrEqual(0);
  expect(calendarBox!.x + calendarBox!.width).toBeLessThanOrEqual(375);
  await calendar.locator(`.rdp-day[data-day="${dateOffset(0)}"] button`).click();
  await expect(calendar).toHaveCount(0);
  await editor.getByRole('radio', { name: 'after' }).check();
  await editor.getByLabel('Repeat ends after').fill('3');
  const box = await editor.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  expect(box!.y + box!.height).toBeLessThanOrEqual(667);
  await editor.getByRole('button', { name: 'save' }).click();
  await expect(page.getByRole('group', { name: 'Annual check' }).getByText('last fri of')).toBeVisible();
});

test('animates detail progress wedges in both directions, including when the item moves through Done', async ({ page }) => {
  const today = dateOffset(0);
  await page.goto('/');
  await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(`${today}\n\nProgress task\n- [ ] first step\n- [ ] second step\n`) });
  const parent = page.getByRole('group', { name: 'Progress task' });
  const circle = () => parent.getByRole('button', { name: /^(Complete|Reopen) Progress task$/ }).locator('span');
  const fill = () => circle().evaluate(element => parseFloat(getComputedStyle(element).getPropertyValue('--circle-progress')));
  const isAnimating = () => circle().evaluate(element => element.getAnimations().some(animation => animation instanceof CSSTransition && animation.transitionProperty === '--circle-progress'));

  expect(await fill()).toBe(0);
  await parent.getByRole('button', { name: 'Complete detail first step' }).click();
  expect(await isAnimating()).toBe(true);
  await expect(circle()).toHaveCSS('--circle-progress', '50%');

  await parent.getByRole('button', { name: 'Reopen detail first step' }).click();
  expect(await isAnimating()).toBe(true);
  await expect(circle()).toHaveCSS('--circle-progress', '0%');

  await page.getByRole('button', { name: `Expand done items for ${today}` }).click();
  await parent.getByRole('button', { name: 'Complete detail first step' }).click();
  await expect(circle()).toHaveCSS('--circle-progress', '50%');
  await parent.getByRole('button', { name: 'Complete detail second step' }).click();
  expect(await isAnimating()).toBe(true);
  await expect(circle()).toHaveCSS('--circle-progress', '100%');

  await parent.getByRole('button', { name: 'Reopen detail second step' }).click();
  expect(await isAnimating()).toBe(true);
  await expect(circle()).toHaveCSS('--circle-progress', '50%');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await parent.getByRole('button', { name: 'Reopen detail first step' }).click();
  expect(await circle().evaluate(element => parseFloat(getComputedStyle(element).transitionDuration))).toBeLessThan(0.01);
  await expect(circle()).toHaveCSS('--circle-progress', '0%');
});

test('formats date headings independently of TODO.txt and focuses app search with Ctrl/Cmd+F', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New daily item' }).fill('Find this task');
  await page.getByRole('textbox', { name: 'New daily item' }).press('Enter');
  const today = dateOffset(0);
  await expect(page.locator(`time[datetime="${today}"]`)).toHaveText(new Date(`${today}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }));
  const previous = await page.getByRole('button', { name: 'Previous range' }).boundingBox();
  const importButton = await page.getByRole('button', { name: 'Import TODO.txt' }).boundingBox();
  const search = await page.getByRole('button', { name: 'Open search' }).boundingBox();
  expect(Math.abs(previous!.y - importButton!.y)).toBeLessThan(2);
  expect(Math.abs(previous!.y - search!.y)).toBeLessThan(2);
  expect(search!.x + search!.width).toBeLessThanOrEqual(importButton!.x);
  await page.getByRole('textbox', { name: 'Edit Find this task' }).focus();
  await page.keyboard.press('Control+f');
  await expect(page.getByRole('searchbox', { name: 'Search journal' })).toBeFocused();
  await page.getByRole('textbox', { name: 'Edit Find this task' }).focus();
  await page.keyboard.press('Meta+f');
  await expect(page.getByRole('searchbox', { name: 'Search journal' })).toBeFocused();
  await page.getByRole('button', { name: 'Hito settings' }).click();
  await page.getByLabel('Date headings').selectOption('iso');
  await page.getByRole('button', { name: 'close', exact: true }).click();
  await expect(page.locator(`time[datetime="${today}"]`)).toHaveText(today);
  await page.reload();
  await expect(page.locator(`time[datetime="${today}"]`)).toHaveText(today);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download TODO.txt' }).click();
  await confirmTodoDownload(page);
  expect(await readFile(await (await downloadPromise).path(), 'utf8')).toContain(`${today}\n\nFind this task\n`);
});

test('hides completed work by default and toggles search without browser find', async ({ page }) => {
  const today = dateOffset(0);
  await page.goto('/');
  await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(`${today}\n\nFinished task\n- [x] finished detail\n- [ ] other detail\n\nOpen task\n`) });
  await page.getByRole('button', { name: 'Complete Finished task' }).click();
  await expect(page.getByRole('button', { name: `Expand done items for ${today}` })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('group', { name: 'Finished task' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: `Expand done items for ${today}` })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('group', { name: 'Finished task' })).toHaveCount(0);
  await page.getByRole('button', { name: `Expand done items for ${today}` }).click();
  await expect(page.getByRole('group', { name: 'Finished task' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reopen Finished task' }).locator('svg')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reopen detail finished detail' }).locator('svg')).toHaveCount(0);
  await page.getByRole('button', { name: `Collapse done items for ${today}` }).click();
  await expect(page.getByRole('searchbox', { name: 'Search journal' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open search' }).click();
  await expect(page.getByRole('searchbox', { name: 'Search journal' })).toBeFocused();
  await page.getByRole('searchbox', { name: 'Search journal' }).fill('Finished task');
  await expect(page.getByRole('group', { name: 'Finished task' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search journal' }).fill('nothing matches');
  await expect(page.getByText('No lines match this search')).toBeVisible();
  await page.getByRole('button', { name: 'Close search' }).click();
  await expect(page.getByRole('group', { name: 'Open task' })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search journal' })).toHaveCount(0);
});

test('migrates a Jing journal and preferences to Hito storage', async ({ page }) => {
  const today = dateOffset(0);
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New daily item' }).waitFor();
  await page.evaluate(async date => {
    localStorage.setItem('jing-theme', 'night');
    localStorage.setItem('jing-date-format', 'iso');
    const request = indexedDB.open('jing-todo-v1', 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onupgradeneeded = () => request.result.createObjectStore('state');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite');
      tx.objectStore('state').put({ document: { days: [{ date, items: [{ id: 'legacy-task', text: 'From Jing', details: [], completed: false }] }] }, baseline: null, baselineText: null, fileHandle: null, revision: 42 }, 'current');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, today);
  await page.reload();
  await expect(page.getByRole('group', { name: 'From Jing' })).toBeVisible();
  await expect(page).toHaveTitle('Hito');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
  await expect(page.locator(`time[datetime="${today}"]`)).toHaveText(today);
  await expect.poll(() => page.evaluate(async () => {
    const request = indexedDB.open('hito-todo-v1', 1);
    const db = await new Promise<IDBDatabase>(resolve => { request.onsuccess = () => resolve(request.result); });
    const result = await new Promise<{ revision:number } | undefined>(resolve => {
      const tx = db.transaction('state', 'readonly');
      const get = tx.objectStore('state').get('current');
      get.onsuccess = () => resolve(get.result);
    });
    db.close();
    return result?.revision;
  })).toBe(42);
});

test('keeps controls usable and within the viewport across mobile and desktop widths', async ({ page }) => {
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 700 });
    await page.goto('/');
    await page.getByRole('textbox', { name: 'New daily item' }).waitFor();
    await page.getByRole('button', { name: 'Open search' }).click();
    await expect(page.getByRole('searchbox', { name: 'Search journal' })).toBeFocused();
    const searchField = await page.getByRole('searchbox', { name: 'Search journal' }).boundingBox();
    const searchIcon = await page.getByRole('button', { name: 'Close search' }).boundingBox();
    expect(searchField!.x).toBeLessThan(searchIcon!.x);
    await page.getByRole('button', { name: 'Close search' }).click();
    await page.getByRole('button', { name: 'Choose date' }).click();
    await expect(page.locator('.rdp-root')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const controlsFit = await page.evaluate(() => ['Open search', 'Choose date', 'Import TODO.txt', 'Hito settings'].every(label => {
      const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
      if (!button) return true;
      const box = button.getBoundingClientRect();
      return box.width >= 40 && box.left >= 0 && box.right <= innerWidth;
    }));
    expect(controlsFit).toBe(true);
  }
});

test('animates completion and honours reduced motion', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New daily item' }).fill('Animated task');
  await page.getByRole('textbox', { name: 'New daily item' }).press('Enter');
  await page.getByRole('button', { name: `Expand done items for ${dateOffset(0)}` }).click();
  await page.getByRole('button', { name: 'Complete Animated task' }).click();
  const strike = page.getByRole('group', { name: 'Animated task' }).locator('[data-strike]');
  await expect(strike).toBeVisible();
  expect(await strike.evaluate(element => getComputedStyle(element).animationName)).not.toBe('none');
  await page.getByRole('button', { name: 'Reopen Animated task' }).click();
  const reopeningStrike = page.getByRole('group', { name: 'Animated task' }).locator('[data-strike]');
  expect(await reopeningStrike.evaluate(element => getComputedStyle(element).animationName)).not.toBe('none');
  await expect(page.getByRole('button', { name: 'Complete Animated task' })).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Complete Animated task' }).click();
  const duration = await page.getByRole('group', { name: 'Animated task' }).locator('[data-strike]').evaluate(element => getComputedStyle(element).animationDuration);
  expect(parseFloat(duration)).toBeLessThan(0.01);
});

test('reveals the toolbar and persists expanded appearance choices', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New daily item' }).waitFor();
  const header = page.locator('header');
  await page.mouse.move(0, 500);
  await expect(header).toHaveCSS('opacity', '0');
  await page.getByRole('button', { name: 'Hito settings' }).hover();
  await expect(header).toHaveCSS('opacity', '1');
  await page.getByRole('button', { name: 'Hito settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Hito settings' });
  await expect(dialog.getByRole('heading', { name: /settings/i })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /day mode|night mode/ })).toHaveCount(0);
  await expect(dialog.getByLabel('Color scheme').locator('option')).toHaveCount(52);
  await expect(dialog.getByLabel('Font', { exact: true }).locator('option')).toHaveCount(41);
  await expect(dialog.getByLabel('TODO.txt font')).toHaveCount(0);
  await expect(dialog.getByLabel('Date headings').locator('option')).toHaveCount(20);
  await expect(dialog.getByText('The journal stays in this browser')).toHaveCount(0);
  await expect(dialog.getByText('TODO.txt always keeps')).toHaveCount(0);
  await dialog.getByLabel('Color scheme').selectOption('cat-mocha');
  await dialog.getByLabel('Font', { exact: true }).selectOption('georgia');
  await expect(page.locator('body')).toHaveCSS('font-family', /Georgia/);
  await dialog.getByLabel('Font', { exact: true }).selectOption('robotomono');
  await dialog.getByLabel('Date headings').selectOption('iso-dots');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'cat-mocha');
  await expect(page.locator('body')).toHaveCSS('font-family', /Roboto Mono/);
  const today = dateOffset(0);
  await expect(page.locator(`time[datetime="${today}"]`)).toHaveText(today.replaceAll('-', '.'));
  await dialog.getByRole('button', { name: 'close' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'cat-mocha');
  await expect(page.locator('body')).toHaveCSS('font-family', /Roboto Mono/);
  await expect(page.locator(`time[datetime="${today}"]`)).toHaveText(today.replaceAll('-', '.'));
});

test('uses the calendar to switch between the default week, one day, and a selected range', async ({ page }) => {
  const today = dateOffset(0);
  const date = new Date(`${today}T12:00:00`);
  const monday = dateOffset(-((date.getDay() + 6) % 7));
  const sunday = dateOffset(6 - ((date.getDay() + 6) % 7));
  await page.goto('/');
  await expect(page.locator('section')).toHaveCount(7);
  await expect(page.locator('section').first().locator('time')).toHaveAttribute('datetime', monday);
  await expect(page.locator('section').last().locator('time')).toHaveAttribute('datetime', sunday);
  await expect(page.getByRole('button', { name: `Viewing ${monday} to ${sunday}; go to today` })).toBeVisible();
  await page.getByRole('button', { name: 'Hito settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Hito settings' });
  await expect(settings.getByLabel('Days shown')).toHaveCount(0);
  await settings.getByRole('button', { name: 'close' }).click();
  await expect(settings).toBeHidden();
  await page.getByRole('button', { name: 'Choose date' }).click();
  const rangeToggle = page.getByRole('button', { name: 'Select date range' });
  await expect(rangeToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(`.rdp-day[data-day="${monday}"]`)).toHaveClass(/rdp-range_start/);
  await expect(page.locator(`.rdp-day[data-day="${sunday}"]`)).toHaveClass(/rdp-range_end/);
  await expect(page.getByRole('button', { name: 'apply', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'cancel', exact: true })).toHaveCount(0);
  await expect(page.getByText('Choose a day, or show its week.')).toHaveCount(0);
  await rangeToggle.click();
  await expect(rangeToggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('section')).toHaveCount(1);
  await expect(page.locator('section').first().locator('time')).toHaveAttribute('datetime', today);
  await selectJournalCalendarDate(page, dateOffset(1));
  await expect(page.locator('section').first().locator('time')).toHaveAttribute('datetime', dateOffset(1));
  await page.getByRole('button', { name: 'Choose date' }).click();
  await page.getByRole('button', { name: 'Select date range' }).click();
  await expect(page.locator('section')).toHaveCount(7);
  await selectJournalCalendarDate(page, today);
  await selectJournalCalendarDate(page, dateOffset(2));
  await expect(page.getByLabel('Choose journal date')).toHaveCount(0);
  await expect(page.locator('section')).toHaveCount(3);
  await expect(page.locator('section').first().locator('time')).toHaveAttribute('datetime', today);
  await expect(page.locator('section').last().locator('time')).toHaveAttribute('datetime', dateOffset(2));
  await expect(page.getByRole('button', { name: `Viewing ${today} to ${dateOffset(2)}; go to today` })).toBeVisible();
  await page.getByRole('button', { name: 'Next range' }).click();
  await expect(page.locator('section').first().locator('time')).toHaveAttribute('datetime', dateOffset(3));
  await page.reload();
  await expect(page.locator('section')).toHaveCount(3);
  await expect(page.locator('section').first().locator('time')).toHaveAttribute('datetime', dateOffset(3));
  await page.setViewportSize({ width: 320, height: 700 });
  await expect.poll(() => page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Choose date' }).click();
  const popup = (await page.getByLabel('Choose journal date').boundingBox())!;
  expect(popup.x).toBeGreaterThanOrEqual(0);
  expect(popup.x + popup.width).toBeLessThanOrEqual(320);
  await page.getByRole('button', { name: 'Select date range' }).click();
  await expect(page.locator('section')).toHaveCount(1);
  await expect(page.locator('section').first().locator('time')).toHaveAttribute('datetime', today);
  await page.reload();
  await expect(page.locator('section')).toHaveCount(7);
  await expect(page.getByRole('button', { name: `Viewing ${monday} to ${sunday}; go to today` })).toBeVisible();
});

test('adds items through the empty-day line and Enter on an existing item', async ({ page }) => {
  await page.goto('/');
  const emptyLine = page.getByRole('textbox', { name: 'New daily item' });
  await expect(emptyLine).toHaveAttribute('placeholder', 'No lines yet. Add the first one below.');
  await expect(page.getByRole('button', { name: 'Add daily item' })).toHaveCount(0);
  await emptyLine.fill('First item');
  await emptyLine.press('Enter');
  await expect(page.getByRole('group', { name: 'First item' })).toBeVisible();
  await expect(emptyLine).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Edit First item' }).press('Enter');
  await page.getByRole('textbox', { name: 'New item after current item' }).fill('Second item');
  await page.getByRole('textbox', { name: 'New item after current item' }).press('Enter');
  await expect(page.getByRole('group', { name: 'Second item' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'New item after current item' })).toHaveCount(0);
});

test('calendar stays above journal content and allows month and year selection', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New daily item' }).fill('Behind the calendar');
  await page.getByRole('textbox', { name: 'New daily item' }).press('Enter');
  await page.getByRole('button', { name: 'Choose date' }).click();
  const calendar = page.getByLabel('Choose journal date');
  await expect(calendar).toBeVisible();
  await calendar.getByRole('button', { name: 'Select date range' }).click();
  const above = await page.evaluate(() => {
    const popup = document.querySelector<HTMLElement>('[aria-label="Choose journal date"]')!;
    const bounds = popup.getBoundingClientRect();
    return popup.contains(document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2));
  });
  expect(above).toBe(true);
  await calendar.getByRole('combobox', { name: 'Choose the Month' }).selectOption('1');
  await calendar.getByRole('combobox', { name: 'Choose the Year' }).selectOption('2031');
  await expect(calendar.locator('.rdp-month_caption')).toContainText('February');
  await expect(calendar.locator('.rdp-month_caption')).toContainText('2031');
  await calendar.locator('.rdp-day[data-day="2031-02-20"] button').click();
  await expect(page.getByRole('button', { name: 'Go to today from 2031-02-20' })).toBeVisible();
});

test('marks unfinished calendar days and keeps existing item editing visually quiet', async ({ page }) => {
  const today = dateOffset(0);
  await page.goto('/');
  const newItem = page.getByRole('textbox', { name: 'New daily item' });
  await newItem.focus();
  const lineStyle = await newItem.evaluate(element => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, shadow: style.boxShadow, radius: style.borderRadius };
  });
  await newItem.fill('First item');
  await newItem.press('Enter');
  const editor = page.getByRole('textbox', { name: 'Edit First item' });
  await editor.focus();
  await expect(editor).toBeFocused();
  expect(await editor.evaluate(element => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, shadow: style.boxShadow, radius: style.borderRadius };
  })).toEqual(lineStyle);
  await editor.fill('Edited item');
  await editor.press('Tab');
  await expect(page.getByRole('group', { name: 'Edited item' })).toBeVisible();

  await page.getByRole('button', { name: 'Choose date' }).click();
  const day = page.locator(`.rdp-day[data-day="${today}"]`);
  await expect(day).toHaveClass(/has-unfinished/);
  await expect(day.locator('button')).toHaveAttribute('aria-label', /unfinished items/);
  expect(await day.locator('button').evaluate(element => getComputedStyle(element, '::after').content)).not.toBe('none');
  await page.getByRole('button', { name: 'Choose date' }).click();
  await page.getByRole('button', { name: 'Complete Edited item' }).click();
  await page.getByRole('button', { name: 'Choose date' }).click();
  await expect(day).not.toHaveClass(/has-unfinished/);
});

test('reveals item actions on hover and reorders details within their item', async ({ page }) => {
  const today = dateOffset(0);
  await page.goto('/');
  await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(`${today}\n\nParent task\n- first detail\n- second detail\n\nOther task\n- other detail\n`) });
  const parent = page.getByRole('group', { name: 'Parent task' });
  const grip = parent.getByRole('button', { name: 'Drag to reorder Parent task' });
  const check = parent.getByRole('button', { name: 'Complete Parent task' });
  const more = parent.getByRole('button', { name: 'More actions for Parent task' });
  const detailMore = parent.getByRole('button', { name: 'More actions for detail first detail' });
  await page.mouse.move(0, 0);
  for (const control of [grip, check, more, detailMore]) await expect(control).toHaveCSS('opacity', '0');
  await parent.hover();
  for (const control of [grip, check, more]) await expect(control).toHaveCSS('opacity', '1');
  await parent.getByRole('textbox', { name: 'Edit detail first detail' }).hover();
  await expect(detailMore).toHaveCSS('opacity', '1');
  const source = await parent.getByRole('button', { name: 'Drag to reorder detail second detail' }).boundingBox();
  const target = await parent.getByRole('button', { name: 'Drag to reorder detail first detail' }).boundingBox();
  expect(source && target).toBeTruthy();
  await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
  await page.mouse.down();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 14 });
  await page.mouse.up();
  const detailOrder = () => parent.getByRole('textbox', { name: /^Edit detail / }).evaluateAll(elements => elements.map(element => (element as HTMLTextAreaElement).value));
  await expect.poll(detailOrder).toEqual(['second detail', 'first detail']);
  const downloadButton = page.getByRole('button', { name: 'Download TODO.txt' });
  await downloadButton.hover();
  await expect(page.locator('header')).toHaveCSS('opacity', '1');
  const downloadPromise = page.waitForEvent('download');
  await downloadButton.click();
  await confirmTodoDownload(page);
  await expect(page.getByRole('status').getByText('TODO.txt downloaded.')).toBeVisible({ timeout: 3000 });
  const exported = await readFile(await (await downloadPromise).path(), 'utf8');
  expect(exported).toContain('Parent task\n- [ ] second detail\n- [ ] first detail');
  expect(exported).toContain('Other task\n- [ ] other detail');
  await page.reload();
  await expect.poll(detailOrder).toEqual(['second detail', 'first detail']);
});

test('creates siblings with Enter and promotes or demotes through row menus', async ({ page }) => {
  const today = dateOffset(0);
  await page.goto('/');
  await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(`${today}\n\nParent\n- first\n- [x] second\n\nFollowing\n`) });
  const parent = page.getByRole('group', { name: 'Parent' });
  await expect(parent.getByRole('button', { name: 'Collapse details for Parent' })).toContainText('1/2');
  const chevron = parent.getByRole('button', { name: 'Collapse details for Parent' }).locator('svg');
  expect(parseFloat(await chevron.evaluate(element => getComputedStyle(element).transitionDuration))).toBeGreaterThan(0);
  await parent.getByRole('textbox', { name: 'Edit detail first' }).press('Enter');
  await page.getByRole('textbox', { name: 'New detail for Parent' }).fill('between');
  await page.getByRole('textbox', { name: 'New detail for Parent' }).press('Enter');
  await expect.poll(() => parent.getByRole('textbox', { name: /^Edit detail / }).evaluateAll(elements => elements.map(element => (element as HTMLTextAreaElement).value))).toEqual(['first', 'between', 'second']);
  await parent.getByRole('button', { name: 'More actions for detail between' }).click();
  await page.getByRole('button', { name: 'Make detail between an item' }).click();
  await expect(page.getByRole('group', { name: 'between' })).toBeVisible();
  await page.getByRole('button', { name: 'More actions for between', exact: true }).click();
  await page.getByRole('button', { name: 'Make between a detail' }).click();
  await page.getByRole('button', { name: 'Make between a detail of Parent' }).click();
  await expect(parent.getByRole('textbox', { name: 'Edit detail between' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'between' })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Edit Following' }).press('Enter');
  await page.getByRole('textbox', { name: 'New item after current item' }).fill('Next sibling');
  await page.getByRole('textbox', { name: 'New item after current item' }).press('Enter');
  await expect(page.getByRole('group', { name: 'Next sibling' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Edit Following' }).press('Enter');
  await page.getByRole('textbox', { name: 'New item after current item' }).fill('Saved on blur');
  await page.locator(`time[datetime="${today}"]`).click();
  await expect(page.getByRole('group', { name: 'Saved on blur' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('group', { name: 'Next sibling' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Saved on blur' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Parent' }).getByRole('textbox', { name: 'Edit detail between' })).toBeVisible();
  await page.getByRole('group', { name: 'Parent' }).getByRole('button', { name: 'More actions for detail between' }).click();
  await expect(page.getByRole('button', { name: 'Delete detail between' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete detail between' }).click();
  await expect(page.getByRole('textbox', { name: 'Edit detail between' })).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('textbox', { name: 'Edit detail between' })).toBeVisible();
});

test('make detail can choose a later item on the same date and preserves the choice in TODO.txt', async ({ page }) => {
  const today = dateOffset(0);
  await page.goto('/');
  await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(`${today}\n\nFirst\nSecond\nThird\n`) });
  await page.getByRole('button', { name: 'More actions for First' }).click();
  await page.getByRole('button', { name: 'Make First a detail' }).click();
  await expect(page.getByRole('button', { name: 'Make First a detail of First' })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Find parent item' }).fill('Third');
  await page.getByRole('button', { name: 'Make First a detail of Third' }).click();
  await expect(page.getByRole('group', { name: 'First' })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Third' }).getByRole('textbox', { name: 'Edit detail First' })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download TODO.txt' }).first().click();
  await confirmTodoDownload(page);
  const exported = await readFile(await (await downloadPromise).path(), 'utf8');
  expect(exported).toContain('Third\n- [ ] First');
  await page.reload();
  await expect(page.getByRole('group', { name: 'Third' }).getByRole('textbox', { name: 'Edit detail First' })).toBeVisible();
});

test('undoes and redoes journal actions with Ctrl and Cmd while editing', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New daily item' }).fill('Undo me');
  await page.getByRole('textbox', { name: 'New daily item' }).press('Enter');
  const editor = page.getByRole('textbox', { name: 'Edit Undo me' });
  await editor.fill('Changed');
  await editor.press('Control+z');
  await expect(page.getByRole('group', { name: 'Undo me' })).toBeVisible();
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByRole('group', { name: 'Changed' })).toBeVisible();
  await page.getByRole('button', { name: 'Complete Changed' }).click();
  await expect(page.getByRole('button', { name: `Expand done items for ${dateOffset(0)}` })).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Meta+z');
  await expect(page.getByRole('button', { name: 'Complete Changed' })).toBeVisible();
  await page.keyboard.press('Meta+Shift+z');
  await page.getByRole('button', { name: `Expand done items for ${dateOffset(0)}` }).click();
  await expect(page.getByRole('button', { name: 'Reopen Changed' })).toBeVisible();
});

test('plays history transitions and skips them when reduced motion is requested', async ({ page }) => {
  await page.goto('/');
  test.skip(!(await page.evaluate(() => typeof document.startViewTransition === 'function')), 'View transitions are unavailable in this browser');
  await page.getByRole('textbox', { name: 'New daily item' }).fill('Before');
  await page.getByRole('textbox', { name: 'New daily item' }).press('Enter');
  await page.evaluate(() => {
    const original = document.startViewTransition.bind(document);
    const replayWindow = window as Window & { __replays?: ViewTransition[] };
    replayWindow.__replays = [];
    document.startViewTransition = update => {
      const transition = original(update);
      replayWindow.__replays!.push(transition);
      return transition;
    };
  });
  const editor = page.getByRole('textbox', { name: 'Edit Before' });
  await editor.fill('After');
  await editor.press('Control+z');
  await expect(page.getByRole('group', { name: 'Before' })).toBeVisible();
  const duration = await page.evaluate(async () => {
    const replay = (window as Window & { __replays?: ViewTransition[] }).__replays!.at(-1)!;
    await replay.ready;
    const row = document.querySelector<HTMLElement>('[data-transition-id]')!;
    const name = `hito-item-${row.dataset.transitionId!.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    return parseFloat(getComputedStyle(document.documentElement, `::view-transition-group(${name})`).animationDuration);
  });
  expect(duration).toBeGreaterThan(0.1);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByRole('group', { name: 'After' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as Window & { __replays?: ViewTransition[] }).__replays!.length)).toBe(2);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('group', { name: 'Before' })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __replays?: ViewTransition[] }).__replays!.length)).toBe(2);
});

test('animates undo in browsers without view transitions', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => Object.defineProperty(document, 'startViewTransition', { configurable: true, value: undefined }));
  await page.getByRole('textbox', { name: 'New daily item' }).fill('Fallback before');
  await page.getByRole('textbox', { name: 'New daily item' }).press('Enter');
  const editor = page.getByRole('textbox', { name: 'Edit Fallback before' });
  await editor.fill('Fallback after');
  await editor.press('Control+z');
  const row = page.getByRole('group', { name: 'Fallback before' });
  await expect(row).toBeVisible();
  const durations = await row.evaluate(element => element.getAnimations().map(animation => animation.effect?.getTiming().duration));
  expect(durations).toContain(220);
  await row.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByRole('group', { name: 'Fallback after' })).toBeVisible();
  expect(await page.getByRole('group', { name: 'Fallback after' }).evaluate(element => element.getAnimations().length)).toBe(0);
});

test('keeps rapid consecutive undo and redo actions in order', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New daily item' }).fill('First version');
  await page.getByRole('textbox', { name: 'New daily item' }).press('Enter');
  await page.getByRole('textbox', { name: 'Edit First version' }).fill('Second version');
  await page.getByRole('textbox', { name: 'Edit First version' }).press('Tab');
  await page.getByRole('textbox', { name: 'Edit Second version' }).fill('Third version');
  await page.getByRole('textbox', { name: 'Edit Second version' }).press('Tab');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('group', { name: 'First version' })).toBeVisible();
  await page.keyboard.press('Control+Shift+z');
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByRole('group', { name: 'Third version' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('group', { name: 'Third version' })).toBeVisible();
});

test('searches a large journal and keeps edits responsive', async ({ page }) => {
  test.setTimeout(60000);
  const today = dateOffset(0);
  const lines = Array.from({ length: 1200 }, (_, index) => `Task ${String(index).padStart(4, '0')} ${index === 1199 ? 'unique-needle' : 'ordinary'}`);
  await page.goto('/');
  await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(`${today}\n\n${lines.join('\n\n')}\n`) });
  await expect(page.getByRole('group', { name: lines[1199] })).toBeVisible({ timeout: 20000 });
  const unfilteredEditStart = Date.now();
  await page.getByRole('button', { name: `Complete ${lines[1199]}` }).click();
  await expect(page.getByRole('button', { name: `Expand done items for ${today}` })).toContainText('1');
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('button', { name: `Complete ${lines[1199]}` })).toBeVisible();
  const unfilteredEditMs = Date.now() - unfilteredEditStart;
  await page.getByRole('button', { name: 'Open search' }).click();
  const searchStart = Date.now();
  await page.getByRole('searchbox', { name: 'Search journal' }).fill('unique-needle');
  await expect(page.getByRole('group', { name: lines[1199] })).toBeVisible();
  await expect(page.getByRole('group', { name: lines[0] })).toHaveCount(0);
  const searchMs = Date.now() - searchStart;
  const editStart = Date.now();
  await page.getByRole('button', { name: `Complete ${lines[1199]}` }).click();
  await expect(page.getByRole('button', { name: `Reopen ${lines[1199]}` })).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('button', { name: `Complete ${lines[1199]}` })).toBeVisible();
  const editMs = Date.now() - editStart;
  console.log(`Large journal (1200 items): unfiltered complete + undo ${unfilteredEditMs}ms, search ${searchMs}ms, filtered complete + undo ${editMs}ms`);
  expect(unfilteredEditMs).toBeLessThan(5000);
  expect(searchMs).toBeLessThan(5000);
  expect(editMs).toBeLessThan(5000);
});

test('TODO.txt preview shows the complete portable file before download', async ({ page }) => {
  const today = dateOffset(0);
  const tomorrow = dateOffset(1);
  const initial = `${today}\n\n09:00-09:30 Plan #work\n  @repeat: weekly on mon\n- [ ] Outline\n\n${tomorrow}\n\nFollow up\n`;
  await page.goto('/');
  await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(initial) });
  await expect(page.getByRole('button', { name: 'Show raw TODO.txt' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Download TODO.txt' }).click();
  const dialog = page.getByRole('dialog', { name: 'Download TODO.txt' });
  const preview = dialog.getByLabel('TODO.txt preview');
  await expect(preview).toContainText('09:00-09:30 Plan #work');
  await expect(preview).toContainText('  @repeat: weekly on mon');
  await expect(preview).toContainText('- [ ] Outline');
  await expect(preview).toContainText(tomorrow);
  await expect(dialog.getByLabel('File name')).toHaveValue('TODO.txt');
  await expect(dialog.getByLabel('Line endings')).toHaveValue('lf');
  const previewText = await preview.textContent();
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'download' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('TODO.txt');
  expect(await readFile(await download.path(), 'utf8')).toBe(previewText);
  await expect(page.getByRole('group', { name: '09:00-09:30 Plan #work' })).toBeVisible();
});

test('preview options preserve TODO.txt meaning and reset after closing', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New daily item' }).fill('Keep this task');
  await page.getByRole('textbox', { name: 'New daily item' }).press('Enter');
  await page.getByRole('button', { name: 'Download TODO.txt' }).click();
  const dialog = page.getByRole('dialog', { name: 'Download TODO.txt' });
  const preview = dialog.getByLabel('TODO.txt preview');
  const canonical = await preview.textContent();
  await dialog.getByLabel('File name').fill('My tasks');
  await dialog.getByLabel('Line endings').selectOption('crlf');
  await dialog.getByRole('checkbox', { name: 'Wrap long lines in preview' }).uncheck();
  await expect(preview).toHaveCSS('white-space', 'pre');
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'download' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('My tasks.txt');
  const text = await readFile(await download.path(), 'utf8');
  expect(text).toContain('\r\n');
  expect(text.replace(/\r\n/g, '\n')).toBe(canonical);
  await page.getByRole('button', { name: 'Download TODO.txt' }).click();
  await expect(dialog.getByLabel('File name')).toHaveValue('TODO.txt');
  await expect(dialog.getByLabel('Line endings')).toHaveValue('lf');
  await expect(dialog.getByRole('checkbox', { name: 'Wrap long lines in preview' })).toBeChecked();
  await dialog.getByRole('button', { name: 'cancel' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('group', { name: 'Keep this task' })).toBeVisible();
});

test('a large TODO.txt preview remains usable on a phone', async ({ page }) => {
  const today = dateOffset(0);
  const text = `${today}\n\n${Array.from({ length: 1200 }, (_, index) => `Task ${index}`).join('\n')}\n`;
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/');
  await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(text) });
  await page.getByRole('button', { name: 'Download TODO.txt' }).click();
  const dialog = page.getByRole('dialog', { name: 'Download TODO.txt' });
  await expect(dialog.getByLabel('TODO.txt preview')).toContainText('Task 1199');
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  expect(box!.y + box!.height).toBeLessThanOrEqual(667);
  await dialog.getByRole('button', { name: 'cancel' }).click();
});

test('an unfinished draft from the removed editor can still be downloaded', async ({ page }) => {
  const draft = '2026-02-30\nUnfinished edit\n';
  await page.addInitScript(value => sessionStorage.setItem('hito-raw-draft-v1', value), draft);
  await page.goto('/');
  await expect(page.getByText('An unfinished TODO.txt draft from the old editor is available.')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'download draft' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('TODO-draft.txt');
  expect(await readFile(await download.path(), 'utf8')).toBe(draft);
  await expect(page.getByRole('button', { name: 'download draft' })).toHaveCount(0);
});
