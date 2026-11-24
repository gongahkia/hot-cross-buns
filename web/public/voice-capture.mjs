export function pcmWAV(samples, sampleRate = 16000) {
  const data = new ArrayBuffer(44 + samples.length * 2), view = new DataView(data);
  const text = (offset, value) => [...value].forEach((letter, i) => view.setUint8(offset + i, letter.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, data.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => { const value = Math.max(-1, Math.min(1, sample)); view.setInt16(44 + i * 2, value < 0 ? value * 32768 : value * 32767, true); });
  return new Blob([data], { type: 'audio/wav' });
}

// Capture stays in the browser. Only a stopped, bounded mono PCM recording is
// sent to the selected local helper or explicitly selected transcription API.
export async function captureSpeech({ silence = false, environment = globalThis } = {}) {
  const stream = await environment.navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
  let recorder, audio, timer, raf, cancelled = false, stopped = false, elapsed = 0;
  const cleanup = () => { clearTimeout(timer); environment.cancelAnimationFrame(raf); stream.getTracks().forEach(track => track.stop()); };
  try {
    audio = new environment.AudioContext(); await audio.resume();
    recorder = new environment.MediaRecorder(stream);
    const chunks = []; let bytes = 0, resolve, reject;
    const result = new Promise((yes, no) => { resolve = yes; reject = no; });
    const stop = () => { if (stopped) return; stopped = true; recorder.stop(); cleanup(); };
    const fail = error => { cancelled = true; stop(); reject(error); };
    recorder.ondataavailable = event => { bytes += event.data.size; if (bytes > 8 * 1024 * 1024) fail(new Error('Recording is too large. Try a shorter turn.')); else if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => fail(new Error('The microphone stopped unexpectedly. Start a new recording.'));
    recorder.onstop = async () => {
      cleanup();
      try {
        if (cancelled) throw new Error('Recording cancelled.');
        const decoded = await audio.decodeAudioData(await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer());
        if (!decoded.length || decoded.duration > 120.1) throw new Error('Record between a moment and two minutes of speech.');
        const offline = new environment.OfflineAudioContext(1, Math.min(120 * 16000, Math.ceil(decoded.duration * 16000)), 16000);
        const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
        const rendered = await offline.startRendering();
        resolve(pcmWAV(rendered.getChannelData(0)));
      } catch (error) { reject(error); }
      finally { await audio.close().catch(() => {}); }
    };
    if (silence) {
      const source = audio.createMediaStreamSource(stream), analyser = audio.createAnalyser(); analyser.fftSize = 1024; source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize); let heard = 0, quiet = 0, last = environment.performance.now();
      const tick = () => {
        if (stopped) return;
        const now = environment.performance.now(), delta = Math.min(100, now - last); last = now; elapsed += delta;
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
        if (rms > 0.015) { heard += delta; quiet = 0; } else quiet += delta;
        if (heard >= 250 && quiet >= 1100) stop();
        else if (elapsed >= 15000 && heard < 250) fail(new Error('No speech detected. Start listening again when you’re ready.'));
        else raf = environment.requestAnimationFrame(tick);
      };
      raf = environment.requestAnimationFrame(tick);
    }
    recorder.start(250); timer = setTimeout(stop, 120000);
    return { audio: result, stop, cancel: () => fail(new Error('Recording cancelled.')) };
  } catch (error) { cleanup(); await audio?.close().catch(() => {}); throw error; }
}
