import { expect, test } from '@playwright/test';

test('local normal and italic interface fonts load on desktop and phone', async ({ page }) => {
  const failures: string[] = [];
  page.on('requestfailed', request => { if (request.url().includes('/fonts/')) failures.push(request.url()); });
  page.on('response', response => { if (response.url().includes('/fonts/') && !response.ok()) failures.push(response.url()); });
  await page.goto('/');
  const typography = await page.evaluate(async () => {
    const normal = await document.fonts.load('300 18px Inter');
    const italic = await document.fonts.load('italic 400 18px Inter');
    return {
      family: getComputedStyle(document.body).fontFamily,
      normal: normal.map(face => face.status),
      italic: italic.map(face => face.status),
    };
  });
  expect(typography.family).toContain('Inter');
  expect(typography.normal).toEqual(['loaded']);
  expect(typography.italic).toEqual(['loaded']);
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByRole('button', { name: 'Hot Cross Buns settings', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(failures).toEqual([]);
});
