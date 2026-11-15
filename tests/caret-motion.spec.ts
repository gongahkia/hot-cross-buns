import { runCommand } from './commands';
import { expect, test } from '@playwright/test';

test('carets stay solid during typing, pulse when idle and keep native selection', async ({ page }) => {
  await page.goto('/');
  await runCommand(page, 'Open search');
  const input = page.getByRole('combobox', { name: 'Search commands and journal' });
  await input.fill('Native selection');
  await expect(input).toHaveAttribute('data-caret-typing', 'true');
  await expect(input).toHaveCSS('animation-name', 'none');
  await expect(input).not.toHaveAttribute('data-caret-typing', 'true');
  await expect(input).toHaveCSS('animation-name', 'hcb-caret-pulse');
  expect(await input.evaluate(element => getComputedStyle(element).getPropertyValue('caret-animation'))).toBe('manual');
  await input.press('ArrowLeft');
  expect(await input.evaluate(element => (element as HTMLInputElement).selectionStart)).toBe('Native selection'.length - 1);
  await input.press('Shift+Home');
  const selection = await input.evaluate(element => {
    const field = element as HTMLInputElement;
    return { start: field.selectionStart, end: field.selectionEnd, value: field.value };
  });
  expect(selection).toEqual({ start: 0, end: 'Native selection'.length - 1, value: 'Native selection' });
});

test('composition keeps the caret steady until it ends and blur releases typing state', async ({ page }) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'New daily item', exact: true });
  await input.focus();
  await input.dispatchEvent('compositionstart', { data: 'に' });
  await page.waitForTimeout(800);
  await expect(input).toHaveAttribute('data-caret-typing', 'true');
  await expect(input).toHaveCSS('animation-name', 'none');
  await input.dispatchEvent('compositionend', { data: '日本' });
  await expect(input).not.toHaveAttribute('data-caret-typing', 'true');
  await expect(input).toHaveCSS('animation-name', 'hcb-caret-pulse');
  await input.press('Tab');
  await expect(input).not.toHaveAttribute('data-caret-typing', 'true');
});

test('caret motion reaches scratchpad and dynamically opened import editors', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Scratchpad', exact: true }).click();
  const scratchpad = page.getByRole('textbox', { name: 'Scratchpad text', exact: true });
  await scratchpad.fill('First line\nSecond line');
  await expect(scratchpad).toHaveAttribute('data-caret-typing', 'true');
  await expect(scratchpad).toHaveCSS('border-top-width', '0px');
  await expect(scratchpad).toHaveCSS('animation-name', 'hcb-caret-pulse');
  await expect(scratchpad).toHaveValue('First line\nSecond line');
  await page.getByRole('button', { name: 'Dated', exact: true }).click();
  await page.getByLabel('Import a TODO.txt file').setInputFiles({ name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from('2026-11-16\nMissing divider\n') });
  const doctor = page.getByRole('textbox', { name: 'Edit imported TODO.txt', exact: true });
  await doctor.focus();
  await expect(doctor).toHaveAttribute('data-caret-typing', 'true');
  await expect(doctor).toHaveCSS('border-top-width', '0px');
  await expect(doctor).toHaveCSS('animation-name', 'hcb-caret-pulse');
});

test('reduced motion uses a steady caret and responds to preference changes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'New daily item', exact: true });
  await input.focus();
  await input.fill('Motion preference');
  await expect(input).not.toHaveAttribute('data-caret-typing', 'true');
  await expect(input).toHaveCSS('animation-name', 'none');
  expect(await input.evaluate(element => getComputedStyle(element).getPropertyValue('caret-animation'))).toBe('manual');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await input.press('End');
  await expect(input).toHaveAttribute('data-caret-typing', 'true');
  await expect(input).toHaveCSS('animation-name', 'hcb-caret-pulse');
  await expect(input).toHaveValue('Motion preference');
  await input.press('End');
  await expect(input).toHaveAttribute('data-caret-typing', 'true');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(input).not.toHaveAttribute('data-caret-typing', 'true');
  await expect(input).toHaveCSS('animation-name', 'none');
});
