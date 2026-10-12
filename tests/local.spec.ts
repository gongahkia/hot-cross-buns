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
  await expect(page.getByRole('button', { name: 'Reopen Review paper #work' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Tags' }).getByText('#work')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download TODO.txt' }).first().click();
  const download = await downloadPromise;
  const text = await readFile(await download.path(), 'utf8');
  expect(text).toContain(`${dateOffset(0)}\nReview paper #work\n- send feedback\n\nCall Alex\n`);
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

  await page.getByRole('searchbox', { name: 'Search journal' }).fill('no such line');
  await expect(page.getByText('No lines match this search.')).toBeVisible();
});
