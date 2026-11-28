import assert from 'node:assert/strict';
import test from 'node:test';
import { transcriptItems } from '../public/transcript.mjs';

test('retained welcome stays before newer work and dialogue without changing approval indexes', () => {
  const welcome = { introduction: true, created_at: '2026-11-28T01:00:00Z' };
  const work = { created_at: '2026-11-28T03:00:00Z' };
  const approval = { result: { kind: 'approval' } };
  const messages = [work, approval, welcome];
  const talk = { created_at: '2026-11-28T02:00:00Z' };
  const update = { created_at: '2026-11-28T04:00:00Z' };
  for (let render = 0; render < 2; render++) {
    assert.deepEqual(transcriptItems(messages, [talk], [update]).map(item => item.value), [welcome, talk, work, approval, update]);
    assert.equal(messages[1], approval);
    assert.equal(messages[2], welcome);
  }
});
