import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { fixture } from './fixture.mjs';

async function events(app) {
  const abort = new AbortController();
  const response = await fetch(app.url + '/api/events', { signal: abort.signal });
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  return { close: () => abort.abort(), async until(predicate) {
    const timer = setTimeout(() => abort.abort(), 15000);
    try {
      while (true) {
        const end = buffer.indexOf('\n\n');
        if (end >= 0) {
          const value = JSON.parse(buffer.slice(6, end)); buffer = buffer.slice(end + 2);
          if (!value.switching && predicate(value)) return value;
        } else {
          const part = await reader.read(); if (part.done) throw Error('Stream closed'); buffer += part.value;
        }
      }
    } finally { clearTimeout(timer); }
  } };
}
async function action(app, body, status = 200) {
  const response = await fetch(app.url + '/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.url }, body: JSON.stringify(body) });
  const value = await response.json(); assert.equal(response.status, status, JSON.stringify(value)); return value;
}

for (const draftsEnabled of [true, false]) test(`one assistant inspects background work and binds replies without moving its draft (saved drafts ${draftsEnabled})`, { timeout: 45000 }, async () => {
  const app = await fixture({ conversationalReplies: true, draftsEnabled, introductionStatus: 'skipped' }); let live;
  try {
    live = await events(app); const home = await live.until(value => value.state?.primary);
    app.blockAfterTool();
    await action(app, { op: 'send', context: home.context, id: randomUUID(), text: 'Read note.md for fixture activity.', files: [] });
    const active = await live.until(value => value.tasks?.some(task => !task.current && task.state === 'running' && task.steps.some(step => step.state === 'completed')));
    const task = active.tasks.find(task => !task.current);
    assert.equal(active.context, home.context);
    await action(app, { op: 'save', context: home.context, text: 'My next thought.' });
    const inspected = await action(app, { op: 'task-inspect', context: home.context, id: task.id });
    assert.equal(inspected.current, false); assert.equal(inspected.canReply, true);
    assert.equal(inspected.activity.active, true);
    assert.equal(inspected.activity.entries[0].tool, 'read_file');
    assert.doesNotMatch(JSON.stringify(inspected), /Private fixture note content/);
    if (draftsEnabled) assert.equal((await action(app, { op: 'draft', context: home.context })).text, 'My next thought.');
    const reply = await action(app, { op: 'task-reply', context: home.context, id: task.id });
    assert.equal(reply.context, home.context); assert.equal(reply.reply_to_task_id, task.id);
    if (draftsEnabled) assert.equal(reply.text, 'My next thought.');
    assert.equal((await action(app, { op: 'draft', context: home.context })).reply_to_task_id, task.id);
    await action(app, { op: 'task-reply', context: home.context, id: 'unowned-task' }, 409);
    await action(app, { op: 'send', context: home.context, id: randomUUID(), text: 'What has happened so far?', files: [], reply_to_task_id: 'another-task' }, 409);
    const replyID = randomUUID();
    await action(app, { op: 'send', context: home.context, id: replyID, text: 'What has happened so far?', files: [], reply_to_task_id: task.id });
    const answered = await live.until(value => value.state?.dialogue?.some(turn => turn.text === 'What has happened so far?' && turn.state === 'answered'));
    assert.equal(answered.context, home.context);
    assert.equal(answered.tasks.find(value => value.id === task.id)?.state, 'running');
    const route = app.payloads.map(value => { try { return JSON.parse(value.messages.findLast(message => message.role === 'user').content); } catch {} }).find(value => value?.reply_to_task_id === task.id);
    assert.ok(route); assert.deepEqual(route.tasks.map(value => value.id), [task.id]);
    assert.equal((await action(app, { op: 'draft', context: home.context })).reply_to_task_id, undefined);
    app.release();
    await live.until(value => value.tasks?.some(value => value.id === task.id && value.state === 'completed'));
    const finished = await action(app, { op: 'task-inspect', context: home.context, id: task.id });
    assert.match(finished.history.at(-1).text, /Fixture answer/); assert.equal(finished.activity.active, false);
    if (draftsEnabled) {
      await action(app, { op: 'task-reply', context: home.context, id: task.id });
      live.close(); await app.restart(); live = await events(app);
      const restored = await live.until(value => value.state?.primary);
      assert.equal(restored.context, home.context);
      assert.equal((await action(app, { op: 'draft', context: restored.context })).reply_to_task_id, task.id);
      const cleared = await action(app, { op: 'clear-task-reply', context: restored.context });
      assert.equal(cleared.reply_to_task_id, undefined);
    }
  } finally { app.release(); live?.close(); await app.close(); }
});
