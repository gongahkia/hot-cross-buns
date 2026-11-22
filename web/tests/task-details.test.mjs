import assert from 'node:assert/strict';
import test from 'node:test';
import { taskDetails } from '../task-details.mjs';

function fixture(state) {
  const calls = [], owner = { state, recovery: async frame => { calls.push(frame); return frame.type === 'receipt' ? { check: { status: 'unconfirmed' } } : { accepted: true }; } };
  const host = { backend: owner, mutable() {}, sessions: { workers: new Set([owner]), canOpen: () => false, activity: () => [{ id: state.conversation_id }], assertSend() {} } };
  return { calls, owner, host, details: taskDetails(host) };
}
const receipt = { ID: 'action-' + 'a'.repeat(16), Operation: 'gmail_send', Status: 'unknown', CorrelationID: 'b'.repeat(32), Recipient: 'fixture@example.invalid' };
const bundle = () => ({ RunID: 'run-fixture', ManifestSHA256: 'c'.repeat(64), Actions: [{ ...receipt }] });

test('task inspection exposes only retained evidence, hides authority, and starts no owner or model work', () => {
  const { details, calls } = fixture({ conversation_id: 'chat', dialogue_task: { turn_id: 'original', parent_id: 'parent' }, request_recoveries: [{ task_id: 'd'.repeat(32), token: 'secret token', text: 'Original request', state: 'failed', recovery: { summary: 'Interrupted', retry_safe: true } }], messages: [{ bundle: bundle() }], private: 'credentials', activity: { entries: [{ arguments: 'private arguments' }] } });
  const value = details.inspect('chat'); assert.equal(calls.length, 0); assert.equal(value.identity.find(item => item.name === 'original_turn').value, 'original');
  assert.equal(value.records.length, 1); assert.ok(value.receipts[0].selection); assert.ok(value.records[0].selection);
  assert.doesNotMatch(JSON.stringify(value), /secret token|credentials|private arguments/);
  assert.throws(() => details.inspect('unowned'), /No replacement was started/);
});

test('receipt checks bind exact retained evidence and cannot replay a consumed or stale selection', async () => {
  const { owner, details, calls } = fixture({ conversation_id: 'chat', messages: [{ bundle: bundle() }] });
  let selection = details.inspect('chat').receipts[0].selection;
  assert.equal((await details.control({ selection, action: 'inspect' })).check.status, 'unconfirmed');
  assert.equal(calls[0].receipt.conversation_id, 'chat'); assert.equal(calls[0].receipt.manifest_sha256, 'c'.repeat(64));
  await assert.rejects(details.control({ selection, action: 'resend' }), /unavailable/);
  await details.control({ selection, action: 'check_sent' });
  await assert.rejects(details.control({ selection, action: 'check_sent' }), /changed/);
  selection = details.inspect('chat').receipts[0].selection;
  owner.state.messages[0].bundle.Actions[0].Status = 'executed';
  await assert.rejects(details.control({ selection, action: 'check_sent' }), /changed/);
  assert.equal(calls.length, 2);
});

test('conflicting snapshots, duplicate receipts, journal-only attempts, and other owners provide no external-check controls', () => {
  const a = bundle(), b = bundle(); b.Actions[0].Status = 'executed';
  const { details, host, owner } = fixture({ conversation_id: 'chat', messages: [{ bundle: a }], work_details: { latest_bundle: b }, action_recoveries: [{ id: 'journal', run_id: 'unsealed', receipt }] });
  let result = details.inspect('chat'); assert.equal(result.receipts.length, 2); assert.ok(result.receipts.every(item => !item.selection)); assert.match(result.notices[0], /Conflicting/);
  delete owner.state.work_details; owner.state.messages[0].bundle.Actions.push({ ...receipt });
  assert.ok(details.inspect('chat').receipts.every(item => !item.selection));
  host.sessions.canOpen = () => true; host.backend = { state: { conversation_id: 'different' } };
  result = details.inspect('chat'); assert.equal(result.current, false); assert.ok(result.receipts.every(item => !item.selection));
});

test('recovery preparation requires a current original request and exact reviewed configured access', async () => {
  const recovery = { task_id: 'd'.repeat(32), token: 'e'.repeat(64), text: 'Original request', state: 'failed', recovery: { retry_safe: true, needs: [{ operation: 'gmail_read' }] } };
  const { owner, details, calls } = fixture({ conversation_id: 'chat', request_recoveries: [recovery] });
  owner.recovery = async frame => { calls.push(frame); return frame.request_recovery.action === 'review_access' ? { access_review: { token: 'f'.repeat(64), connections: ['account-a'], ready: true, requirements: [] } } : { accepted: true }; };
  const selection = details.inspect('chat').records[0].selection;
  await assert.rejects(details.control({ selection, action: 'prepare_access', connections: ['account-a'] }), /Review the exact/);
  const reviewed = await details.control({ selection, action: 'review_access' }); assert.equal(reviewed.access.token, undefined);
  await assert.rejects(details.control({ selection, action: 'prepare_access', connections: ['account-b'] }), /Review the exact/);
  await details.control({ selection, action: 'prepare_access', connections: ['account-a'] });
  assert.equal(calls.at(-1).request_recovery.access_token, 'f'.repeat(64)); assert.equal(calls.at(-1).request_recovery.token, 'e'.repeat(64));
  await assert.rejects(details.control({ selection, action: 'prepare_access', connections: ['account-a'] }), /changed/);
});
