import test from 'node:test';
import assert from 'node:assert/strict';
import { correctionDrafts } from '../corrections.mjs';

function fixture() {
  const owner = { state: { conversation_id: 'task', dialogue_active: true, can_correct_action: true, pending_approval: { token: 'exact', message_index: 0 }, messages: [{ result: { kind: 'approval' } }], task_plans: [{ id: 'plan', revision: 2, digest: 'digest', phase: 'review' }] } };
  const host = { backend: owner, mutable() {}, sessions: { workers: new Set([owner]), open: async ({ conversation_id }) => { host.backend = [...host.sessions.workers].find(worker => worker.state.conversation_id === conversation_id); } } };
  owner.state.can_revise_plans = ['plan'];
  return { owner, host, drafts: correctionDrafts(host, () => ({ id: 'review' })) };
}

test('correction drafts preserve the normal draft, bind exact proposals, and do not grant execution', async () => {
  const { owner, drafts } = fixture(); const normal = { text: 'Keep this draft', uploads: [{ id: 'file' }] };
  const id = await drafts.begin({ kind: 'action', review: 'review' }, 'context');
  assert.equal(drafts.overlay(normal).text, ''); assert.equal(normal.text, 'Keep this draft');
  drafts.edit(id, 'Change the recipient.');
  const message = drafts.prepare(id, 'Change the recipient.'); assert.match(message, /pending action.*task/); assert.match(message, /not approval/);
  owner.state.pending_approval.token = 'replacement';
  assert.ok(drafts.overlay(normal).correction.issue); assert.equal(drafts.overlay(normal).text, 'Change the recipient.'); assert.throws(() => drafts.prepare(id, 'Stale'), /changed/);
  drafts.cancel(id); assert.equal(drafts.overlay(normal), normal); assert.equal(normal.uploads[0].id, 'file');
});

test('plan corrections use the retained requester and reject a changed revision before sending', async () => {
  const { owner, host, drafts } = fixture();
  const parent = { state: { conversation_id: 'parent', dialogue_active: true } }; owner.state.dialogue_task = { parent_id: 'parent' }; host.sessions.workers.add(parent);
  const id = await drafts.begin({ kind: 'plan', id: 'plan', revision: 2, digest: 'digest' }, 'context');
  assert.equal(host.backend, parent); assert.match(drafts.prepare(id, 'Use fewer steps.'), /plan task plan revision 2/);
  owner.state.task_plans[0].revision = 3; assert.throws(() => drafts.prepare(id, 'Old target'), /changed/);
  assert.throws(() => drafts.edit('invented', 'text'), /no longer selected/);
  drafts.complete(id); assert.equal(drafts.current(), undefined);
});
