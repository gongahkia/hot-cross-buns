import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';
import mathjax from 'mathjax-full/package.json' with { type: 'json' };

const dom = new JSDOM('', { url: 'http://127.0.0.1:4317/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location });
dom.window.HTMLElement.prototype.showPopover = function () { this.dataset.open = 'true'; };
dom.window.HTMLElement.prototype.hidePopover = function () { delete this.dataset.open; };
const { outputFiles } = await build({ entryPoints: [fileURLToPath(new URL('../public/voice.mjs', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'browser', define: { PACKAGE_VERSION: JSON.stringify(mathjax.version) }, external: ['/vendor/mermaid-entry.mjs'], plugins: [{ name: 'browser-dependencies', setup(builder) {
  for (const name of ['icons-entry', 'math-entry', 'render-deps']) builder.onResolve({ filter: new RegExp('^/vendor/' + name + '\\.mjs$') }, () => ({ path: fileURLToPath(new URL('../' + name + '.mjs', import.meta.url)) }));
} }] });
const { voiceInput } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].contents).toString('base64'));
const turn = () => new Promise(resolve => setTimeout(resolve, 0));

function fixture({ enabled = false } = {}) {
  const calls = [], appended = [], submitted = [];
  let preferences = { enabled, provider: 'whisper-local', model: 'base' }, context = 'a', finish, rejectAudio, captured = 0;
  const status = () => ({ preferences, provider: preferences.provider, model: preferences.model, ready: preferences.enabled, route: JSON.stringify(preferences) });
  const environment = { document, navigator: { mediaDevices: { getUserMedia() {} } }, MediaRecorder() {}, AudioContext() {}, OfflineAudioContext() {}, speechSynthesis: { cancel() {} },
    fetch: async (url, request) => {
      if (url.startsWith('/api/voice/audio')) { calls.push({ action: 'transcribe' }); return { ok: true, json: async () => ({ context, text: 'Spoken fixture text' }) }; }
      const body = JSON.parse(request.body); calls.push(body);
      if (body.action === 'configure') preferences = body.preferences;
      return { ok: true, json: async () => body.action === 'authorize' ? { grant: 'grant' } : status() };
    } };
  const view = voiceInput({ environment, capture: async ({ onLevel }) => {
    captured++; onLevel(.7);
    return { audio: new Promise((resolve, reject) => { finish = () => resolve(new Blob(['wav'])); rejectAudio = reject; }), stop: () => finish(), cancel: () => rejectAudio(new Error('Cancelled')) };
  }, getDraft: () => ({ context, text: '', files: 0 }), append: text => appended.push(text), submit: () => submitted.push(true) });
  document.body.replaceChildren(view.trigger, view.settings, view.bar);
  view.update({ context, connected: true }, true);
  return { view, calls, appended, submitted, captured: () => captured, switchChat() { context = 'b'; view.update({ context, connected: true }, true); }, changeRoute() { preferences = { ...preferences, model: 'tiny' }; } };
}

test('transcription is off by default; setup lives in Settings and enabling never opens a microphone', async () => {
  const { view, calls, captured } = fixture(); await turn();
  assert.equal(view.trigger.disabled, true);
  assert.match(view.trigger.title, /Settings → Voice models/);
  assert.equal(view.settings.hasAttribute('popover'), false);
  assert.equal(view.trigger.hasAttribute('aria-haspopup'), false);
  assert.equal(view.settings.querySelector('#voice-enabled').checked, false);
  view.trigger.click(); await turn(); assert.equal(captured(), 0);
  const toggle = view.settings.querySelector('#voice-enabled'); toggle.checked = true; toggle.dispatchEvent(new dom.window.Event('change')); await turn();
  assert.deepEqual(calls.find(call => call.action === 'configure').preferences, { enabled: true, provider: 'whisper-local', model: 'base' });
  assert.equal(view.trigger.disabled, false); assert.equal(captured(), 0);
  assert.doesNotMatch(JSON.stringify(calls), /api_key|OPENAI_API_KEY/);
});

test('composer microphone starts directly, meters real capture levels and finishes into an unsent draft', async () => {
  const { view, calls, captured, appended, submitted } = fixture({ enabled: true }); await turn();
  view.trigger.click(); await turn(); await turn();
  assert.equal(captured(), 1); assert.equal(view.bar.hidden, false);
  assert.equal(view.bar.dataset.phase, 'recording'); assert.equal(view.trigger.getAttribute('aria-label'), 'Finish transcription');
  assert.ok([...view.bar.querySelectorAll('.voice-waveform i')].some(node => node.style.getPropertyValue('--level') === '0.7'));
  view.bar.querySelector('[aria-label="Finish transcription"]').click(); await turn(); await turn();
  assert.deepEqual(appended, ['Spoken fixture text']); assert.deepEqual(submitted, []);
  assert.equal(calls.filter(call => call.action === 'transcribe').length, 1);
  assert.equal(view.bar.hidden, true);
});

test('cancelling or changing chats discards recording without uploading audio', async () => {
  for (const changeChat of [false, true]) {
    const fixtureView = fixture({ enabled: true }), { view, calls, appended } = fixtureView; await turn();
    view.trigger.click(); await turn(); await turn();
    if (changeChat) fixtureView.switchChat(); else view.bar.querySelector('[aria-label="Cancel recording"]').click();
    await turn(); await turn();
    assert.deepEqual(appended, []); assert.equal(calls.some(call => call.action === 'transcribe'), false);
    assert.equal(view.bar.hidden, true);
  }
});

test('a changed destination needs Settings review before microphone capture', async () => {
  const { view, changeRoute, captured, calls } = fixture({ enabled: true }); await turn(); changeRoute();
  view.trigger.click(); await turn(); await turn();
  assert.equal(captured(), 0); assert.equal(calls.some(call => call.action === 'authorize'), false);
  assert.match(view.bar.textContent, /Voice settings changed/);
});
