import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

function dateOffset(days: number) {
  const date = new Date(); date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
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
  await page.getByRole('textbox', { name: 'New daily item' }).fill('Call Alex');
  await page.getByRole('textbox', { name: 'New daily item' }).press('Enter');
  await page.reload();
  await page.getByRole('button', { name: `Expand done items for ${dateOffset(0)}` }).click();
  await expect(page.getByRole('button', { name: 'Reopen Review paper #work' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Tags' }).getByText('#work')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download TODO.txt' }).first().click();
  const download = await downloadPromise;
  const text = await readFile(await download.path(), 'utf8');
  expect(text).toContain(`${dateOffset(0)}\nReview paper #work\n- [x] send feedback\n\nCall Alex\n`);
  await expect(page.getByRole('button', { name: 'Start focus timer' })).toHaveCount(0);
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
  await expect(page.getByText('1 unfinished on this day')).toBeVisible();
});

test('opens and explicitly saves a connected text file when direct access is available', async ({ page }) => {
  const today = dateOffset(0);
  await page.addInitScript((date) => {
    (window as Window & { showOpenFilePicker?: () => Promise<FileSystemFileHandle[]> }).showOpenFilePicker = async () => {
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle('TODO.txt', { create: true });
      if ((await handle.getFile()).size === 0) {
        const writable = await handle.createWritable();
        await writable.write(`${date}\n\nConnected item\n`);
        await writable.close();
      }
      return [handle];
    };
  }, today);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open TODO.txt' }).click();
  await expect(page.getByRole('group', { name: 'Connected item' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Edit Connected item' }).fill('Updated connected item');
  await page.getByRole('textbox', { name: 'Edit Connected item' }).press('Enter');
  await page.getByRole('button', { name: 'Save connected TODO.txt' }).click();
  await expect(page.getByRole('status').getByText('Saved TODO.txt.')).toBeVisible();
  const saved = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    return (await (await root.getFileHandle('TODO.txt')).getFile()).text();
  });
  expect(saved).toContain('Updated connected item');

  await page.getByRole('textbox', { name: 'Edit Updated connected item' }).fill('Local follow-up');
  await page.getByRole('textbox', { name: 'Edit Updated connected item' }).press('Enter');
  await page.evaluate(async (date) => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle('TODO.txt');
    const writable = await handle.createWritable();
    await writable.write(`${date}\n\nExternal follow-up\n`);
    await writable.close();
  }, today);
  await page.getByRole('button', { name: 'Save connected TODO.txt' }).click();
  await expect(page.getByRole('dialog', { name: 'Review TODO.txt import' }).getByText('External follow-up')).toBeVisible();
  await page.getByLabel('keep both').check();
  await page.getByRole('button', { name: 'merge and save' }).click();
  await expect(page.getByRole('dialog', { name: 'Review TODO.txt import' })).toBeHidden();
  const merged = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    return (await (await root.getFileHandle('TODO.txt')).getFile()).text();
  });
  expect(merged).toContain('Local follow-up');
  expect(merged).toContain('External follow-up');
});

test('keeps mobile lines readable and keyboard controls usable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New daily item' }).waitFor();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to journal' })).toBeFocused();
  await expect(page.getByText('No lines yet. Add the first one below.')).toBeVisible();

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
  await expect(page.getByText('No lines match this search.')).toBeVisible();
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
  await expect(page.locator('section').first().getByRole('group').first()).toHaveAttribute('aria-label', 'Beta');
  await page.reload();
  await expect(page.locator('section').first().getByRole('group').first()).toHaveAttribute('aria-label', 'Beta');

  await page.getByRole('button', { name: 'Complete Alpha' }).click();
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
  await page.getByRole('button', { name: 'Previous day' }).click();
  await page.getByRole('button', { name: /^Go to today from / }).click();
  await expect(page.getByRole('button', { name: `Go to today from ${dateOffset(0)}` })).toBeVisible();
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
  await page.goto('/');
  await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(`${today}\n\nTransfer me\n- carry this note\n\nStay here\n\n${tomorrow}\n\nDestination task\n`) });
  await page.getByRole('button', { name: 'Complete Transfer me' }).click();
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
  const destinationSection = page.locator('section').filter({ has: page.locator(`time[datetime="${tomorrow}"]`) });
  if (await destinationSection.getByRole('button', { name: `Expand done items for ${tomorrow}` }).isVisible()) await destinationSection.getByRole('button', { name: `Expand done items for ${tomorrow}` }).click();
  await expect(destinationSection.getByRole('group', { name: 'Transfer me' })).toBeVisible();
  await expect(destinationSection.getByRole('button', { name: 'Reopen Transfer me' })).toBeVisible();
  await expect(destinationSection.getByRole('textbox', { name: 'Edit detail carry this note' })).toBeVisible();
  await expect(page.locator('section').filter({ has: page.locator(`time[datetime="${today}"]`) }).getByRole('group', { name: 'Transfer me' })).toHaveCount(0);

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
  await parent.getByRole('button', { name: 'Complete detail second step' }).click();
  await expect(parent.getByRole('button', { name: 'Reopen Progress task' })).toBeVisible();
  await expect(text).toHaveCSS('text-decoration-line', 'line-through');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download TODO.txt' }).click();
  const exported = await readFile(await (await downloadPromise).path(), 'utf8');
  expect(exported).toContain('- [x] first step\n- [x] second step');
  await page.reload();
  await page.getByRole('button', { name: `Expand done items for ${today}` }).click();
  await expect(page.getByRole('button', { name: 'Reopen detail second step' })).toBeVisible();
  await page.getByRole('button', { name: 'Reopen detail second step' }).click();
  await expect(page.getByRole('button', { name: 'Complete Progress task' })).toBeVisible();
});

test('formats date headings independently of TODO.txt and focuses app search with Ctrl/Cmd+F', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New daily item' }).fill('Find this task');
  await page.getByRole('textbox', { name: 'New daily item' }).press('Enter');
  const today = dateOffset(0);
  await expect(page.locator(`time[datetime="${today}"]`)).toHaveText(new Date(`${today}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }));
  const previous = await page.getByRole('button', { name: 'Previous day' }).boundingBox();
  const importButton = await page.getByRole('button', { name: 'Import TODO.txt' }).boundingBox();
  const search = await page.getByRole('button', { name: 'Open search' }).boundingBox();
  expect(Math.abs(previous!.y - importButton!.y)).toBeLessThan(2);
  expect(Math.abs(previous!.y - search!.y)).toBeLessThan(2);
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
  expect(await readFile(await (await downloadPromise).path(), 'utf8')).toContain(`${today}\n\nFind this task\n`);
});

test('hides completed work by default and toggles search without browser find', async ({ page }) => {
  const today = dateOffset(0);
  await page.goto('/');
  await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(`${today}\n\nFinished task\n- [x] finished detail\n- [ ] other detail\n\nOpen task\n`) });
  await page.getByRole('button', { name: 'Complete Finished task' }).click();
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
  await expect(page.getByText('No lines match this search.')).toBeVisible();
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
    await page.getByRole('button', { name: 'Choose date' }).click();
    await expect(page.locator('.rdp-root')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const controlsFit = await page.evaluate(() => ['Open search', 'Close search', 'Choose date', 'Import TODO.txt', 'Hito settings'].every(label => {
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
  await page.getByRole('button', { name: 'Complete Animated task' }).click();
  const strike = page.getByRole('group', { name: 'Animated task' }).locator('[data-strike]');
  await expect(strike).toBeVisible();
  expect(await strike.evaluate(element => getComputedStyle(element).animationName)).not.toBe('none');
  await page.getByRole('button', { name: 'Reopen Animated task' }).click();
  await expect(page.getByRole('button', { name: 'Complete Animated task' })).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Complete Animated task' }).click();
  const duration = await page.getByRole('group', { name: 'Animated task' }).locator('[data-strike]').evaluate(element => getComputedStyle(element).animationDuration);
  expect(parseFloat(duration)).toBeLessThan(0.01);
});
