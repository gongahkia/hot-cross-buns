import { expect, test } from '@playwright/test';
import { openCommands, runCommand } from './commands';
import { readFile } from 'node:fs/promises';

test('the single launcher exposes only the five current toolbar commands', async ({ page }) => {
  await page.goto('/');
  const header = page.locator('header');
  for (const name of ['Open search', 'Import TODO.txt', 'Download TODO.txt', 'Open view in browser window', 'Hot Cross Buns settings']) {
    await expect(header.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  await expect(header.getByRole('button', { name: 'Choose date', exact: true })).toBeVisible();
  const palette = await openCommands(page);
  expect(await palette.getByRole('option').allTextContents()).toEqual([
    expect.stringContaining('Search journal'), 'Import TODO.txt', 'Download TODO.txt', 'Open view in browser window', 'Settings',
  ]);
  await expect(palette.getByRole('combobox', { name: 'Filter commands', exact: true })).toBeFocused();
  await expect(palette.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
});

test('filtering supports aliases, empty results and a fresh query on reopen', async ({ page }) => {
  await page.goto('/');
  const palette = await openCommands(page);
  const input = palette.getByRole('combobox', { name: 'Filter commands', exact: true });
  await input.fill('  EXPORT  ');
  await expect(palette.getByRole('option')).toHaveCount(1);
  await expect(palette.getByRole('option')).toHaveText('Download TODO.txt');
  await input.fill('Google Calendar');
  await expect(palette.getByRole('option')).toHaveCount(0);
  await expect(palette.getByRole('status')).toHaveText('No matching commands.');
  await expect(input).not.toHaveAttribute('aria-activedescendant', /.+/);
  await input.press('Enter');
  await expect(palette).toBeVisible();
  await input.press('Escape');
  await expect(palette).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open command palette', exact: true })).toBeFocused();
  await openCommands(page);
  await expect(input).toHaveValue('');
  await expect(palette.getByRole('option')).toHaveCount(5);
  await page.mouse.click(2, 2);
  await expect(palette).toBeHidden();
});

test('Ctrl K, arrows, Home, End and Enter hand off to settings with focus', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open command palette', exact: true }).waitFor();
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
  const input = palette.getByRole('combobox', { name: 'Filter commands', exact: true });
  await expect(input).toBeFocused();
  await input.press('ArrowDown');
  await expect(palette.getByRole('option', { name: 'Import TODO.txt', exact: true })).toHaveAttribute('aria-selected', 'true');
  await input.press('Home');
  await expect(palette.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await input.press('End');
  const settings = palette.getByRole('option', { name: 'Settings', exact: true });
  expect(await input.getAttribute('aria-activedescendant')).toBe(await settings.getAttribute('id'));
  await input.press('Enter');
  await expect(palette).toBeHidden();
  const dialog = page.getByRole('dialog', { name: 'Hot Cross Buns settings', exact: true });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await expect(page.locator('dialog[open]')).toHaveCount(1);
  await page.keyboard.press('Control+k');
  await expect(palette).toBeHidden();
  await dialog.getByRole('button', { name: 'close', exact: true }).click();
  await expect(dialog).toHaveAttribute('data-state', 'closed');
  await page.keyboard.press('Meta+k');
  await expect(input).toBeFocused();
});

test('search receives focus, retains its filters and still supports Ctrl F', async ({ page }) => {
  await page.goto('/');
  await runCommand(page, 'Open search');
  const input = page.getByRole('searchbox', { name: 'Search journal', exact: true });
  await expect(input).toBeFocused();
  await input.fill('A search');
  await page.getByRole('button', { name: 'Open items', exact: true }).click();
  await runCommand(page, 'Close search');
  await expect(input).toHaveCount(0);
  await page.keyboard.press('Control+f');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('');
  await expect(page.getByRole('button', { name: 'All statuses', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await input.press('Escape');
  await expect(page.getByRole('button', { name: 'Open command palette', exact: true })).toBeFocused();
});

test('import opens the real file chooser and download preserves the whole journal', async ({ page }) => {
  await page.goto('/');
  const choose = page.waitForEvent('filechooser');
  await runCommand(page, 'Import TODO.txt');
  await (await choose).setFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from('2026-11-16\n\nPalette import\n- [ ] Keep this detail\n') });
  await expect(page.getByRole('status').filter({ hasText: 'TODO.txt imported.' })).toBeVisible();
  await runCommand(page, 'Download TODO.txt');
  const preview = page.getByRole('dialog', { name: 'Download TODO.txt', exact: true });
  await expect(preview.getByLabel('TODO.txt preview')).toContainText('Palette import');
  await expect(page.locator('dialog[open]')).toHaveCount(1);
  const download = page.waitForEvent('download');
  await preview.getByRole('button', { name: 'download', exact: true }).click();
  const file = await download;
  expect(await readFile((await file.path())!, 'utf8')).toContain('Palette import\n- [ ] Keep this detail');
});

test('scratchpad popouts retain browser activation and their limited commands', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Scratchpad', exact: true }).click();
  const palette = await openCommands(page);
  await expect(palette.getByRole('option')).toHaveText(['Open view in browser window', 'Settings']);
  const pending = page.waitForEvent('popup');
  await palette.getByRole('option', { name: 'Open view in browser window', exact: true }).click();
  const popup = await pending;
  await expect(popup.getByRole('textbox', { name: 'Scratchpad text', exact: true })).toBeVisible();
  const popoutCommands = await openCommands(popup);
  await expect(popoutCommands.getByRole('option')).toHaveText(['Settings']);
  await popup.close();
});

test('palette text editing and composition do not trigger journal undo or commands', async ({ page }) => {
  await page.goto('/');
  const add = page.getByRole('textbox', { name: 'New daily item', exact: true });
  await add.fill('Keep the journal'); await add.press('Enter');
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
  const input = palette.getByRole('combobox', { name: 'Filter commands', exact: true });
  await input.pressSequentially('download');
  await input.press('Control+z');
  await expect(input).not.toHaveValue('download');
  await input.fill('download');
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true });
  await expect(palette).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Download TODO.txt', exact: true })).toBeHidden();
  await expect(page.getByRole('group', { name: 'Keep the journal', exact: true })).toBeVisible();
  await input.press('Escape');
  await expect(palette).toHaveAttribute('data-state', 'closed');
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('group', { name: 'Keep the journal', exact: true })).toHaveCount(0);
});

test('rapid close and reopen cancels the previous exit and keeps focus inside', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open command palette', exact: true }).waitFor();
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
  const input = palette.getByRole('combobox', { name: 'Filter commands', exact: true });
  await input.fill('export');
  await input.press('Escape');
  await page.keyboard.press('Control+k');
  await expect(input).toHaveValue('');
  await page.waitForTimeout(250);
  await expect(palette).toBeVisible();
  await expect(input).toBeFocused();
  await input.press('Tab');
  await expect(palette.getByRole('button', { name: 'Close command palette', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(input).toBeFocused();
  await input.press('Shift+Tab');
  await expect(palette.getByRole('button', { name: 'Close command palette', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(input).toBeFocused();
});

test('the historical scale and fade animate and the smooth caret resumes after entry', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New daily item', exact: true }).waitFor();
  await page.evaluate(() => {
    const dialog = document.querySelector<HTMLDialogElement>('dialog[data-command-palette]')!;
    const control = Object.assign(window, { paletteScales: [] as Array<{ scale: number; duration: number }> });
    dialog.addEventListener('transitionrun', event => {
      if ((event as TransitionEvent).propertyName !== 'transform') return;
      const animation = dialog.getAnimations().find(item => item instanceof CSSTransition && item.transitionProperty === 'transform')!;
      animation.pause(); animation.currentTime = 100;
      control.paletteScales.push({ scale: new DOMMatrixReadOnly(getComputedStyle(dialog).transform).a, duration: Number(animation.effect!.getComputedTiming().duration) });
      animation.finish();
    });
  });
  const palette = await openCommands(page);
  await expect.poll(() => page.evaluate(() => (Reflect.get(window, 'paletteScales') as unknown[]).length)).toBe(1);
  const samples = await page.evaluate(() => Reflect.get(window, 'paletteScales')) as Array<{ scale: number; duration: number }>;
  expect(samples[0].duration).toBe(200);
  expect(samples[0].scale).toBeGreaterThan(.95); expect(samples[0].scale).toBeLessThan(1);
  await expect(palette.getByRole('combobox', { name: 'Filter commands', exact: true })).toHaveAttribute('data-smooth-caret', 'true');
  await palette.press('Escape');
  await expect(palette).toBeHidden();
  await expect.poll(() => page.evaluate(() => (Reflect.get(window, 'paletteScales') as unknown[]).length)).toBe(2);
});

test('the palette fits phone screens and shortened visual viewports', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/');
  const palette = await openCommands(page);
  await expect(palette.getByRole('option').last()).toBeInViewport();
  await page.setViewportSize({ width: 667, height: 260 });
  const input = palette.getByRole('combobox', { name: 'Filter commands', exact: true });
  await expect(input).toBeInViewport();
  await expect(palette.getByRole('button', { name: 'Close command palette', exact: true })).toBeInViewport();
  await input.fill('settings'); await input.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Hot Cross Buns settings', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('reduced motion removes the palette transition', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const palette = await openCommands(page);
  const durations = await palette.evaluate(element => getComputedStyle(element).transitionDuration.split(',').map(value => parseFloat(value)));
  expect(durations.every(value => value < .001)).toBe(true);
  await palette.press('Escape');
  await expect(palette).toBeHidden();
});
