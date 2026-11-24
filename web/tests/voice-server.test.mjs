import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.mjs';

test('browser voice is origin protected, bounded and separate from draft submission', { timeout: 30000 }, async () => {
  let transcribed = 0;
  const app = await fixture({ voiceOptions: { run: async (_binary, _workspace, _env, request) => {
    if (request.action === 'transcribe') { transcribed++; return { text: 'Spoken text' }; }
    return { ready: true, route: 'fixture-route' };
  } } });
  const abort = new AbortController();
  try {
    const response = await fetch(app.url + '/api/events', { signal: abort.signal });
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader(); let buffer = '';
    while (!buffer.includes('\n\n')) buffer += (await reader.read()).value;
    const { context } = JSON.parse(buffer.slice(6, buffer.indexOf('\n\n')));
    const post = (path, body, origin = app.url, type = 'application/json') => fetch(app.url + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': type }, body: type === 'application/json' ? JSON.stringify(body) : body });
    await post('/api/action', { op: 'save', context, text: 'Existing draft' });
    assert.equal((await post('/api/voice', { action: 'status', context }, 'https://elsewhere.test')).status, 403);
    assert.equal((await post('/api/voice', { action: 'authorize', context, route: 'wrong' })).status, 400);
    const { grant } = await (await post('/api/voice', { action: 'authorize', context, route: 'fixture-route' })).json();
    assert.ok(grant);
    assert.equal((await post('/api/voice/audio?grant=' + grant, 'wav', app.url, 'audio/webm')).status, 415);
    const audio = await post('/api/voice/audio?grant=' + grant, 'wav', app.url, 'audio/wav');
    assert.equal(audio.status, 200); assert.deepEqual(await audio.json(), { context, text: 'Spoken text' });
    assert.equal((await post('/api/voice/audio?grant=' + grant, 'wav', app.url, 'audio/wav')).status, 400);
    assert.equal(transcribed, 1); assert.equal(app.payloads.length, 0);
    assert.equal((await (await post('/api/action', { op: 'draft', context })).json()).text, 'Existing draft');
  } finally { abort.abort(); await app.close(); }
});
