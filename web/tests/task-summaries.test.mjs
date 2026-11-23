import assert from 'node:assert/strict';
import test from 'node:test';
import { taskSummaries, delegatedSummaries } from '../task-summaries.mjs';

function fixture(owners, current = owners[0], visible = owners.map(owner => owner.state.conversation_id)) {
  return { backend: current, sessions: {
    workers: new Set(owners), activity: () => visible.map(id => ({ id })), canOpen: id => visible.includes(id),
  } };
}
const finished = { state: 'completed', started_at: '2026-11-22T00:00:00Z', finished_at: '2026-11-22T00:00:20Z', entries: [{ id: 'read', kind: 'tool', tool: 'read_file', state: 'completed' }] };

test('delegated sidebar names external engines while keeping private session state and control tokens out', () => {
  const owner = { state: { conversation_id: 'chat', specialists: [
    { id: 'subagent-001', name: 'cli_codex', assignment: 'Review the interface', status: 'running', token: 'private token', native: { credentials: 'private' } },
    { id: 'subagent-002', name: 'cli_claude', assignment: 'Check the connection', status: 'awaiting_input' },
  ] } };
  const cards = delegatedSummaries(fixture([owner]));
  assert.deepEqual(cards.map(card => card.engine), ['Codex', 'Claude Code']);
  assert.deepEqual(cards.map(card => card.brand), ['codex', 'claude-code']);
  assert.deepEqual(cards.map(card => card.state), ['running', 'waiting']);
  assert.equal(cards[0].conversation, 'chat');
  assert.doesNotMatch(JSON.stringify(cards), /private|token|credentials/);
});

test('a delegated task retains its link to the current idle requesting chat', () => {
  const parent = { state: { conversation_id: 'request' } };
  const child = { state: { conversation_id: 'worker', running: true, dialogue_task: { parent_id: 'request' } } };
  const tasks = taskSummaries(fixture([parent, child], parent, ['worker']));
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].parent, 'request');
});

test('task inspection projects public outcomes across owned chats without private tool payloads or side effects', () => {
  const idle = { state: { conversation_id: 'current', title: 'New chat' } };
  const working = { state: { conversation_id: 'background', title: 'Read my notes', running: true,
    activity: { ...finished, state: 'running', finished_at: undefined, entries: [
      { ...finished.entries[0], icon: 'book-open', brand: 'slack', arguments: 'private arguments', output: 'private result', details: [{ text: 'private details' }, {kind:'read_file',path:'notes.md',text:'private extra'}] },
      { id: 'text', kind: 'text', text: 'Public narration is already in the chat', state: 'running' },
    ] }, pending_approval: { token: 'secret approval token' }, private: 'private state',
  } };
  const retired = { state: { conversation_id: 'retired', activity: finished } };
  const host = fixture([idle, working, retired], idle, ['current', 'background']);
  const before = JSON.stringify(working);
  const tasks = taskSummaries(host);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].id, 'background');
  assert.equal(tasks[0].state, 'waiting');
  assert.equal(tasks[0].current, false);
  assert.equal(tasks[0].steps[0].state, 'completed');
  assert.equal(tasks[0].steps[0].icon, 'book-open');
  assert.equal(tasks[0].steps[0].brand, 'slack');
  assert.deepEqual(tasks[0].steps[0].details, [{kind:'read_file',path:'notes.md'}]);
  assert.doesNotMatch(JSON.stringify(tasks), /private|secret approval|Public narration/);
  assert.equal(JSON.stringify(working), before);
});

test('new activity and pending plans never reuse steps or a summary from an earlier completed request', () => {
  const owner = { state: { conversation_id: 'chat', messages: [{ text: 'Earlier result', activity: finished }] } };
  const host = fixture([owner]);
  assert.equal(taskSummaries(host)[0].steps.length, 1);
  for (const patch of [
    { running: true }, { dialogue_busy: true }, { queued: 1 },
    { pending_approval: { token: 'not exposed' } },
    { task_plans: [{ id: 'plan', task: 'A new request', phase: 'review', steps: [{ text: 'Read the latest note' }] }] },
  ]) {
    const previous = owner.state;
    owner.state = { ...previous, ...patch };
    const task = taskSummaries(host)[0];
    assert.equal(task.steps.length, 0);
    assert.equal(task.summary, '');
    owner.state = previous;
  }
  owner.closed = true;
  assert.equal(taskSummaries(host)[0].state, 'disconnected');
  assert.equal(taskSummaries(host)[0].active, false);
});
