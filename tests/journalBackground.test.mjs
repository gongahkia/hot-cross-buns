import assert from 'node:assert/strict';
import test from 'node:test';
import { JournalBackground, JournalWorkerUnavailable, materializeJournalAsync, readJournalAsync } from '../src/journalBackground.ts';
import { createJournal, journalFromPlanner, parseJournal } from '../src/journalDocument.ts';
import { createJournalWorkerHost, runJournalWork } from '../src/journalWorker.ts';

class Port {
  messages = []; terminated = false;
  postMessage(message) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  finish(index = 0) { this.onmessage({ data: runJournalWork(this.messages[index]) }); }
}

test('background requests correlate out-of-order responses and preserve exact source', async () => {
  const port = new Port(), client = new JournalBackground(() => port);
  const source = createJournal('background').source;
  const first = client.request({ kind: 'parse', source });
  const second = client.request({ kind: 'parse', source: source.replace('Inbox', 'Ideas') });
  port.finish(1); port.finish(0);
  assert.equal((await first).model.source, source);
  assert.equal((await second).model.undated[0].name, 'Ideas');
  client.dispose();
});

test('cancelled and stale responses cannot resolve another request', async () => {
  const port = new Port(), client = new JournalBackground(() => port);
  const controller = new AbortController(), source = createJournal('cancelled').source;
  const pending = client.request({ kind: 'parse', source }, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  const current = client.request({ kind: 'parse', source });
  port.finish(0); port.finish(1);
  assert.equal((await current).id, port.messages[1].id);
  await assert.rejects(client.request({ kind: 'parse', source }, controller.signal), { name: 'AbortError' });
  assert.equal(port.messages.length, 2);
  client.dispose();
});

test('worker errors release outstanding work and a retry starts a fresh worker', async () => {
  const ports = [], client = new JournalBackground(() => { const port = new Port(); ports.push(port); return port; });
  const source = createJournal('worker-error').source;
  const first = client.request({ kind: 'parse', source });
  ports[0].onerror(new Event('error'));
  await assert.rejects(first, error => error instanceof JournalWorkerUnavailable && error.message.includes('validation failed'));
  assert.equal(ports[0].terminated, true);
  const second = client.request({ kind: 'parse', source });
  ports[1].finish();
  assert.equal((await second).model.source, source);
  client.dispose();
});

test('outstanding work and stalled workers are bounded', async () => {
  const port = new Port(), client = new JournalBackground(() => port, 20);
  const source = createJournal('bounded-work').source;
  const pending = Array.from({ length: 8 }, () => client.request({ kind: 'parse', source }));
  const settled = Promise.allSettled(pending);
  await assert.rejects(client.request({ kind: 'parse', source }), /busy/);
  const results = await settled;
  assert.ok(results.every(result => result.status === 'rejected' && result.reason.message.includes('time budget')));
  assert.ok(results.every(result => !(result.reason instanceof JournalWorkerUnavailable)), 'a deadline must not resubmit the same expensive parse on the UI thread');
  assert.equal(port.terminated, true);
});

test('parser failures keep source recoverable and cannot become materialized content', async () => {
  const port = new Port(), client = new JournalBackground(() => port);
  const source = createJournal('invalid-source').source.replace('hcb-format: 1', 'hcb-format: 999');
  const pending = client.request({ kind: 'parse', source });
  port.finish();
  const result = await pending;
  assert.equal(result.model.source, source);
  assert.ok(result.model.issues.some(issue => issue.code === 'format-version'));
  const invalid = parseJournal(source).document;
  const materialized = client.request({ kind: 'materialize', document: invalid });
  port.finish(1);
  await assert.rejects(materialized, /Only hcb-format/);
  client.dispose();
});

test('worker materialization and upgrades retain source identity and synchronous callers remain supported', async () => {
  const before = createJournal('worker-edits');
  const changed = structuredClone(before);
  changed.scratchpad = 'New capture\n';
  const result = runJournalWork({ id: 1, kind: 'materialize', document: changed });
  assert.equal(result.ok, true);
  assert.equal(result.model.documentId, 'worker-edits');
  assert.ok(result.model.source.endsWith('New capture\n'));
  const upgrade = runJournalWork({ id: 2, kind: 'upgrade', document: before });
  assert.equal(upgrade.model.format, 2);
  assert.equal(upgrade.checkboxChanges, 0);
  assert.equal((await readJournalAsync(before.source)).document.source, before.source);
  assert.equal((await materializeJournalAsync(changed)).source, result.model.source);
  assert.equal((await materializeJournalAsync(before)), before);
});

test('an unchanged working copy reuses its validated model instead of parsing again', () => {
  const before = createJournal('unchanged-worker');
  const parsed = runJournalWork({ id: 1, kind: 'parse', source: before.source });
  const materialized = runJournalWork({ id: 2, kind: 'materialize', document: structuredClone(before) });
  assert.equal(materialized.model, parsed.model);
  assert.equal(materialized.model.source, before.source);
});


class CompactPort extends Port {
  host = createJournalWorkerHost(); responses = [];
  postMessage(message) { super.postMessage(structuredClone(message)); }
  finish(index = 0, change = value => value) {
    const result = change(structuredClone(this.host(this.messages[index])));
    this.responses.push(result); this.onmessage({ data: result });
  }
}
const compactSource = () => createJournal('background-compact',3).source.replace('## Dated\n', '## Dated\n\n### 2026-11-18\n\n- [ ] Alpha\n  ```hcb\n  id: alpha\n  ```\n');
async function bootstrap(client, port) {
 const source=compactSource(),pending=client.request({kind:'parse',source});port.finish(port.messages.length-1);
 const model=(await pending).model;return journalFromPlanner(model).document;
}
const completed = document => { const next=structuredClone(document);next.days[0].items[0].completed=true;return next; };

test('background negotiates a compact response and preserves the original immutable baseline', async()=>{
 const port=new CompactPort(),client=new JournalBackground(()=>port);
 const document=await bootstrap(client,port),pending=client.request({kind:'materialize',document:completed(document)});
 assert.equal(port.messages[1].baselineId,port.messages[0].id);port.finish(1);
 assert.ok(port.responses[1].delta);assert.equal('model' in port.responses[1],false);
 const result=await pending;assert.equal(result.model.source,document.source.replace('[ ] Alpha','[x] Alpha'));
 assert.equal(document.days[0].items[0].completed,false);assert.ok(Object.isFrozen(result.model));
 client.dispose();
});
