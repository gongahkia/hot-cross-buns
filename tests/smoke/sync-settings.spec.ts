import { expect } from '@playwright/test';
import { test, planner, openPalette } from './planner';

test('sync details open in settings and primary views remain usable during rapid navigation', async () => {
  await planner(async page => {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('hcb:open-diagnostics', { detail: { tab: 'sync' } })));
    const settings = page.getByTestId('settings-workspace');
    await expect(settings).toBeVisible();
    await expect(settings.locator('.settings-content').getByRole('heading', { name: 'Sync', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Diagnostics', exact: true })).toHaveCount(0);
    const categories = settings.getByRole('navigation', { name: 'Settings categories' });
    for (const label of ['Logs', 'History', 'Support', 'Diagnostics']) {
      await categories.getByRole('button', { name: label, exact: true }).click();
      await expect(settings.locator('.settings-content').getByRole('heading', { name: label, exact: true, level: 2 })).toBeVisible();
    }
    await categories.getByRole('button', { name: 'Data', exact: true }).click();
    await expect(settings.getByText('Where your data lives', { exact: true })).toHaveCount(0);
    await expect(settings.getByText('Offline availability', { exact: true })).toHaveCount(0);
    await expect(settings.getByRole('button', { name: 'Request persistent storage' })).toBeVisible();
    await page.getByRole('button', { name: 'Close settings' }).click();
    const primary = page.getByRole('navigation', { name: 'Primary' });
    for (const section of ['Tasks', 'Notes', 'Calendar', 'Tasks', 'Notes']) {
      await primary.getByRole('button', { name: section, exact: true }).click();
    }
    await expect(page.getByRole('region', { name: 'Notes view', exact: true })).toBeVisible();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
    await expect(page.getByRole('dialog', { name: 'Leader key commands' })).toHaveCount(0);
    await page.keyboard.press('Escape');
  });
});

test('full resync from the palette shows the bakery modal, reports failure and closes on success', async () => {
  await planner(async page => {
    await page.evaluate(() => {
      const state = window as any;
      window.hcb!.settings.recoveryAction = (async (request: any) => {
        state.resyncRequest = request;
        return new Promise(resolve => { state.finishResync = resolve; });
      }) as any;
    });
    const start = async () => {
      await openPalette(page);
      await page.getByPlaceholder('Type a command or search…').fill('Force full resync');
      await page.getByRole('option').filter({ hasText: 'Force full resync' }).click();
      await expect(page.getByRole('dialog', { name: 'Resyncing with Google', exact: true })).toBeVisible();
      await expect(page.getByTestId('settings-workspace')).toHaveCount(0);
    };
    await start();
    expect(await page.evaluate(() => (window as any).resyncRequest.action)).toBe('forceFullResync');
    await page.evaluate(() => (window as any).finishResync({ ok: false, error: { message: 'Sync test failed', code: 'INTERNAL' } }));
    await expect(page.getByRole('alert')).toContainText('Sync test failed');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await start();
    await page.evaluate(() => (window as any).finishResync({ ok: true, data: { message: 'Resynced' } }));
    await expect(page.getByRole('dialog', { name: 'Resyncing with Google', exact: true })).toHaveCount(0);
  });
});
