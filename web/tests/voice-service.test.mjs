import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { browserVoice } from '../voice-service.mjs';

function setup(run) {
  const host = new EventEmitter();
  Object.assign(host, { context: 'chat-a', backend: { state: {}, refreshPreferences: async () => {} }, sessions: {}, mutable() { if (this.backend.closed) throw new Error('Disconnected'); } });
  const calls = [];
  let clock = 0;
  const voice = browserVoice(host, { now: () => clock, run: async (_binary, _workspace, _env, request, signal) => {
    calls.push(request);
    if (request.action === 'status') return { ready: true, route: 'local-route' };
    if (run) return run(request, signal);
    return { text: 'A spoken request' };
  } });
  return { host, voice, calls, advance: n => { clock += n; }, grant: () => voice.action({ context: host.context, action: 'authorize', route: 'local-route' }) };
}

test('voice grants bind the exact chat, route and one recording; audio never submits a message', async () => {
  const { voice, calls, grant } = setup();
  await assert.rejects(voice.action({ context: 'chat-b', action: 'authorize' }), /original chat/);
  await assert.rejects(voice.action({ context: 'chat-a', action: 'authorize', route: 'another-route' }), /destination changed/);
  const { grant: id } = await grant();
  assert.deepEqual(await voice.transcribe(id, Buffer.from('wav'), 'audio/wav'), { context: 'chat-a', text: 'A spoken request' });
  assert.equal(calls.at(-1).recording.data, Buffer.from('wav').toString('base64'));
  assert.equal(calls.at(-1).route, 'local-route');
  await assert.rejects(voice.transcribe(id, Buffer.from('wav'), 'audio/wav'), /new recording/);
  voice.close();
});

test('expired, cancelled, oversized and replayed grants cannot transcribe', async () => {
  const { voice, advance, grant } = setup();
  const first = await grant(); advance(150001);
  await assert.rejects(voice.transcribe(first.grant, Buffer.from('wav'), 'audio/wav'), /new recording/);
  const second = await grant();
  await assert.rejects(voice.transcribe(second.grant, Buffer.alloc(8 * 1024 * 1024 + 1), 'audio/wav'), /two minutes/);
  await voice.action({ context: 'chat-a', action: 'cancel', grant: second.grant });
  await assert.rejects(voice.transcribe(second.grant, Buffer.from('wav'), 'audio/wav'), /new recording/);
  voice.close();
});

test('switching away aborts transcription even when its helper ignores cancellation', async () => {
  let finish, signal;
  const { host, voice, grant } = setup((_request, s) => { signal = s; return new Promise(resolve => { finish = resolve; }); });
  const { grant: id } = await grant();
  const result = voice.transcribe(id, Buffer.from('wav'), 'audio/wav');
  host.context = 'chat-b'; host.emit('change');
  assert.equal(signal.aborted, true);
  host.context = 'chat-a'; host.emit('change'); finish({ text: 'Stale' });
  await assert.rejects(result, /cancelled or chat changed/);
  voice.close();
});

test('reconfiguration revokes consent, validates fields and does not expose credentials', async () => {
  const { voice, grant } = setup(); const { grant: id } = await grant();
  await assert.rejects(voice.action({ context: 'chat-a', action: 'configure', preferences: { provider: 'openai', model: '', api_key: 'private' } }), /valid voice settings/);
  await voice.action({ context: 'chat-a', action: 'configure', preferences: { provider: 'whisper-local', model: 'base' } });
  await assert.rejects(voice.transcribe(id, Buffer.from('wav'), 'audio/wav'), /new recording/);
  voice.close();
});

test('disconnecting the audio request cancels its owned helper', async () => {
  let finish, signal;
  const { voice, grant } = setup((_request, s) => { signal = s; return new Promise(resolve => { finish = resolve; }); });
  const controller = new AbortController(), { grant: id } = await grant();
  const result = voice.transcribe(id, Buffer.from('wav'), 'audio/wav', controller.signal);
  controller.abort(); assert.equal(signal.aborted, true); finish({ text: 'Stale' });
  await assert.rejects(result, /cancelled/); voice.close();
});

test('a model download can be cancelled without blocking normal voice controls', async () => {
  let signal;
  const { voice } = setup((request, s) => { if (request.action === 'download') { signal = s; return new Promise((_resolve, reject) => s.addEventListener('abort', () => reject(new Error('Download cancelled')))); } });
  const operation = voice.action({ context: 'chat-a', action: 'download', model: 'tiny' });
  await voice.action({ context: 'chat-a', action: 'cancel-download' });
  assert.equal(signal.aborted, true); await assert.rejects(operation, /Download cancelled/);
  assert.ok(await voice.action({ context: 'chat-a', action: 'status' })); voice.close();
});
