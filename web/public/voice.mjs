import { element } from './text.mjs';
import { icon } from './icons.mjs';
import { captureSpeech } from './voice-capture.mjs';
import { voiceController } from './voice-controller.mjs';

export function voiceInput({ getDraft, append, submit, capture = captureSpeech, environment = globalThis }) {
  const trigger = element('button', undefined, 'quiet icon-button'); trigger.type = 'button'; trigger.append(icon('mic')); trigger.setAttribute('aria-label', 'Voice input'); trigger.title = 'Voice input';
  const settings = element('section', undefined, 'voice-settings'); settings.id = 'voice-settings'; settings.setAttribute('popover', 'auto'); settings.setAttribute('aria-label', 'Voice settings');
  settings.setAttribute('role', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  settings.addEventListener('toggle', event => trigger.setAttribute('aria-expanded', String(event.newState === 'open')));
  trigger.setAttribute('aria-controls', settings.id); trigger.setAttribute('aria-haspopup', 'dialog');
  const heading = element('div', undefined, 'section-head'); heading.append(element('h2', 'Voice'));
  const close = element('button', undefined, 'quiet icon-button'); close.type = 'button'; close.append(icon('x')); close.setAttribute('aria-label', 'Close voice settings'); close.onclick = () => settings.hidePopover(); heading.append(close);
  const destination = element('select'); destination.id = 'voice-provider';
  for (const [value, label] of [['whisper-local', 'Whisper · on this laptop'], ['openai', 'OpenAI · cloud transcription'], ['gemini', 'Gemini · cloud transcription']]) { const option = element('option', label); option.value = value; destination.append(option); }
  const placeholder = element('option', 'Choose transcription…'); placeholder.value = ''; placeholder.disabled = true; destination.prepend(placeholder);
  const providerLabel = element('label', 'Transcription'); providerLabel.htmlFor = destination.id;
  const model = element('select'); model.id = 'voice-model';
  for (const [value, label] of [['tiny', 'Tiny · faster'], ['base', 'Base · balanced'], ['small', 'Small · more accurate']]) { const option = element('option', label); option.value = value; model.append(option); }
  const modelLabel = element('label', 'Whisper model'); modelLabel.htmlFor = model.id;
  const note = element('p', undefined, 'hint'), problem = element('p', undefined, 'issue'); problem.setAttribute('role', 'alert');
  const download = action('Download selected model', async () => {
    if (downloading) { await request({ action: 'cancel-download' }); return; }
    downloading = true; render();
    try { status = await request({ action: 'download', model: model.value }); }
    catch (error) { problem.textContent = error.message; }
    finally { downloading = false; render(); }
  });
  const dictate = action('Dictate', () => start(false)); dictate.prepend(icon('mic'));
  const conversation = action('Start voice conversation', () => start(true)); conversation.prepend(icon('audio-lines'));
  const actions = element('div', undefined, 'voice-actions'); actions.append(dictate, conversation);
  const modeNote = element('p', 'Dictation adds text for review. Voice conversation sends each spoken turn and reads replies aloud using an installed local voice.', 'hint');
  settings.append(heading, providerLabel, destination, modelLabel, model, note, download, problem, actions, modeNote);
  const bar = element('div', undefined, 'voice-bar'); bar.hidden = true; bar.setAttribute('role', 'status'); bar.setAttribute('aria-live', 'polite');
  const phaseLabel = element('span'), finish = action('Finish turn', () => controller.stop()), end = action('Cancel', () => controller.cancel()); bar.append(icon('audio-lines'), phaseLabel, finish, end);
  let latest, context, status, allowed = false, loading = false, downloading = false, speaking, speechGeneration = 0;
  async function request(body, signal) {
    const response = await environment.fetch('/api/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context, ...body }), signal });
    const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Voice request failed.'); return value;
  }
  function action(label, run) {
    const button = element('button', label, 'quiet'); button.type = 'button';
    button.onclick = () => { problem.textContent = ''; void Promise.resolve().then(run).catch(error => { problem.textContent = error.message; }); }; return button;
  }
  function render() {
    download.textContent = downloading ? 'Cancel download' : 'Download selected model';
    model.hidden = modelLabel.hidden = destination.value !== 'whisper-local';
    download.hidden = destination.value !== 'whisper-local' || !!status?.local?.models?.find(row => row.id === model.value)?.available;
    download.disabled = loading || destination.value !== status?.provider;
    const ready = controller.state.phase === 'idle' && !loading && !downloading && status?.ready && destination.value === status.provider && (destination.value !== 'whisper-local' || model.value === status.model);
    dictate.disabled = conversation.disabled = !allowed || !ready;
    destination.disabled = model.disabled = loading || downloading || controller.state.phase !== 'idle';
    note.textContent = downloading ? 'Downloading the selected Whisper model…' : loading ? 'Checking voice settings…' : status?.issue || (destination.value === 'whisper-local' ? 'Audio is transcribed on this laptop.' : 'Audio is sent to ' + destination.options[destination.selectedIndex].textContent.split(' · ')[0] + '. This uses that provider’s configured API credentials.');
    if (!environment.navigator?.mediaDevices?.getUserMedia || !environment.MediaRecorder || !environment.AudioContext || !environment.OfflineAudioContext) { dictate.disabled = conversation.disabled = true; note.textContent = 'This browser cannot record audio. Open the app in a current browser at its local address.'; }
    if (!environment.speechSynthesis) { conversation.disabled = true; }
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
    capture, draft: () => ({ ...getDraft(), allowed }), append, submit, speak, stopSpeaking,
    changed: ({ phase, live, issue }) => {
      bar.hidden = phase === 'idle' && !issue;
      phaseLabel.textContent = issue || ({ starting: 'Opening microphone…', recording: live ? 'Listening…' : 'Recording…', transcribing: 'Transcribing…', sending: 'Sending your turn…', waiting: 'Waiting for reply…', speaking: 'Speaking…' }[phase] || '');
      finish.hidden = phase !== 'recording'; end.textContent = phase === 'idle' ? 'Dismiss' : live ? 'End voice conversation' : 'Cancel';
      if (phase === 'waiting') queueMicrotask(() => void controller.update(latest || {}, status?.route));
      trigger.replaceChildren(icon(phase === 'recording' ? 'square' : 'mic')); trigger.setAttribute('aria-label', phase === 'recording' ? 'Finish recording' : 'Voice input'); render();
    },
  });
  async function configure() {
    loading = true; render(); const target = context;
    try {
      const value = await request({ action: 'configure', preferences: { provider: destination.value, model: destination.value === 'whisper-local' ? model.value : '' } });
      if (context === target) status = value;
    } finally { loading = false; render(); }
  }
  destination.onchange = model.onchange = () => { void configure().catch(error => { problem.textContent = error.message; }); };
  async function open() {
    settings.showPopover(); loading = true; render(); problem.textContent = ''; const target = context;
    try {
      const result = await request({ action: 'status' }); if (target !== context) return;
      status = result; destination.value = status.preferences?.provider || 'whisper-local'; model.value = status.preferences?.provider === 'whisper-local' ? status.model : 'base';
      // Choosing local here is explicit setup. Opening a menu never writes preferences.
      if (!status.preferences?.provider) { status = { ...status, ready: false, provider: '', issue: 'Choose Whisper to set up local voice. Cloud transcription is optional.' }; destination.value = ''; }
    } catch (error) { problem.textContent = error.message; }
    finally { loading = false; render(); }
  }
  async function start(live) { settings.hidePopover(); await controller.listen(status.route, live); }
  trigger.onclick = () => controller.state.phase === 'recording' ? controller.stop() : void open();
  environment.addEventListener?.('pagehide', () => controller.cancel());
  environment.document?.addEventListener('visibilitychange', () => { if (environment.document.hidden) controller.cancel('Voice paused while this tab is hidden.'); });
  return {
    trigger, settings, bar,
    update(value, enabled) {
      latest = value;
      if (context !== value.context) { controller.cancel(); settings.hidePopover?.(); status = undefined; }
      context = value.context; allowed = enabled; trigger.disabled = !enabled && controller.state.phase === 'idle';
      void controller.update(value, status?.route); render();
    },
  };
}
