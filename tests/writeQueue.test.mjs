import test from 'node:test';
import assert from 'node:assert/strict';
import { WriteQueue, WriteDiscardedError } from '../src/writeQueue.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));

test('a failed write and its dependent edits resume in order after retry', async () => {
  const failures = [];
  const queue = new WriteQueue(error => failures.push(error.message));
  const calls = [];
  let fail = true;
  const first = queue.enqueue(async () => { calls.push('first'); if (fail) throw new Error('disk full'); return 1; });
  const second = queue.enqueue(async () => { calls.push('second'); return 2; });
  await tick();
  assert.deepEqual(calls, ['first']);
  assert.deepEqual(failures, ['disk full']);
  let resolved = false;
  void second.then(() => { resolved = true; });
  await tick();
  assert.equal(resolved, false);
  fail = false;
  queue.retry();
  queue.retry();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(calls, ['first', 'first', 'second']);
});

test('repeated failures retain commands added while paused', async () => {
  let attempts = 0;
  const failures = [];
  const queue = new WriteQueue(error => failures.push(error.message));
  const first = queue.enqueue(async () => { if (++attempts < 3) throw new Error('try again'); return 'saved'; });
  await tick();
  const later = queue.enqueue(async () => 'later');
  queue.retry();
  await tick();
  assert.equal(failures.length, 2);
  queue.retry();
  assert.deepEqual(await Promise.all([first, later]), ['saved', 'later']);
});

test('explicit discard rejects pending commands without executing dependent writes', async () => {
  const queue = new WriteQueue(() => {});
  const first = queue.enqueue(async () => { throw new Error('unavailable'); });
  let ran = false;
  const later = queue.enqueue(async () => { ran = true; });
  const results = Promise.allSettled([first, later]);
  await tick();
  queue.discard();
  for (const result of await results) {
    assert.equal(result.status, 'rejected');
    assert.ok(result.reason instanceof WriteDiscardedError);
  }
  assert.equal(ran, false);
  assert.equal(await queue.enqueue(async () => 'new edit'), 'new edit');
});

test('an in-flight write cannot be discarded', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const queue = new WriteQueue(() => {});
  const result = queue.enqueue(async () => { await gate; return 'saved'; });
  assert.throws(() => queue.discard(), /Wait for the current save/);
  release();
  assert.equal(await result, 'saved');
});
