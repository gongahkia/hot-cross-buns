import { preview } from 'vite';
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const server = await preview({ preview: { host: '127.0.0.1', port: 4175, strictPort: true } });
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4175');
  await page.getByTestId('app-shell').waitFor();
  assert.equal(await page.evaluate(() => typeof window.hcb.__testing), 'undefined');
  const setup = page.getByRole('dialog', { name: 'Hot Cross Buns', exact: true });
  await setup.getByRole('button', { name: 'Get started', exact: true }).click();
  await setup.getByRole('button', { name: 'Continue', exact: true }).waitFor();
  assert.equal(await setup.getByRole('button', { name: 'Continue', exact: true }).isDisabled(), true,
    'A new workspace cannot complete setup without linking Google');
  assert.equal(await page.getByTestId('app-shell').getAttribute('inert'), '');
  // Exercise the production storage/recovery API with a legacy local workspace.
  // Completing its old onboarding flag must not bypass the account gate.
  // Actual consent and linked-workspace UI use mocked GIS in browser tests.
  const ids = await page.evaluate(async () => {
    const unwrap = result => { if (!result.ok) throw new Error(result.error.message); return result.data; };
    const task = unwrap(await window.hcb.tasks.create({ title: 'Production browser task', listId: 'inbox' }));
    const note = unwrap(await window.hcb.notes.create({ title: 'Production browser note', body: 'Durable cinnamon notes' }));
    const event = unwrap(await window.hcb.calendar.create({ title: 'Production browser event', calendarId: 'primary', startsAt: '2030-01-01T09:00:00Z', endsAt: '2030-01-01T10:00:00Z' }));
    unwrap(await window.hcb.tasks.update({ id: task.id, title: 'Production edited task' }));
    unwrap(await window.hcb.settings.update({ theme: 'dark', onboardingStatus: 'completed' }));
    return { task: task.id, note: note.id, event: event.id };
  });
  await page.reload();
  await page.getByTestId('app-shell').waitFor();
  await setup.waitFor();
  assert.equal(await page.getByTestId('app-shell').getAttribute('inert'), '',
    'A legacy completed workspace still needs a linked account');
  const reopened = await page.evaluate(async ids => {
    const unwrap = result => { if (!result.ok) throw new Error(result.error.message); return result.data; };
    return {
      task: unwrap(await window.hcb.tasks.get({ id: ids.task })),
      note: unwrap(await window.hcb.notes.get({ id: ids.note })),
      event: unwrap(await window.hcb.calendar.get({ id: ids.event })),
      settings: unwrap(await window.hcb.settings.get()),
      search: unwrap(await window.hcb.search.query({ query: 'cinnamon' })),
      storage: unwrap(await window.hcb.diagnostics.storage()),
    };
  }, ids);
  assert.equal(reopened.task.title, 'Production edited task');
  assert.equal(reopened.note.title, 'Production browser note');
  assert.equal(reopened.event.title, 'Production browser event');
  assert.equal(reopened.settings.theme, 'dark');
  assert.equal(reopened.settings.onboardingStatus, 'completed');
  assert.ok(reopened.search.items.some(item => item.id === ids.note));
  assert.deepEqual(errors, []);
  await mkdir('output', { recursive: true });
  await page.screenshot({ path: 'output/web-production.png', fullPage: true });
  console.log(JSON.stringify({ productionBrowser: 'passed', requiredAccountGate: 'passed', durableLocalRecovery: 'passed', testHooks: 'absent', storage: reopened.storage }, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
