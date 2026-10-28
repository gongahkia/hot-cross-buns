import { expect, type Page } from '@playwright/test';
import { test, planner, navigate, capture } from './planner';

async function recordPanelWidths(page: Page) {
  await page.evaluate(() => {
    const widths: Array<{ panel: number; list: number }> = [];
    (window as any).panelWidths = widths;
    const end = performance.now() + 800;
    function sample() {
      widths.push({
        panel: document.querySelector('[data-testid="inspector-shell"]')?.getBoundingClientRect().width ?? 0,
        list: document.querySelector('[data-testid="pane-workspace"]')!.getBoundingClientRect().width,
      });
      if (performance.now() < end) requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
}

test('the wide note editor expands and collapses smoothly while preserving its document and list widths', async () => {
  await planner(async page => {
    await navigate(page, 'Notes');
    await recordPanelWidths(page);
    await page.getByRole('button', { name: 'Add a note', exact: true }).click();
    const panel = page.getByTestId('inspector-shell');
    await expect(panel).toHaveCSS('opacity', '1');
    const width = (await panel.boundingBox())!.width;
    expect(width).toBeGreaterThan(380);
    await expect.poll(async () => (await page.getByTestId('pane-workspace').boundingBox())!.width).toBeCloseTo(320, 0);
    expect(await page.evaluate(max => (window as any).panelWidths.some((frame: any) => frame.panel > 10 && frame.panel < max - 10), width)).toBe(true);
    await page.getByRole('textbox', { name: 'Note title', exact: true }).fill('Sliding document');
    await capture(page, 'note-editor-expanded');
    await recordPanelWidths(page);
    await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
    await expect(panel).toHaveCount(0);
    expect(await page.evaluate(max => (window as any).panelWidths.some((frame: any) => frame.panel > 10 && frame.panel < max - 10 && frame.list > 330), width)).toBe(true);
    await expect(page.getByRole('button', { name: 'Open note Sliding document', exact: true })).toBeVisible();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'Open note Sliding document', exact: true }).click();
    await expect(panel).toHaveCSS('opacity', '1');
    await page.setViewportSize({ width: 640, height: 760 });
    await expect(panel).toHaveAttribute('data-inspector-layout', 'sheet');
    await expect(page.getByRole('textbox', { name: 'Note title', exact: true })).toHaveValue('Sliding document');
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
  });
});
