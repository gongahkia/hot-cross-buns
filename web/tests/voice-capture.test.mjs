import test from 'node:test';
import assert from 'node:assert/strict';
import { captureSpeech } from '../public/voice-capture.mjs';

function environment({ recorderFailure = false } = {}) {
  let stopped = 0, closed = 0, conversion;
  class Recorder {
    mimeType = 'audio/webm';
    start() { if (recorderFailure) throw new Error('Recorder unavailable'); }
    stop() { this.ondataavailable({ data: new Blob(['encoded']) }); void this.onstop(); }
  }
  class Audio {
    async resume() {}
    async close() { closed++; }
    async decodeAudioData(bytes) { assert.equal(bytes.byteLength, 7); return { length: 48000, duration: 1 }; }
  }
  class Offline {
    constructor(channels, frames, rate) { conversion = [channels, frames, rate]; }
    createBufferSource() { return { connect() {}, start() {} }; }
    async startRendering() { return { getChannelData: () => new Float32Array(16000).fill(.1) }; }
  }
  return {
    environment: { navigator: { mediaDevices: { async getUserMedia(constraints) { assert.equal(constraints.video, false); return { getTracks: () => [{ stop() { stopped++; } }] }; } } }, MediaRecorder: Recorder, AudioContext: Audio, OfflineAudioContext: Offline, cancelAnimationFrame() {} },
    stopped: () => stopped, closed: () => closed, conversion: () => conversion,
  };
}

test('browser capture releases its microphone before converting to bounded local WAV', async () => {
  const mock = environment(); const recording = await captureSpeech(mock); recording.stop();
  assert.ok(mock.stopped()); const audio = await recording.audio;
  assert.deepEqual(mock.conversion(), [1, 16000, 16000]); assert.equal(audio.size, 32044); assert.equal(audio.type, 'audio/wav');
  await new Promise(resolve => setTimeout(resolve, 0)); assert.ok(mock.closed());
});

test('cancel and recorder startup errors release microphone and audio resources', async () => {
  const mock = environment(); const recording = await captureSpeech(mock);
  const rejected = assert.rejects(recording.audio, /cancelled/); recording.cancel(); await rejected; assert.ok(mock.stopped());
  const unavailable = environment({ recorderFailure: true }); await assert.rejects(captureSpeech(unavailable), /Recorder unavailable/);
  assert.ok(unavailable.stopped()); assert.ok(unavailable.closed());
});

test('waveform levels come from microphone samples and stop with capture', async () => {
  const mock = environment(); let tick, cancelled = 0, timestamp = 0;
  mock.environment.requestAnimationFrame = callback => { tick = callback; return 1; };
  mock.environment.cancelAnimationFrame = () => { cancelled++; };
  mock.environment.performance = { now: () => timestamp };
  mock.environment.AudioContext.prototype.createMediaStreamSource = () => ({ connect() {} });
  mock.environment.AudioContext.prototype.createAnalyser = () => ({ fftSize: 1024, getFloatTimeDomainData(samples) { samples.fill(.05); } });
  const levels = [];
  const recording = await captureSpeech({ ...mock, onLevel: level => levels.push(level) });
  timestamp = 60; tick(); assert.ok(Math.abs(levels[0] - .4) < .001);
  recording.stop(); await recording.audio; const count = levels.length;
  timestamp = 120; tick(); assert.equal(levels.length, count); assert.ok(cancelled);
});
