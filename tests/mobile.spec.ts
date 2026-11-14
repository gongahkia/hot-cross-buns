import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true });

function todayString() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

test('timed items and details stay readable after a phone rotates', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New daily item' }).waitFor();
  const title = 'Prepare a long report for the mobile layout';
  await page.getByLabel('Import a TODO.txt file').setInputFiles({
    name: 'TODO.txt', mimeType: 'text/plain',
    buffer: Buffer.from(`${todayString()}\n\n09:00-10:00 ${title}\n- [ ] Collect the relevant details from colleagues\n`),
  });
  const row = page.getByRole('group', { name: `09:00-10:00 ${title}` });
  await expect(row).toBeVisible();
  const dimensions = () => row.evaluate(element => ({
    height: element.getBoundingClientRect().height,
    title: element.querySelector('textarea')!.getBoundingClientRect().width,
    detail: element.querySelector('[aria-label^="Edit detail"]')!.getBoundingClientRect().width,
  }));
  const narrow = await dimensions();
  expect(narrow.title).toBeGreaterThan(120);
  expect(narrow.detail).toBeGreaterThan(120);
  expect(narrow.height).toBeLessThan(350);

  await page.setViewportSize({ width: 768, height: 700 });
  await expect.poll(async () => (await dimensions()).height).toBeLessThan(narrow.height);
  await expect(row).toHaveCSS('display', 'flex');
});

test('move calendar confirmation stays reachable in portrait and landscape', async ({ page }) => {
  await page.goto('/');
  const add = page.getByRole('textbox', { name: 'New daily item' });
  await add.fill('Move on phone');
  await add.press('Enter');

  for (const viewport of [{ width: 320, height: 700 }, { width: 375, height: 667 }, { width: 667, height: 375 }]) {
    await page.setViewportSize(viewport);
    await page.getByRole('button', { name: 'More actions for Move on phone' }).click();
    await page.getByRole('button', { name: 'Move Move on phone' }).click();
    await page.getByRole('button', { name: 'Move here' }).click();
    await expect(page.getByRole('button', { name: 'Move here' })).toHaveCount(0);
  }
});

test('recurrence calendar fits a narrow phone and its controls remain reachable', async ({ page }) => {
  await page.goto('/');
  const add = page.getByRole('textbox', { name: 'New daily item' });
  await add.fill('Calendar on phone');
  await add.press('Enter');
  await page.getByRole('button', { name: 'More actions for Calendar on phone' }).click();
  await page.getByRole('button', { name: 'Set repeat for Calendar on phone' }).click();
  const dialog = page.getByRole('dialog', { name: 'Repeat Calendar on phone' });
  await expect(dialog.getByLabel('Repeat rule')).toHaveCSS('font-size', '16px');
  await dialog.getByLabel('Repeat rule').selectOption('custom');
  await dialog.getByRole('button', { name: /^Schedule starts:/ }).click();
  const calendar = dialog.getByRole('group', { name: 'Choose schedule starts' });
  await expect(calendar).toBeVisible();
  const bounds = await dialog.evaluate(element => {
    const dialogBox = element.getBoundingClientRect();
    const calendarBox = element.querySelector('[aria-label="Choose schedule starts"]')!.getBoundingClientRect();
    return { dialogRight: dialogBox.right, calendarRight: calendarBox.right, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
  });
  expect(bounds.calendarRight).toBeLessThanOrEqual(bounds.dialogRight);
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth);
  expect(await calendar.locator('.rdp-day_button').first().evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await calendar.getByRole('button', { name: 'Go to the Next Month' }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('touch editors use readable text and weekday headings do not repeat on mobile', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('shio-pan-date-format', 'long-weekday'));
  await page.goto('/');
  const add = page.getByRole('textbox', { name: 'New daily item' });
  await expect(add).toHaveCSS('font-size', '16px', { timeout: 15000 });
  const otherDay = new Date();
  otherDay.setDate(otherDay.getDate() + (otherDay.getDay() === 1 ? 1 : -1));
  const date = `${otherDay.getFullYear()}-${String(otherDay.getMonth() + 1).padStart(2, '0')}-${String(otherDay.getDate()).padStart(2, '0')}`;
  await page.getByLabel('Import a TODO.txt file').setInputFiles({
    name: 'TODO.txt', mimeType: 'text/plain', buffer: Buffer.from(`${date}\n\nReview on phone\n`),
  });
  const heading = page.locator('section').filter({ has: page.locator(`time[datetime="${date}"]`) }).locator('h2');
  await expect(heading.locator(':scope > span').first()).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Edit Review on phone' })).toHaveCSS('font-size', '16px');
  await page.setViewportSize({ width: 768, height: 700 });
  await expect(heading.locator(':scope > span').first()).toBeVisible();
});
