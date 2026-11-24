import test from 'node:test';
import assert from 'node:assert/strict';
import { voiceController } from '../public/voice-controller.mjs';
import { pcmWAV } from '../public/voice-capture.mjs';

function setup(overrides = {}) {
  let resolveAudio, reads = [], sent = [], appended = [], grants = [], stopped = 0;
  const value = { context: 'a', allowed: true, text: '', files: 0, attachments: '[]', messages: [], connected: true };
  const audio = new Promise(resolve => { resolveAudio = resolve; });
  const controller = voiceController({ authorize: async () => ({ grant: 'one' }), transcribe: async () => ({ context: 'a', text: 'Hello' }), cancelGrant: async id => grants.push(id),
    capture: async () => ({ audio, stop: () => resolveAudio(new Blob(['wav'])), cancel: () => {} }),
    draft: () => ({ ...value }), append: async text => { appended.push(text); value.text += text; },
    submit: async context => { sent.push(context); value.text = ''; }, speak: async text => reads.push(text), stopSpeaking: () => stopped++, changed() {}, ...overrides });
  return { value, controller, sent, appended, reads, grants, finish: () => resolveAudio(new Blob(['wav'])), stopped: () => stopped };
}
const turn = () => new Promise(resolve => setTimeout(resolve, 0));

test('dictation appends a transcript for review and never submits', async () => {
  const app = setup(); app.value.text = 'Existing note';
  const running = app.controller.listen('route'); await turn(); assert.equal(app.controller.state.phase, 'recording');
  app.controller.stop(); await running;
  assert.deepEqual(app.appended, ['Hello']); assert.deepEqual(app.sent, []); assert.equal(app.controller.state.phase, 'idle');
});

test('edited drafts and switched chats cannot receive stale transcripts', async () => {
  for (const mutate of [value => value.text = 'User edited', value => value.context = 'b', value => value.attachments = '["another-file"]']) {
    const app = setup(); const running = app.controller.listen('route'); await turn(); mutate(app.value); app.finish(); await running;
    assert.deepEqual(app.appended, []); assert.deepEqual(app.sent, []); assert.match(app.controller.state.issue, /draft changed/);
  }
});

test('voice conversation submits spoken turns and waits for a final reply before playback', async () => {
  let finishSpeech;
  const app = setup({ speak: () => new Promise(resolve => { finishSpeech = resolve; }) });
  const running = app.controller.listen('route', true); await turn(); app.finish(); await running;
  assert.deepEqual(app.sent, ['a']); assert.equal(app.controller.state.phase, 'waiting');
  const reply = { ...app.value, messages: [{ role: 'Hot Cross Buns', text: 'Hello back' }] };
  await app.controller.update({ ...reply, running: true }, 'route'); assert.equal(app.controller.state.phase, 'waiting');
  const playback = app.controller.update(reply, 'route'); await turn(); assert.equal(app.controller.state.phase, 'speaking');
  app.controller.cancel(); finishSpeech(); await playback;
  assert.equal(app.controller.state.phase, 'idle'); assert.equal(app.sent.length, 1); assert.ok(app.stopped());
});

test('voice conversation refuses existing drafts, active work and pending reviews', async () => {
  const app = setup(); app.value.text = 'Keep this';
  await assert.rejects(app.controller.listen('route', true), /clear the current draft/);
  app.value.text = ''; app.value.running = true;
  await assert.rejects(app.controller.listen('route', true), /finish active work/);
  app.value.running = false;
  const running = app.controller.listen('route', true); await turn(); app.finish(); await running;
  await app.controller.update({ ...app.value, approval: {} }, 'route');
  assert.match(app.controller.state.issue, /needs review/); assert.equal(app.controller.state.live, false);
});

test('cancellation during permission prompt releases late microphone access and its grant', async () => {
  let capture;
  const app = setup({ capture: () => new Promise(resolve => { capture = resolve; }) });
  const running = app.controller.listen('route'); await turn(); app.controller.cancel();
  let released = false;
  capture({ audio: Promise.reject(new Error('Cancelled')), cancel() { released = true; } });
  await running; assert.equal(released, true); assert.deepEqual(app.grants, ['one']); assert.equal(app.appended.length, 0);
});

test('PCM recordings have the exact bounded mono WAV format expected by local Whisper', async () => {
  const audio = pcmWAV(new Float32Array([-2, 0, .5, 2]));
  assert.equal(audio.type, 'audio/wav'); const bytes = await audio.arrayBuffer(), view = new DataView(bytes);
  assert.equal(bytes.byteLength, 52); assert.equal(view.getUint32(24, true), 16000); assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getInt16(44, true), -32768); assert.equal(view.getInt16(50, true), 32767);
});
