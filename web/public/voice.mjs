import { element } from './text.mjs';
import { icon } from './icons.mjs';
import { captureSpeech } from './voice-capture.mjs';
import { voiceController } from './voice-controller.mjs';

export function voiceInput({ getDraft, append, submit, closeSettings = () => {}, capture = captureSpeech, environment = globalThis }) {
  const trigger = element('button', undefined, 'quiet icon-button'); trigger.type = 'button'; trigger.append(icon('mic'));
  const settings = element('section', undefined, 'voice-settings');
  const enabled = element('input'); enabled.type = 'checkbox'; enabled.id = 'voice-enabled';
  const enabledLabel = element('label', undefined, 'voice-toggle'); enabledLabel.append(enabled, element('span', 'Enable transcription'));
  const destination = element('select'); destination.id = 'voice-provider';
  for (const [value, label] of [['whisper-local', 'Whisper · on this laptop'], ['openai', 'OpenAI · cloud transcription'], ['gemini', 'Gemini · cloud transcription']]) { const option = element('option', label); option.value = value; destination.append(option); }
  const providerLabel = element('label', 'Transcription provider'); providerLabel.htmlFor = destination.id;
  const model = element('select'); model.id = 'voice-model';
  for (const [value, label] of [['tiny', 'Tiny · faster'], ['base', 'Base · balanced'], ['small', 'Small · more accurate']]) { const option = element('option', label); option.value = value; model.append(option); }
  model.value = 'base';
  const cloudModel = element('input'); cloudModel.type = 'text'; cloudModel.id = 'voice-cloud-model'; cloudModel.maxLength = 128;
  const modelLabel = element('label', 'Whisper model'); modelLabel.htmlFor = model.id;
  const cloudLabel = element('label', 'Cloud model'); cloudLabel.htmlFor = cloudModel.id;
  const note = element('p', undefined, 'hint'), problem = element('p', undefined, 'issue'); problem.setAttribute('role', 'alert');
  const download = action('Download selected model', async () => {
    if (downloading) { await request({ action: 'cancel-download' }); return; }
    downloading = true; render(); const target = context;
    try { const value = await request({ action: 'download', model: model.value }); if (context === target) status = value; }
    finally { downloading = false; render(); }
  });
  const conversation = action('Start voice conversation', () => start(true)); conversation.prepend(icon('audio-lines'));
  const refresh = action('Check availability', () => load());
  const actions = element('div', undefined, 'voice-actions'); actions.append(refresh, conversation);
  settings.append(element('p', 'Transcription is off until you enable it. The microphone button adds spoken text to your draft for review.', 'hint'), enabledLabel, providerLabel, destination, modelLabel, model, cloudLabel, cloudModel, note, download, problem, actions,
    element('p', 'Voice conversation sends each spoken turn and reads replies aloud using an installed local voice.', 'hint'));
  const bar = element('div', undefined, 'voice-bar'); bar.hidden = true;
  const phaseLabel = element('span', undefined, 'voice-phase'); phaseLabel.setAttribute('role', 'status'); phaseLabel.setAttribute('aria-live', 'polite');
  const waveform = element('div', undefined, 'voice-waveform'); waveform.setAttribute('aria-hidden', 'true');
  const bars = Array.from({ length: 48 }, () => element('i')); waveform.append(...bars);
  const levels = Array(bars.length).fill(0);
  const finish = action('Finish transcription', () => controller.stop(), true, 'square');
  const end = action('Cancel recording', () => controller.cancel(), true, 'x');
  bar.append(end, waveform, finish, phaseLabel);
  let latest, context, status, allowed = false, loading = false, downloading = false, speaking, speechGeneration = 0, revision = 0, starting = false;
  function meter(level) {
    levels.shift(); levels.push(Math.min(1, Math.max(0, level)));
    bars.forEach((node, i) => node.style.setProperty('--level', String(levels[i])));
  }
  async function request(body, signal) {
    const response = await environment.fetch('/api/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context, ...body }), signal });
    const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Voice request failed.'); return value;
  }
  function action(label, run, compact = false, glyph) {
    const button = element('button', compact ? undefined : label, compact ? 'quiet icon-button' : 'quiet'); button.type = 'button';
    if (compact) { button.append(icon(glyph)); button.setAttribute('aria-label', label); button.title = label; }
    button.onclick = () => { problem.textContent = ''; void Promise.resolve().then(run).catch(error => { problem.textContent = error.message; }); }; return button;
  }
  const browserReady = () => !!(environment.navigator?.mediaDevices?.getUserMedia && environment.MediaRecorder && environment.AudioContext && environment.OfflineAudioContext);
  function render() {
    const idle = controller.state.phase === 'idle', local = destination.value === 'whisper-local';
    download.textContent = downloading ? 'Cancel download' : 'Download selected model';
    model.hidden = modelLabel.hidden = !local;
    cloudModel.hidden = cloudLabel.hidden = local;
    download.hidden = !local || !!status?.local?.models?.find(row => row.id === model.value)?.available;
    download.disabled = loading || destination.value !== status?.provider;
    enabled.disabled = destination.disabled = model.disabled = cloudModel.disabled = loading || downloading || !idle || starting;
    refresh.disabled = loading || downloading || !idle;
    conversation.disabled = !allowed || !idle || starting || loading || downloading || !status?.ready || !browserReady() || !environment.speechSynthesis;
    note.textContent = downloading ? 'Downloading the selected Whisper model…' : loading ? 'Checking voice settings…' : status?.issue || (local ? 'Audio is transcribed on this laptop. No API key is needed.' : 'Audio is sent to ' + destination.options[destination.selectedIndex].textContent.split(' · ')[0] + ' using its configured API credentials. Configure credentials in Settings → Models.');
    const recording = controller.state.phase === 'recording';
    trigger.hidden = !status?.ready;
    trigger.disabled = !recording && (!idle || !allowed || starting || loading || downloading || !status?.ready || !browserReady());
    const label = recording ? 'Finish transcription' : 'Transcribe';
    trigger.setAttribute('aria-label', label);
    trigger.title = !status?.preferences?.enabled ? 'Enable transcription in Settings → Voice models' : !browserReady() ? 'Microphone capture is unavailable in this browser' : status?.issue || label;
    trigger.replaceChildren(icon(recording ? 'square' : 'mic'));
  }
  function stopSpeaking() { speechGeneration++; environment.speechSynthesis?.cancel(); speaking?.(); speaking = undefined; }
  async function speak(text) {
    const synth = environment.speechSynthesis;
    if (!synth) throw new Error('Speech playback is unavailable. Your reply is in the chat.');
    const version = speechGeneration;
    if (!synth.getVoices().length) await new Promise(resolve => { const finish = () => { clearTimeout(timer); synth.removeEventListener('voiceschanged', finish); resolve(); }; const timer = setTimeout(finish, 1000); synth.addEventListener('voiceschanged', finish); });
    if (version !== speechGeneration) return;
    const voices = synth.getVoices().filter(voice => voice.localService);
    if (!voices.length) throw new Error('Install a local system voice to hear replies. Your reply is in the chat.');
    const voice = voices.find(voice => voice.lang.startsWith(environment.navigator.language?.split('-')[0] || 'en')) || voices[0];
    const plain = text.replace(/```[\s\S]*?```/g, ' Code is shown in the chat. ').replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/^[#>\s*-]+/gm, '').replace(/[`*_]/g, '').trim();
    for (const chunk of plain.match(/[^.!?\n]{1,500}[.!?\n]?/g) || []) {
      if (version !== speechGeneration) return;
      await new Promise((resolve, reject) => { const utterance = new environment.SpeechSynthesisUtterance(chunk); utterance.voice = voice; utterance.onend = () => { speaking = undefined; resolve(); }; utterance.onerror = event => { speaking = undefined; reject(new Error('Speech playback stopped: ' + event.error)); }; speaking = resolve; synth.speak(utterance); });
    }
  }
  const controller = voiceController({
    authorize: (route, target) => request({ action: 'authorize', context: target, route }),
    cancelGrant: (grant, target) => request({ action: 'cancel', context: target, grant }),
    transcribe: async (grant, audio, signal) => { const response = await environment.fetch('/api/voice/audio?grant=' + encodeURIComponent(grant), { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: audio, signal }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Transcription failed.'); return result; },
    capture: options => capture({ ...options, onLevel: meter }), draft: () => ({ ...getDraft(), allowed }), append, submit, speak, stopSpeaking,
    changed: ({ phase, live, issue }) => {
      bar.hidden = phase === 'idle' && !issue;
      phaseLabel.textContent = issue || ({ starting: 'Opening microphone…', recording: live ? 'Listening…' : 'Recording…', transcribing: 'Transcribing…', sending: 'Sending your turn…', waiting: 'Waiting for reply…', speaking: 'Speaking…' }[phase] || '');
      finish.hidden = phase !== 'recording';
      end.setAttribute('aria-label', phase === 'idle' ? 'Dismiss transcription message' : live ? 'End voice conversation' : 'Cancel recording'); end.title = end.getAttribute('aria-label');
      bar.dataset.phase = phase;
      phaseLabel.classList.toggle('sr-only', phase === 'recording');
      waveform.hidden = phase !== 'recording';
      if (phase === 'starting' || phase === 'idle') { levels.fill(0); meter(0); }
      if (phase === 'waiting') queueMicrotask(() => void controller.update(latest || {}, status?.route));
      render();
    },
  });
  function selectStatus(value) {
    status = value; enabled.checked = !!status.preferences?.enabled;
    destination.value = status.provider || 'whisper-local';
    if (destination.value === 'whisper-local') model.value = status.model || 'base';
    else cloudModel.value = status.model || '';
  }
  async function load() {
    const version = ++revision, target = context; loading = true; problem.textContent = ''; render();
    try { const value = await request({ action: 'status' }); if (version === revision && context === target) selectStatus(value); }
    catch (error) { if (version === revision) problem.textContent = error.message; }
    finally { if (version === revision) { loading = false; render(); } }
  }
  async function configure(event) {
    const version = ++revision, target = context; loading = true; problem.textContent = ''; render();
    if (event.target === destination) cloudModel.value = '';
    try {
      const value = await request({ action: 'configure', preferences: { enabled: enabled.checked, provider: destination.value, model: destination.value === 'whisper-local' ? model.value : cloudModel.value.trim() } });
      if (version === revision && context === target) selectStatus(value);
    } catch (error) { if (version === revision) { enabled.checked = !!status?.preferences?.enabled; problem.textContent = error.message; } }
    finally { if (version === revision) { loading = false; render(); } }
  }
  enabled.onchange = destination.onchange = model.onchange = cloudModel.onchange = configure;
  async function start(live) {
    if (starting || controller.state.phase !== 'idle') return;
    starting = true; render(); const target = context;
    try {
      const reviewedRoute = status?.route;
      const fresh = await request({ action: 'status' });
      if (target !== context) return;
      if (!fresh.ready) throw new Error(fresh.issue || 'Enable and configure transcription in Settings → Voice models.');
      // An external settings edit must be seen before consenting to a new route.
      if (fresh.route !== reviewedRoute) throw new Error('Voice settings changed. Check Settings → Voice models before recording.');
      selectStatus(fresh); closeSettings(); await controller.listen(fresh.route, live);
    } catch (error) { if (target === context) controller.cancel(error.message); }
    finally { starting = false; render(); }
  }
  trigger.onclick = () => controller.state.phase === 'recording' ? controller.stop() : void start(false);
  environment.addEventListener?.('pagehide', () => controller.cancel());
  environment.document?.addEventListener('visibilitychange', () => { if (environment.document.hidden) controller.cancel('Voice paused while this tab is hidden.'); });
  render();
  return {
    trigger, settings, bar, load,
    update(value, editable) {
      latest = value;
      if (context !== value.context) { controller.cancel(); status = undefined; revision++; loading = false; }
      context = value.context; allowed = editable;
      void controller.update(value, status?.route); render();
      if (allowed && !status && !loading) void load();
    },
  };
}
