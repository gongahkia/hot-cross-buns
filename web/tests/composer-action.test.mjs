import assert from 'node:assert/strict';
import test from 'node:test';
import { composerAction } from '../public/composer-action.mjs';
import { activeRunControl } from '../run-control.mjs';

test('composer stops empty active work and sends text as steering without losing retry or correction intent', () => {
  const live = { state: { running: true }, control: { stop: 'current' } };
  assert.equal(composerAction(live).action, 'stop');
  assert.equal(composerAction(live).icon, 'square');
  assert.equal(composerAction(live).disabled, false);
  assert.equal(composerAction(live, { text: 'Focus on the tests' }).label, 'Steer task');
  assert.equal(composerAction(live, { text: 'Retry', pending: true }).label, 'Retry message');
  assert.equal(composerAction(live, { correction: true }).action, 'send');
  assert.equal(composerAction({ state: {} }, { text: 'Hello' }).label, 'Send message');
  assert.equal(composerAction({ state: { working: true }, control: { stop: 'preparing' } }).action, 'stop');
  assert.equal(composerAction({ state: { cancelling: true }, control: { stop: 'current' } }).disabled, true);
  assert.equal(composerAction({ state: {}, tasks: [{ active: true }] }).disabled, true);
});

test('stop follows the foreground owner or sole provenance-bound child, never unrelated or ambiguous work', () => {
  const main = { state: { primary: true, conversation_id: 'main' } };
  const child = (id, parent = 'main') => ({ state: { running: true, stop_id: id, dialogue_task: { parent_id: parent } } });
  const a = child('a'), other = child('outside', 'other');
  const host = { backend: main, sessions: { workers: new Set([main, a, other]) } };
  assert.equal(activeRunControl(host).owner, a);
  const b = child('b'); host.sessions.workers.add(b);
  assert.equal(activeRunControl(host), null);
  main.state.stop_id = 'foreground';
  assert.equal(activeRunControl(host).owner, main);
  delete main.state.stop_id; main.state.primary = false;
  assert.equal(activeRunControl(host), null);
});
