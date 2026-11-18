import { expect, test, type Page } from '@playwright/test';
import { runCommand } from './commands';

async function blockedPopout(page: Page) {
  await runCommand(page, 'Open view in browser window');
  const chooser = page.getByRole('dialog', { name: 'Open dated window', exact: true });
  await chooser.getByRole('button', { name: 'Open window', exact: true }).click();
  await expect(page.locator('dialog[open][data-state="closed"]')).toHaveCount(0);
}
test.beforeEach(async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => { window.open = () => null; });
  await page.goto('/');
});

test('blocked popouts use a corner toast without moving journal content', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const editor = page.getByRole('textbox', { name: 'New daily item', exact: true });
  const before = await editor.boundingBox();
  await blockedPopout(page);
  const toast = page.getByRole('status', { name: 'Notification', exact: true });
  await expect(toast).toContainText('The browser blocked the popout.');
  await expect(toast).toHaveCSS('position', 'fixed');
  const after = await editor.boundingBox();
  expect(after!.y).toBeCloseTo(before!.y, 1);
  await expect(page.locator('main').getByText('The browser blocked the popout.', { exact: false })).toHaveCount(0);
  const bounds = (await toast.boundingBox())!;
  expect(bounds.y + bounds.height).toBeGreaterThan(page.viewportSize()!.height - 40);
  // a visible notice must leave the primary toolbar usable.
  const commands = page.getByRole('button', { name: 'Open command palette', exact: true });
  await commands.click();
  await expect(page.getByRole('dialog', { name: 'Command palette', exact: true })).toBeVisible();
  await page.getByRole('dialog', { name: 'Command palette', exact: true }).press('Escape');
  await expect(page.getByRole('dialog', { name: 'Command palette', exact: true })).toBeHidden();
  await toast.getByRole('button', { name: 'Dismiss message', exact: true }).click();
  await expect(toast).toBeHidden();
});

test('repeated notices reset their timeout and older timers cannot dismiss the latest message', async ({ page }) => {
  await blockedPopout(page);
  const toast = page.getByRole('status', { name: 'Notification', exact: true });
  await expect(toast).toBeVisible();
  await page.clock.fastForward(7000);
  await blockedPopout(page);
  await expect(toast).toBeVisible();
  await page.clock.fastForward(1200);
  await expect(toast).toBeVisible();
  await page.clock.fastForward(7200);
  await expect(toast).toBeHidden();
});

test('hover pauses dismissal and the toast fits a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await blockedPopout(page);
  const toast = page.getByRole('status', { name: 'Notification', exact: true });
  await expect(toast).toBeInViewport({ ratio: 1 });
  await toast.hover();
  await page.clock.fastForward(10000);
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Dismiss message', exact: true }).click();
  await expect(toast).toBeHidden();
});

test('notifications are readable and dismissible above settings dialogs', async ({ page }) => {
  await page.getByRole('button', { name: 'Dated', exact: true }).click();
  await page.evaluate(async () => {
    const pick = async () => {
      const file = await (await navigator.storage.getDirectory()).getFileHandle('occupied.md', { create: true });
      const writer = await file.createWritable(); await writer.write('existing text'); await writer.close(); return file;
    };
    Object.assign(window, { showOpenFilePicker: async () => [await pick()], showSaveFilePicker: pick });
  });
  await runCommand(page, 'Settings');
  const settings = page.getByRole('dialog', { name: 'Hot Cross Buns settings', exact: true });
  await settings.getByRole('button', { name: 'Create linked Planner.md', exact: true }).click();
  const toast = page.getByRole('status', { name: 'Notification', exact: true });
  await expect(toast).toContainText('This file already contains text.');
  await toast.getByRole('button', { name: 'Dismiss message', exact: true }).click();
  await expect(toast).toBeHidden();
  await expect(settings).toBeVisible();
  await expect(settings.getByRole('img', { name: 'Syncthing', exact: true })).toBeVisible();
});

test('keyboard focus pauses dismissal and reduced motion suppresses toast movement', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await blockedPopout(page);
  const toast = page.getByRole('status', { name: 'Notification', exact: true });
  await expect(toast).toBeVisible();
  const duration = await toast.evaluate(element => getComputedStyle(element).transitionDuration);
  expect(duration.split(',').every(value => parseFloat(value) < 0.001)).toBe(true);
  await toast.getByRole('button', { name: 'Dismiss message', exact: true }).focus();
  await expect(toast.getByRole('button', { name: 'Dismiss message', exact: true })).toBeFocused();
  await page.clock.fastForward(10000);
  await expect(toast).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(toast).toBeHidden();
});

test('browsers without Popover retain a fixed, dismissible notification', async ({ page }) => {
  await page.addInitScript(() => { Reflect.deleteProperty(HTMLElement.prototype, 'showPopover'); });
  await page.reload();
  await blockedPopout(page);
  const toast = page.getByRole('status', { name: 'Notification', exact: true });
  await expect(toast).toBeVisible(); await expect(toast).toHaveCSS('position', 'fixed');
  await toast.getByRole('button', { name: 'Dismiss message', exact: true }).click();
  await expect(toast).toBeHidden();
});


test.describe('touch notifications', () => {
  test.use({ isMobile: true, hasTouch: true });

  test('a visible toast follows phone rotation without holding the journal in its mobile layout', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await blockedPopout(page);
    const toast = page.getByRole('status', { name: 'Notification', exact: true });
    await expect(toast).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open command palette', exact: true })).toHaveCSS('width', '44px');
    await page.setViewportSize({ width: 768, height: 700 });
    await expect(page.getByRole('button', { name: 'Open command palette', exact: true }).locator('span')).toBeVisible();
    await expect(toast).toBeInViewport({ ratio: 1 });
    await toast.getByRole('button', { name: 'Dismiss message', exact: true }).click();
    await expect(toast).toBeHidden();
  });
});
