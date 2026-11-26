import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './fixture.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
test('browser lifecycle reaches the private Go owner without model work or an external runtime mutation', { timeout: 40000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hcb-web-runtime-'));
  const binary = join(directory, 'ollama' + (process.platform === 'win32' ? '.exe' : ''));
  await promisify(execFile)('go', ['build', '-o', binary, './internal/localruntime/testdata/fakeollama'], { cwd: fileURLToPath(new URL('../..', import.meta.url)), timeout: 20000 });
  const app = await fixture({ runtimePath: directory });
  let context;
  const action = async value => {
    const response = await fetch(app.url + '/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.url }, body: JSON.stringify({ op: 'local-models', context, ...value }) });
    return { code: response.status, ...await response.json() };
  };
  const until = async predicate => {
    for (let n = 0; n < 80; n++) { const value = await action({ action: 'runtime_status' }); if (predicate(value)) return value; await delay(50); }
    assert.fail('runtime outcome was not observed');
  };
  let running = false;
  try {
    const abort = new AbortController(), response = await fetch(app.url + '/api/events', { signal: abort.signal });
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    while (!context) {
      const { value } = await reader.read(); buffer += value;
      const end = buffer.indexOf('\n\n');
      if (end !== -1) { const snapshot = JSON.parse(buffer.slice(6, end)); buffer = buffer.slice(end + 2); if (snapshot.connection === 'connected') context = snapshot.context; }
    }
    abort.abort();
    const status = await action({ action: 'local_status', app_owned: true });
    assert.equal(status.code, 200); assert.equal(status.runtime.state, 'stopped');
    assert.ok(status.local.catalog.length > 0);
    assert.equal(status.local.installed_known, false);
    assert.equal((await action({ action: 'runtime_start' })).code, 400);
    assert.equal((await action({ action: 'runtime_status', app_owned: true })).code, 400);
    const reviewed = await action({ action: 'runtime_review_start' });
    assert.equal(reviewed.runtime.state, 'stopped'); assert.equal(reviewed.runtime_review.binary, await realpath(binary));
    const review = reviewed.runtime_review;
    assert.equal((await action({ action: 'runtime_start', review_id: review.id, generation: 'wrong' })).confirmed, false);
    const started = await action({ action: 'runtime_start', review_id: review.id, generation: review.generation });
    running = true;
    assert.equal(started.confirmed, true);
    const ready = await until(value => value.runtime?.state === 'running');
    assert.match(ready.runtime.endpoint, /^https:\/\/127\.0\.0\.1:/);
    const inventory = await action({ action: 'local_status', app_owned: true });
    assert.equal(inventory.local.reachable, true); assert.equal(inventory.local.installed.length, 0);
    assert.ok(inventory.local.catalog.length > 0);
    const download = await action({ action: 'runtime_review_download', model_id: 'qwen2.5-coder-0.5b' });
    assert.equal(download.code, 200);
    if (download.runtime_review) {
      assert.equal(download.runtime_review.model_id, 'qwen2.5-coder-0.5b');
      await action({ action: 'runtime_cancel_review', review_id: download.runtime_review.id, generation: download.runtime_review.generation });
    }
    assert.equal(JSON.stringify(inventory).includes('certificate'), false);
    assert.equal(JSON.stringify(inventory).includes('"token"'), false);
    const stop = await action({ action: 'runtime_review_stop' });
    const stopped = await action({ action: 'runtime_stop', review_id: stop.runtime_review.id, generation: stop.runtime_review.generation });
    assert.equal(stopped.confirmed, true);
    await until(value => value.runtime?.state === 'stopped'); running = false;
    assert.equal(app.payloads.length, 0);
  } finally {
    if (running) {
      const stop = await action({ action: 'runtime_review_stop' });
      if (stop.runtime_review) await action({ action: 'runtime_stop', review_id: stop.runtime_review.id, generation: stop.runtime_review.generation });
    }
    await delay(1500); await app.close(); await rm(directory, { recursive: true, force: true });
  }
});
