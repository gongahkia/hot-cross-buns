import { expect, test } from '@playwright/test';
import { openCommands } from './commands';

test('large imports use the parser worker while animation frames continue', async ({ page }) => {
  await page.addInitScript(() => {
    let frames = 0;
    const tick = () => { frames++; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
    const results: Array<{ kind: string; length: number; frames: number }> = [];
    Object.defineProperty(window, '__backgroundResults', { value: results });
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message, options?: StructuredSerializeOptions | Transferable[]) {
      const start = frames;
      const listener = (event: MessageEvent) => { if (event.data.id === message.id) { results.push({ kind: message.kind, length: message.source?.length ?? 0, frames: frames - start }); this.removeEventListener('message', listener); } };
      this.addEventListener('message', listener);
      original.call(this, message, options as StructuredSerializeOptions);
    };
  });
  const raw = `---\nhcb-format: 1\ndocument-id: background-large\n---\n\n## Dated\n\n### 2000-01-01\n\n${Array.from({ length: 5000 }, (_, index) => `- [ ] Task ${index} &amp; context\n  \`\`\`hcb\n  id: task-${index}\n  \`\`\`\n  - [ ] Step ${index}\n`).join('\n')}\n## Undated\n\n### Inbox\n\n## Scratchpad\n`;
  await page.goto('/');
  await page.getByLabel('Import a Planner.md file').setInputFiles({ name: 'Planner.md', mimeType: 'text/markdown', buffer: Buffer.from(raw) });
  await page.getByRole('button', { name: 'Undated', exact: true }).click();
  await expect(page.getByText('Planner.md imported.', { exact: true })).toBeVisible({ timeout: 15000 });
  const results = await page.evaluate(() => (window as unknown as { __backgroundResults: Array<{ kind: string; length: number; frames: number }> }).__backgroundResults);
  const parsed = results.find(result => result.kind === 'parse' && result.length > 300_000);
  expect(parsed).toBeDefined(); expect(parsed!.frames).toBeGreaterThan(0);
  console.log(`Large background parse: ${parsed!.frames} animation frames continued during worker validation`);
});

test('worker failure falls back to full validation, retains invalid drafts and permits a corrected retry', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Worker.prototype.postMessage;
    let failed = false;
    Worker.prototype.postMessage = function(message, options?: StructuredSerializeOptions | Transferable[]) {
      if (!failed && message.kind === 'parse' && message.source.includes('Worker retry marker')) {
        failed = true;
        setTimeout(() => this.dispatchEvent(new ErrorEvent('error', { message: 'Injected parser worker failure', cancelable: true })), 0);
        return;
      }
      original.call(this, message, options as StructuredSerializeOptions);
    };
  });
  await page.goto('/');
  const palette = await openCommands(page);
  await palette.getByRole('combobox').fill('source');
  await palette.getByRole('option', { name: 'Edit Markdown source', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit Markdown source', exact: true });
  const editor = dialog.getByRole('textbox', { name: 'Markdown source', exact: true });
  const draft = (await editor.inputValue()).replace('hcb-format: 1', 'hcb-format: 999') + 'Worker retry marker\n';
  await editor.fill(draft);
  await dialog.getByRole('button', { name: 'Save Markdown', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Only hcb-format');
  await expect(editor).toHaveValue(draft);
  await editor.fill(draft.replace('hcb-format: 999', 'hcb-format: 1'));
  await dialog.getByRole('button', { name: 'Save Markdown', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Scratchpad', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Scratchpad text', exact: true })).toHaveValue('Worker retry marker\n');
});
