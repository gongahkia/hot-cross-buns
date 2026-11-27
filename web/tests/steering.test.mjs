import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { fixture } from './fixture.mjs';

async function events(app) {
  const abort = new AbortController();
  const response = await fetch(app.url + '/api/events', { signal: abort.signal });
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  return { close: () => abort.abort(), async until(predicate) {
    const timer = setTimeout(() => abort.abort(), 20000);
    let latest;
    try {
      for (;;) {
        const end = buffer.indexOf('\n\n');
        if (end >= 0) {
          const value = JSON.parse(buffer.slice(6, end)); buffer = buffer.slice(end + 2);
          latest = value;
          if (!value.switching && predicate(value)) return value;
        } else {
          const part = await reader.read(); if (part.done) throw Error('Event stream closed'); buffer += part.value;
        }
      }
    } catch (error) {
      throw Error(JSON.stringify({ dialogue: latest?.state?.dialogue?.slice(-2), control: latest?.control, running: latest?.state?.running, tasks: latest?.tasks?.map(t => ({ id: t.id, state: t.state })) }), { cause: error });
    } finally { clearTimeout(timer); }
  } };
}
async function action(app, body, status = 200) {
  const response = await fetch(app.url + '/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.url }, body: JSON.stringify(body) });
  const result = await response.json(); assert.equal(response.status, status, JSON.stringify(result)); return result;
}

for (const inlineWork of [true, false]) test(`composer follow-up steers the existing ${inlineWork ? 'foreground' : 'background'} operation without a new run`, { timeout: 40000 }, async () => {
  const app = await fixture({ inlineWork, chatCount: 1, introductionStatus: 'skipped' });
  let live;
  try {
    app.block(); live = await events(app);
    const initial = await live.until(s => s.state?.primary);
    await action(app, { op: 'send', context: initial.context, id: randomUUID(), text: 'Run fixture activity. Read the note and summarize it.', files: [], preferSteering: true });
    const active = await live.until(s => s.control?.stop && (inlineWork ? s.state.running : s.state.peers?.some(p => p.can_guide)));
    const target = active.control.stop, id = randomUUID(), text = 'Focus on the permissions boundary in the summary.';
    await action(app, { op: 'send', context: initial.context, id, text, files: [], preferSteering: true });
    const guided = await live.until(s => s.state?.dialogue?.some(t => t.text === text && t.state === 'guided'));
    assert.equal(guided.control.stop, target, 'steering must retain the original operation');
    assert.equal(guided.state.queue.length, 0, 'steering must not create queued work');
    await action(app, { op: 'send', context: initial.context, id, text, files: [], preferSteering: true });
    await action(app, { op: 'send', context: initial.context, id, text, files: [], preferSteering: false }, 409);
    app.release();
    await live.until(s => inlineWork ? !s.state.running && s.state.messages.some(m => m.activity?.state === 'completed') : s.state.peers?.some(p => p.state === 'completed'));
    assert.ok(app.payloads.some(p => p.tools?.length && JSON.stringify(p.messages).includes(text)), 'instruction must reach the actual worker model');
  } finally { app.release(); live?.close(); await app.close(); }
});

test('composer stop checks its captured run and cancels through the native owner', { timeout: 35000 }, async () => {
  const app = await fixture({ inlineWork: true, chatCount: 1, introductionStatus: 'skipped' }); let live;
  try {
    app.block(); live = await events(app);
    const initial = await live.until(s => s.state?.primary);
    await action(app, { op: 'send', context: initial.context, id: randomUUID(), text: 'Run fixture activity. Read the note.', files: [] });
    const active = await live.until(s => s.state?.running && s.control?.stop);
    await action(app, { op: 'stop', context: active.context, id: '0'.repeat(64) }, 409);
    await action(app, { op: 'stop', context: active.context, id: active.control.stop });
    const stopped = await live.until(s => !s.state?.running && s.state?.messages.some(m => m.activity?.state === 'stopped'));
    assert.equal(stopped.control, null);
    await action(app, { op: 'stop', context: active.context, id: active.control.stop }, 409);
  } finally { app.release(); live?.close(); await app.close(); }
});
