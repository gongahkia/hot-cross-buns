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

test('voice menu requires explicit local setup and keeps cloud credentials outside the browser', async () => {
  const calls = [];
  const environment = { document, navigator: { mediaDevices: { getUserMedia() {} } }, MediaRecorder() {}, AudioContext() {}, OfflineAudioContext() {}, speechSynthesis: { cancel() {} },
    fetch: async (_url, request) => { const body = JSON.parse(request.body); calls.push(body); return { ok: true, json: async () => body.action === 'configure' ? { preferences: body.preferences, provider: body.preferences.provider, model: body.preferences.model, ready: true, route: 'local' } : { preferences: {}, provider: 'openai', ready: true, route: 'cloud' } }; } };
  const view = voiceInput({ environment, getDraft: () => ({}), append() {}, submit() {} });
  document.body.append(view.trigger, view.settings, view.bar);
  view.update({ context: 'a', connected: true }, true); view.trigger.click(); await turn();
  assert.ok(view.trigger.querySelector('[data-icon="mic"]'));
  assert.equal(calls.length, 1); assert.equal(calls[0].action, 'status');
  const select = view.settings.querySelector('#voice-provider'); assert.equal(select.value, '');
  assert.equal([...view.settings.querySelectorAll('button')].find(button => button.textContent === 'Dictate').disabled, true);
  select.value = 'whisper-local'; select.dispatchEvent(new dom.window.Event('change')); await turn();
  assert.deepEqual(calls[1].preferences, { provider: 'whisper-local', model: 'base' });
  assert.equal([...view.settings.querySelectorAll('button')].find(button => button.textContent === 'Dictate').disabled, false);
  assert.doesNotMatch(JSON.stringify(calls), /api_key|OPENAI_API_KEY/);
  assert.equal(view.settings.getAttribute('role'), 'dialog');
});
