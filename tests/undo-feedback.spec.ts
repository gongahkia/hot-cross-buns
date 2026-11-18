import { openLegacyJournal } from './legacy-workspace';
import { plannerFixture } from './planner-fixture';
import { expect, test } from '@playwright/test';

test('late exit cleanup cannot remove a newer deletion confirmation', async ({ page }) => {
  await openLegacyJournal(page);
  await page.getByLabel('Import a Planner.md file').setInputFiles({
    name: 'Planner.md', mimeType: 'text/plain',
    buffer: Buffer.from(plannerFixture('UNDATED\n\nLIST: Ideas\nAlpha\n- first detail\nBeta\n')),
  });
  await page.getByRole('button', { name: 'Undated', exact: true }).click();
  const ideas = page.getByRole('region', { name: 'Ideas', exact: true });
  const confirmation = page.getByRole('status', { name: 'Deletion confirmation', exact: true });
  await ideas.getByRole('button', { name: 'More actions for detail first detail', exact: true }).click();
  await ideas.getByRole('button', { name: 'Delete detail first detail', exact: true }).click();
  await expect(confirmation).toContainText('Deleted detail: first detail');
  await page.evaluate(() => {
    const control = Object.assign(window, { lateUndoExitCallbacks: [] as Array<() => void> });
    const original = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (delay === 160 && typeof handler === 'function') {
        // emulate an exit callback already queued when the next notice arrives.
        control.lateUndoExitCallbacks.push(() => handler(...args));
        return original(() => {}, delay);
      }
      return original(handler, delay, ...args);
    }) as typeof window.setTimeout;
  });
  await confirmation.getByRole('button', { name: 'Undo deletion of detail first detail', exact: true }).click();
  await expect(ideas.getByRole('textbox', { name: 'Edit detail first detail', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (Reflect.get(window, 'lateUndoExitCallbacks') as unknown[]).length)).toBeGreaterThan(0);
  await ideas.getByRole('button', { name: 'More actions for Alpha', exact: true }).click();
  await ideas.getByLabel('Actions for Alpha', { exact: true }).getByRole('button', { name: 'delete', exact: true }).click();
  await expect(confirmation).toContainText('Deleted item: Alpha');
  await page.evaluate(async () => {
    const callbacks = Reflect.get(window, 'lateUndoExitCallbacks') as Array<() => void>;
    callbacks.splice(0).forEach(callback => callback());
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await expect(confirmation).toContainText('Deleted item: Alpha');
  await confirmation.getByRole('button', { name: 'Undo deletion of item Alpha', exact: true }).click();
  await expect(ideas.getByRole('textbox', { name: 'Edit Alpha', exact: true })).toBeVisible();
  await expect(ideas.getByRole('textbox', { name: 'Edit detail first detail', exact: true })).toBeVisible();
});
