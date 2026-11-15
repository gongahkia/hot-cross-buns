import { runCommand } from './commands';
import { expect, test } from '@playwright/test';
import { textEntrySelector } from '../src/textEntry';

function contrast(a: string, b: string) {
  const luminance = (color: string) => {
    const channels = color.match(/\d+/g)!.slice(0, 3).map(Number).map(value => {
      const channel = value / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    });
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  };
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + .05) / (values[1] + .05);
}

test('dark mode uses neutral surfaces, readable text and matching browser chrome', async ({ page }) => {
  await page.goto('/');
  await runCommand(page, 'Hot Cross Buns settings');
  const settings = page.getByRole('dialog', { name: 'Hot Cross Buns settings', exact: true });
  await settings.getByRole('button', { name: 'Dark mode', exact: true }).click();
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(20, 20, 20)');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#141414');
  const palette = await page.evaluate(() => {
    const result: Record<string, string> = {};
    const element = document.createElement('span');
    document.body.append(element);
    for (const name of ['paper', 'surface', 'field', 'date-bg', 'soft', 'ink', 'muted', 'focus', 'primary', 'primary-ink']) {
      element.style.color = 'var(--' + name + ')'; result[name] = getComputedStyle(element).color;
    }
    element.remove(); return result;
  });
  for (const color of Object.values(palette)) {
    const channels = color.match(/\d+/g)!.slice(0, 3).map(Number);
    expect(channels[0]).toBe(channels[1]); expect(channels[1]).toBe(channels[2]);
  }
  expect(contrast(palette.ink, palette.paper)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(palette.muted, palette.surface)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(palette.focus, palette.field)).toBeGreaterThanOrEqual(3);
  expect(contrast(palette['primary-ink'], palette.primary)).toBeGreaterThanOrEqual(4.5);
  await settings.getByRole('button', { name: 'close', exact: true }).click();
  await page.reload();
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(20, 20, 20)');
});

test('text fields are borderless with an underline for keyboard focus', async ({ page }) => {
  await page.goto('/');
  await runCommand(page, 'Open search');
  const search = page.getByRole('searchbox', { name: 'Search journal' });
  await expect(search).toBeFocused();
  await expect(search).toHaveCSS('border-top-width', '0px');
  await expect(search).toHaveCSS('outline-style', 'none');
  await expect(search).toHaveCSS('box-shadow', /inset/);
  await runCommand(page, 'Hot Cross Buns settings');
  const borders = await page.locator(textEntrySelector).evaluateAll(elements => elements.map(element => ({
    label: element.getAttribute('aria-label'),
    width: getComputedStyle(element).borderTopWidth,
  })));
  expect(borders.length).toBeGreaterThan(0);
  expect(borders.filter(field => field.width !== '0px')).toEqual([]);
  await expect(page.getByRole('button', { name: 'Dark mode', exact: true })).toHaveCSS('border-top-width', '0px');
});
