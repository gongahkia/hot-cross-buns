import mathjaxPackage from "mathjax-full/package.json" with { type: "json" };
import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { fileURLToPath } from "node:url";
import { createMemorySamples } from './memory-samples.mjs';

const dom = new JSDOM("", { url: "http://127.0.0.1:4317/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
const { outputFiles } = await build({
  stdin: { contents: 'export * from "./public/technical-activity.mjs"; export * from "./public/task-identity.mjs"; export * from "./public/task-handoff.mjs"; export * from "./public/event-hooks.mjs"; export * from "./public/introduction.mjs"; export * from "./public/review-queue.mjs"; export * from "./public/answer-context.mjs"; export * from "./public/models-view.mjs"; export * from "./public/model-picker.mjs"; export * from "./public/local-browser.mjs"; export * from "./public/local-url.mjs"; export * from "./public/canvas.mjs"; export * from "./public/file-references.mjs"; export * from "./public/response-actions.mjs"; export * from "./public/usage.mjs"; export * from "./public/brands.mjs"; export * from "./public/text.mjs"; export * from "./public/palette.mjs"; export * from "./public/activity.mjs"; export * from "./public/attachments.mjs"; export * from "./public/memory.mjs"; export * from "./public/task-inspector.mjs"; export * from "./public/scheduled.mjs"; export * from "./public/icons.mjs"; export * from "./public/chats.mjs"; export * from "./public/views.mjs"; export * from "./public/local-models.mjs"; export * from "./public/fields.mjs"; export * from "./public/find.mjs"; export * from "./public/reading.mjs"; export * from "./public/reactions.mjs"; export * from "./public/task-details.mjs"; export * from "./public/workspace.mjs"; export * from "./public/streaming.mjs"; export * from "./public/reviews.mjs";', resolveDir: fileURLToPath(new URL("..", import.meta.url)) },
  define: { PACKAGE_VERSION: JSON.stringify(mathjaxPackage.version) },
    bundle: true, write: false, format: "esm", platform: "browser",
  external: ["/vendor/mermaid-entry.mjs"],
  plugins: [{ name: 'bakery-catalog', setup(builder) {
    builder.onResolve({filter:/^\/bakery\.json$/},()=>({path:fileURLToPath(new URL('../../internal/branding/bakery.json',import.meta.url))}));
  } }, { name: "local-browser-dependencies", setup(builder) {
    builder.onResolve({ filter: /^\/vendor\/math-entry\.mjs$/ }, () => ({
      path: fileURLToPath(new URL("../math-entry.mjs", import.meta.url)),
    }));
    builder.onResolve({ filter: /^\/vendor\/render-deps\.mjs$/ }, () => ({
      path: fileURLToPath(new URL("../render-deps.mjs", import.meta.url)),
    }));
    builder.onResolve({ filter: /^\/vendor\/icons-entry\.mjs$/ }, () => ({
      path: fileURLToPath(new URL("../icons-entry.mjs", import.meta.url)),
    }));
  } }],
});
const { sourceChip, taskConversations, checkLocalServer, technicalActivity, taskBread, taskHandoff, eventEndpoint, introduction, reviewQueue, answerContextRun, answerContextView, modelsView, currentPlan, modelPicker, localBrowser, localAppURL, planQuestions, canvasWorkspace, fileReferences, responseInteractions, parseQuotedRequest, usageView, usageLimits, brandIcon, setBrandIcon, providerBrand, prose, installPalette, activityView, elapsed, attachmentCard, previewContent, pastedFiles, memoryPane, taskInspector, composerProgress, scheduledPane, icon, activityIconNames, decorateIcons, chatMenu, settingsView, localModelsView, panelField, transcriptFind, readingPosition, reactionFor, reactionPreference, reactionChip, taskDetailView, workspaceView, StreamingReveal, streamingResponse, turn, planReview, correctionText } = await import("data:text/javascript;base64," + Buffer.from(outputFiles[0].contents).toString("base64"));

test('Plan is scoped to active retained planning rather than draft preferences or ordinary chat',()=>{
  assert.equal(currentPlan(),null);assert.equal(currentPlan({plans:[],peers:[]}),null);
  assert.equal(currentPlan({plan_first:true}),null);
  assert.equal(currentPlan({plans:[{id:'old',state:'completed',phase:'finished'}]}),null);
  assert.equal(currentPlan({plans:[{id:'current',state:'queued',phase:'review'}]}).plan.id,'current');
  assert.equal(currentPlan({peers:[{conversation_id:'child',plan_phase:'preparing'}]}).conversation,'child');
});

test('answer context opens with actual saved text and source excerpts without command hints or extra clicks', async () => {
  const view = answerContextView({ request: async () => ({ context: { Outcome: 'Review the config', Usage: '2 model requests', Items: [{ Title: 'Preferences', Text: 'Use Neovim\nKeep existing keymaps', Updated: 'Supplied at run start' }] }, references: [{ label: 'init.lua', locator: 'source/init.lua', preview: { text: 'vim.opt.number = true\n<script>bad()</script>' } }] }) });
  document.body.append(view.element);
  await view.load();
  assert.match(view.element.textContent, /Use Neovim\nKeep existing keymaps/);
  assert.match(view.element.textContent, /vim.opt.number = true/);
  assert.match(view.element.textContent, /Supplied at run start/);
  assert.equal(view.element.querySelectorAll('button').length, 0);
  assert.equal(view.element.querySelector('script'), null);
  assert.doesNotMatch(view.element.textContent, /\/context|\/followup/);
  assert.equal(view.element.hasAttribute('aria-busy'), false);
  view.element.remove();
  assert.equal(answerContextRun({ result: { title: 'Context and sources', footer: '/context work-old · /followup' } }), 'work-old');
  assert.equal(answerContextRun({ result: { context_run_id: 'work-earlier' }, run_id: 'work-later' }), 'work-earlier');
  assert.equal(answerContextRun({ bundle: { RunID: 'work-bundle' } }), 'work-bundle');
});

test('answer context has honest empty, partial failure, retry and stale-view states', async () => {
  let attempts = 0;
  const view = answerContextView({ request: async () => { if (++attempts === 1) throw Error('Connection closed.'); return { references: [], context: { Items: [] } }; } });
  document.body.append(view.element); await view.load();
  assert.match(view.element.querySelector('[role=alert]').textContent, /Connection closed/);
  view.element.querySelector('button').click(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(attempts, 2);
  assert.match(view.element.textContent, /No saved context was recorded/);
  assert.match(view.element.textContent, /No source excerpts were retained/);
  const partial = answerContextView({ request: async () => ({ context_error: 'Historical context unavailable.', references: [{ label: 'note.md', locator: 'source/note.md', error: 'Retained bytes changed.' }] }) });
  await partial.load();
  assert.match(partial.element.textContent, /Historical context unavailable/);
  assert.match(partial.element.textContent, /Retained bytes changed/);
  const stale = answerContextView({ current: () => false, request: async () => ({ context: { Outcome: 'Do not render in another chat' } }) });
  await stale.load(); assert.doesNotMatch(stale.element.textContent, /Do not render/);
  view.element.remove();
});

test('the detailed Models view separates orchestrator choices from native and CLI assignments',async()=>{
  const state={provider:'openai',model:'manager',composer:{models:[{provider:'openai',model:'manager',label:'Manager'},{provider:'gemini',model:'worker',label:'Alternative'}],budget:{work_steps:24,code_steps:16},readiness:{processing:{description:'Configured provider'}}}};
  let chosen;
  const view=modelsView({state:()=>state,request:async()=>({inventory:{agents:[{name:'source_researcher',kind:'native',inherits:true,continuation:'Retained result',steering:true},{name:'codex',kind:'cli',model:'local-worker',auth:'Local Codex ChatGPT login',continuation:'Native session',steering:true,questions:true,allow_edits:false}]}}),choose:async value=>{chosen=value},local(){},providers(){}});
  document.body.append(view.element);await view.load();assert.equal(view.element.querySelector('.model-menu'),null);assert.match(view.element.textContent,/Allowed orchestrator models/);
  [...view.element.querySelectorAll('.orchestrator-model-row button')].find(button=>!button.disabled).click();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(chosen.model,'worker');
  view.element.querySelector('#models-tab-native').click();assert.match(view.element.textContent,/source researcher/);assert.match(view.element.textContent,/Uses the orchestrator model/);
  assert.equal(view.element.querySelector('details .brand-logo').getAttribute('src'),'/brands/openai.png');
  view.element.querySelector('#models-tab-cli').click();assert.match(view.element.textContent,/Local Codex ChatGPT login/);assert.match(view.element.textContent,/Native session/);
  assert.equal(view.element.querySelector('details .brand-logo').getAttribute('src'),'/brands/codex.png');
  const row=view.element.querySelector('details');row.open=true;state.model='another-manager';view.update();assert.equal(view.element.querySelector('details').open,true);
  assert.equal(view.element.querySelector('script'),null);view.element.remove();
});

test('orchestrator catalog opens exact cloud setup and local management without making implicit requests', async () => {
  const state = {provider:'openai',model:'manager',composer:{models:[
    {provider:'openai',model:'manager'}, {provider:'openai',model:'saved-alternative'},
    {provider:'hot-cross-buns-local',model:'qwen3:4b',processing:'local'},
  ]}};
  let setup, localRequests = 0;
  const view = modelsView({state:()=>state, request:async()=>({inventory:{agents:[],providers:[
    {id:'openai',ready:true,models:['manager','saved-alternative']},
    {id:'gemini',ready:false,models:['gemini-fixture']}, {id:'azure-openai',ready:false,models:[]},
  ]}}), choose:async model=>{state.provider=model.provider;state.model=model.model}, providers:(...args)=>{setup=args},
    localRequest:async()=>{localRequests++;return {local:{catalog:[{id:'qwen3-4b',name:'Qwen3 4B',tag:'qwen3:4b',eligible:true,downloaded:false}],issue:'Start the runtime to inspect models.'}}}, local(){}});
  document.body.append(view.element); await view.load();
  assert.equal(localRequests,0);
  assert.equal(view.element.querySelector('[data-provider="gemini"] img').getAttribute('src'),'/brands/gemini-color.png');
  assert.ok(!view.element.querySelector('[aria-label="Use qwen3:4b · Ollama"]'));
  const search=view.element.querySelector('input[type="search"]'); search.value='gemini';search.dispatchEvent(new window.Event('input'));
  assert.equal(view.element.querySelector('[data-provider="openai"]'),null);
  view.element.querySelector('[aria-label="Set up gemini-fixture · Google Gemini"]').click();assert.deepEqual(setup,['gemini','gemini-fixture']);
  search.value='azure';search.dispatchEvent(new window.Event('input'));
  [...view.element.querySelectorAll('button')].find(node=>node.textContent==='Add a model').click();assert.deepEqual(setup,['azure-openai']);
  search.value='saved-alternative';search.dispatchEvent(new window.Event('input'));
  view.element.querySelector('[aria-label="Use saved-alternative · OpenAI"]').click(); await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(state.model,'saved-alternative'); assert.ok(view.element.querySelector('[aria-label="Selected saved-alternative · OpenAI"]').disabled);
  [...view.element.querySelectorAll('button')].find(node=>node.textContent==='On this computer').click();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(localRequests,1); assert.match(view.element.textContent,/Qwen3 4B/);
  assert.equal(view.element.querySelector('.local-model-row img').getAttribute('src'),'/brands/ollama.png');
  assert.equal(view.element.querySelector('[aria-label="Use qwen3:4b · Ollama"] img'),null);
  assert.ok([...view.element.querySelectorAll('.local-model-row button')].find(node=>node.textContent==='Review selection').disabled);
  await view.load(); assert.equal(localRequests,2);
  view.element.remove();
});

test('local app links open on click in bounded split tabs and cannot embed the host or remote sites', () => {
  document.body.replaceChildren();
  for (const value of ['https://example.com','http://127.0.0.1:4317/','http://localhost:4317/','http://[::1]:3000/','http://localhost.evil.test:3000','http://user:password@localhost:3000','javascript:alert(1)','file:///tmp/app.html']) assert.equal(localAppURL(value),null);
  assert.equal(localAppURL('http://localhost:3000/path'),'http://localhost:3000/path');
  const pane=localBrowser();document.body.append(pane.element);
  const rendered=document.createElement('div');rendered.append(prose('App: http://localhost:3000/ and `http://127.0.0.1:4000/`.'));document.body.append(rendered);
  const onOpen=event=>pane.open(event.detail.url,event.detail.trigger);document.addEventListener('open-local-app',onOpen);
  assert.equal(pane.element.querySelector('iframe'),null);
  rendered.querySelector('a').click();assert.equal(pane.element.hidden,false);assert.equal(pane.element.querySelector('iframe').src,'http://localhost:3000/');
  const frame=pane.element.querySelector('iframe');assert.equal(frame.getAttribute('sandbox'),'allow-scripts allow-same-origin allow-forms allow-downloads');assert.ok(!frame.sandbox?.contains?.('allow-top-navigation'));
  rendered.querySelector('code a').click();assert.equal(pane.element.querySelectorAll('iframe').length,2);
  pane.open('http://localhost:3000/');assert.equal(pane.element.querySelectorAll('iframe').length,2);
  for(let port=5000;port<5004;port++)pane.open('http://localhost:'+port);assert.equal(pane.element.querySelectorAll('iframe').length,4);
  assert.equal(pane.open('https://example.com'),false);
  pane.element.querySelector('[aria-label="Close app preview"]').click();assert.equal(pane.element.querySelector('iframe'),null);assert.equal(document.body.classList.contains('local-browser-open'),false);
  document.removeEventListener('open-local-app',onOpen);
});

test('model picker searches configured models, filters providers and sends supported effort choices with captured state',async()=>{
  const choices=[],pane=modelPicker({select:async(action,state)=>choices.push({action,id:state.composer.id}),local(){},providers(){}});document.body.append(pane.element);
  // jsdom does not implement showing a popover; expose it for keyboard checks.
  pane.element.removeAttribute('popover');
  const state={context:'conversation:one',provider:'openai',model:'one',composer:{id:'current',effort:'standard',models:[{provider:'openai',model:'one',label:'First model'},{provider:'gemini',model:'two',label:'Second model'},{provider:'openai',model:'blocked',label:'Unavailable model',unavailable:'Set up this provider'}]}};
  pane.update(state,true);
  const search=pane.element.querySelector('input');search.value='Second';search.dispatchEvent(new window.Event('input'));assert.equal(pane.element.querySelectorAll('.model-menu-list button').length,1);
  pane.element.querySelector('.model-menu-list button').click();await new Promise(resolve=>setTimeout(resolve,0));assert.deepEqual(choices[0],{action:{action:'model',provider:'gemini',model:'two'},id:'current'});
  search.value='';search.dispatchEvent(new window.Event('input'));
  const providerFilter=pane.element.querySelector('[aria-label="Model providers"] button:last-child');providerFilter.focus();providerFilter.click();assert.equal(document.activeElement,pane.element.querySelector('[aria-label="Model providers"] [aria-pressed="true"]'));
  pane.element.querySelector('[aria-label="All models"]').click();
  const unavailable=[...pane.element.querySelectorAll('.model-menu-list button')].find(node=>node.textContent.includes('Unavailable'));assert.equal(unavailable.disabled,true);
  const high=[...pane.element.querySelectorAll('.model-menu-effort button')].find(node=>node.textContent.startsWith('High'));high.click();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(choices[1].action.effort,'high');
  pane.update({...state,composer:{...state.composer,disabled:'Work is running'}},true);assert.ok([...pane.element.querySelectorAll('.model-menu-choice')].every(node=>node.disabled));
  assert.match(pane.element.textContent,/Work is running/);pane.element.remove();
});

test('plan questions require each answer and support both choices and custom text without approving work',()=>{
  let submitted;const form=planQuestions([{id:'format',question:'Which format?',options:['JSON','YAML']},{id:'name',question:'What name?'}],text=>{submitted=text});document.body.append(form);
  form.dispatchEvent(new window.Event('submit',{cancelable:true}));assert.equal(submitted,undefined);
  const first=form.querySelector('input');first.checked=true;
  const custom=form.querySelectorAll('textarea')[1];custom.value='Bread parser';custom.dispatchEvent(new window.Event('input'));
  form.dispatchEvent(new window.Event('submit',{cancelable:true}));assert.match(submitted,/JSON/);assert.match(submitted,/Bread parser/);assert.match(submitted,/Do not start implementation/);
  const own=form.querySelector('textarea');own.value='TOML';own.dispatchEvent(new window.Event('input'));assert.equal(first.checked,false);
  form.dispatchEvent(new window.Event('submit',{cancelable:true}));assert.match(submitted,/TOML/);form.remove();
});

test('every model-selectable icon exists in the local Lucide catalog and menu decoration preserves labels', () => {
  assert.ok(activityIconNames.length > 0);
  for (const name of activityIconNames) assert.equal(icon(name).dataset.icon, name);
  assert.equal(icon('<svg onload=bad>').dataset.icon, 'circle-dashed');
  const menu = document.createElement('nav'); menu.innerHTML = '<button data-ui-icon="brain">Memory</button>';
  decorateIcons(menu); decorateIcons(menu);
  assert.equal(menu.querySelectorAll('svg').length, 1);
  assert.equal(menu.querySelector('button').textContent, 'Memory');
});

test("Markdown handles tables, emphasis, lists, and code while escaping raw HTML", () => {
  const result = prose("**Hello** and *welcome*.\n\n| Item | Count |\n| --- | --- |\n| Bread | 2 |\n\n- Read\n- Walk\n\n<script>window.compromised = true</script>");
  assert.equal(result.querySelector("strong").textContent, "Hello");
  assert.equal(result.querySelectorAll("td").length, 2);
  assert.equal(result.querySelectorAll("li").length, 2);
  assert.equal(result.querySelector("script"), null);
  assert.match(result.textContent, /<script>/);
});

test("HTML and SVG code render only inside isolated script-enabled frames and retain source", () => {
  for (const language of ["html", "svg"]) {
    const source = '<script>parent.document.body.remove()</script><img src="https://example.invalid/pixel"><form action="/api/action"></form>';
    const result = prose("```" + language + "\n" + source + "\n```");
    const frame = result.querySelector("iframe");
    assert.ok(frame);
    assert.equal(frame.getAttribute("sandbox"), "allow-scripts");
    assert.equal(frame.getAttribute("src"), "/artifact");
    assert.equal(result.querySelector("script"), null);
    assert.equal(result.querySelector("details code").textContent.trim(), source);
  }
});

test("streaming and incomplete fences stay as code", () => {
  const incomplete = prose("```html\n<h1>Still writing</h1>");
  assert.equal(incomplete.querySelector("iframe"), null);
  assert.match(incomplete.querySelector("code").textContent, /Still writing/);
  const shortFence = prose("````html\n<h1>Still writing</h1>\n```");
  assert.equal(shortFence.querySelector("iframe"), null);
  const streaming = prose("```svg\n<svg></svg>\n```", { previews: false });
  assert.equal(streaming.querySelector("iframe"), null);
  assert.ok(streaming.querySelector("code"));
});

test("unsafe links and image schemes cannot become active content", () => {
  const result = prose('[unsafe](javascript:alert%281%29)\n\n![unsafe](data:text/html;base64,PHNjcmlwdD4=)\n\n[credentials](https://user:secret@example.com)');
  assert.equal(result.querySelector("a[href]"), null);
  assert.equal(result.querySelector("img"), null);
  const image = prose("![Animation](/animation.gif)").querySelector("img");
  assert.equal(image.getAttribute("src"), "/animation.gif");
  assert.equal(image.referrerPolicy, "no-referrer");
});

test("diagram loading failure exposes a readable fallback and source", async () => {
  const result = prose("```mermaid\ninvalid diagram\n```");
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.match(result.textContent, /could not be rendered/);
  assert.equal(result.querySelector("details").open, true);
  assert.match(result.querySelector("code").textContent, /invalid diagram/);
});

test("highlighted code preserves its source and copies through the clipboard", async () => {
  const source = 'const greeting = "<script>example</script>";\n';
  const result = prose("```js\n" + source + "```");
  assert.ok(result.querySelector(".hljs-keyword"));
  assert.equal(result.querySelector("code").textContent, source);
  let copied;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    clipboard: { writeText: async value => { copied = value; } },
  } });
  const copy = result.querySelector(".copy-code");
  copy.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(copied, source);
  assert.equal(copy.textContent, "Copied");
  assert.equal(copy.querySelector('svg').dataset.icon, 'check');
  assert.equal(copy.querySelector('svg').getAttribute('aria-hidden'), 'true');
  assert.equal(result.querySelector("script"), null);
});

test("table columns resize by keyboard with bounded widths", () => {
  const result = prose("| A | B |\n| --- | --- |\n| one | two |");
  const handle = result.querySelector("[role=separator]");
  handle.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert.equal(handle.getAttribute("aria-valuenow"), "200");
  assert.equal(result.querySelector("col").style.width, "200px");
  for (let i = 0; i < 20; i++) handle.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowLeft" }));
  assert.equal(handle.getAttribute("aria-valuenow"), "80");
});

test("MathJax renders inline and display TeX without treating code or prices as math", async () => {
  const result = prose(String.raw`Inline $E=mc^2$ and \(x^2\).

$$
\frac{1}{3}
$$

A price of $5 and $10.

` + '`$literal$`');
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(result.querySelectorAll(".math-expression svg").length, 3, [...result.querySelectorAll(".math-expression")].map(node => node.outerHTML).join("\n"));
  assert.equal(result.querySelectorAll(".display-math").length, 1);
  assert.match(result.textContent, /\$5 and \$10/);
  assert.match(result.querySelector("code").textContent, /\$literal\$/);
});

test("command and chat shortcuts stay scoped, switch modes, and reject stale search results", async () => {
  document.body.innerHTML = '<textarea id="message"></textarea><div id="transcript"><article class="turn">Read in the sunshine</article></div>';
  dom.window.HTMLDialogElement.prototype.showModal = function() { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function() { this.open = false; this.dispatchEvent(new dom.window.Event("close")); };
  let opened = '', finishOld;
  const queries = [];
  installPalette(() => [{ label: "New chat", action: () => { opened = 'command'; } }, { label: "Models", action: () => {} }], async query => {
    queries.push(query);
    if (query === 'old') return new Promise(resolve => { finishOld = resolve; });
    if (query === 'broken') throw new Error('Chat catalog unavailable');
    return { items: [{ label: 'Project notes', group: 'Chat', action: () => { opened = 'chat'; } }] };
  });
  const input = document.getElementById("command-search"), dialog = document.querySelector('dialog');
  const key = (value, modifiers) => {
    const event = new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...modifiers });
    document.dispatchEvent(event); return event;
  };
  const query = value => { input.value = value; input.dispatchEvent(new dom.window.Event('input')); };
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  document.getElementById('message').focus();
  assert.equal(key('k', { ctrlKey: true }).defaultPrevented, true);
  assert.equal(dialog.getAttribute('aria-label'), 'Commands');
  assert.equal(document.activeElement, input);
  query('sunshine');
  assert.equal(document.querySelectorAll('[role=option]').length, 0);
  assert.equal(input.hasAttribute('aria-activedescendant'), false);
  assert.deepEqual(queries, []);
  query('new'); input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter' }));
  assert.equal(opened, 'command'); assert.equal(dialog.open, false);
  assert.equal(document.activeElement, document.getElementById('message'));
  for (const modifier of ['ctrlKey', 'metaKey']) {
    assert.equal(key('p', { [modifier]: true }).defaultPrevented, true); await tick();
    assert.equal(dialog.getAttribute('aria-label'), 'Past work');
    assert.equal(input.placeholder, 'Search past work…');
    assert.match(document.getElementById('command-results').textContent, /Project notes/);
    assert.doesNotMatch(document.getElementById('command-results').textContent, /Models|sunshine/);
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter' }));
    assert.equal(opened, 'chat'); assert.equal(dialog.open, false);
    key('k', { [modifier]: true });
    assert.equal(dialog.getAttribute('aria-label'), 'Commands');
    assert.doesNotMatch(document.getElementById('command-results').textContent, /Project notes/);
    key('k', { [modifier]: true }); assert.equal(dialog.open, false);
  }
  key('p', { ctrlKey: true }); await tick();
  query('old');
  assert.equal(document.querySelectorAll('[role=option]').length, 0);
  query('recent'); await tick();
  finishOld({ items: [{ label: 'Stale chat', action() {} }] }); await tick();
  assert.doesNotMatch(document.getElementById('command-results').textContent, /Stale chat/);
  query('broken'); await tick();
  assert.equal(document.querySelectorAll('[role=option]').length, 0);
  assert.match(dialog.textContent, /Chat catalog unavailable/);
  key('k', { metaKey: true });
  assert.equal(dialog.getAttribute('aria-label'), 'Commands');
  assert.match(document.getElementById('command-results').textContent, /Models/);
  key('p', { ctrlKey: true }); await tick();
  key('p', { ctrlKey: true }); assert.equal(dialog.open, false);
  assert.equal(key('p', { ctrlKey: true, altKey: true }).defaultPrevented, false);
  assert.equal(key('k', { metaKey: true, isComposing: true }).defaultPrevented, false);
});


test("clipboard denial selects the snippet and reports the manual shortcut", async () => {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    clipboard: { writeText: async () => { throw new Error("Denied"); } },
  } });
  const result = prose("```js\nconst value = 1;\n```");
  document.body.append(result);
  const copy = document.body.querySelector(".copy-code");
  copy.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(copy.textContent, /Selected/);
  assert.equal(window.getSelection().toString(), "const value = 1;\n");
});

test("public activity updates preserve nested disclosures and collapse on completion", () => {
  const view = activityView("test", { remember: false });
  const start = "2026-11-22T01:00:00Z";
  const entry = { id: "file", kind: "tool", tool: "read_file", state: "running" };
  view.update({ state: "running", started_at: start, entries: [entry] });
  assert.equal(view.element.open, true);
  assert.match(view.element.querySelector(".activity-label").textContent, /Reading a file/);
  const row = view.element.querySelector(".activity-entry");
  row.open = true;
  view.update({ state: "running", started_at: start, entries: [{ ...entry, state: "completed", details: [{ kind: "read_file", path: "source/note.md" }] }] });
  assert.equal(view.element.querySelector(".activity-entry"), row);
  assert.equal(row.open, true);
  assert.match(row.textContent, /source\/note.md/);
  view.update({ state: "completed", started_at: start, finished_at: "2026-11-22T01:01:59Z", entries: [{ ...entry, state: "completed" }] });
  assert.equal(view.element.open, false);
  assert.equal(view.element.querySelector(".activity-label").textContent, "Worked for 1m 59s");
  assert.equal(view.element.querySelector(".activity-indicator").dataset.active, "false");
  view.element.open = true;
  view.update({ state: "completed", started_at: start, finished_at: "2026-11-22T01:01:59Z", entries: [] });
  assert.equal(view.element.open, true);
});

test("activity accurately distinguishes approval, disconnection, failure, and missing timing", () => {
  const view = activityView("states", { remember: false });
  const trace = { state: "running", entries: [{ id: "waiting", kind: "tool", tool: "web_fetch", state: "waiting" }] };
  view.update(trace);
  assert.match(view.element.querySelector(".activity-label").textContent, /Waiting for approval/);
  assert.equal(view.element.querySelector(".activity-indicator").dataset.active, "false");
  view.update(trace, { active: true, disconnected: true });
  assert.equal(view.element.querySelector(".activity-label").textContent, "Connection lost");
  view.update({ state: "failed", entries: [] });
  assert.equal(view.element.querySelector(".activity-label").textContent, "Work failed");
  assert.equal(elapsed("invalid", "2026-11-22T01:00:00Z"), "");
  assert.equal(elapsed("2026-11-22T02:00:00Z", "2026-11-22T01:00:00Z"), "");
});

test("attachment cards preview safely and keep preview and remove actions separate", async () => {
  let opened = 0, removed = 0;
  const file = { id: 'opaque/note.txt', name: '<script>note</script>.txt', size: 1200 };
  const card = attachmentCard(file, {
    load: async () => ({ kind: 'text', text: '<img onerror="bad()">' }),
    open: () => opened++, remove: () => removed++,
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(card.querySelector('script'), null);
  assert.match(card.querySelector('.attachment-thumbnail').textContent, /<img/);
  card.querySelector('.attachment-open').click();
  assert.equal(opened, 1);
  assert.equal(removed, 0);
  card.querySelector('.attachment-remove').click();
  assert.equal(removed, 1);
  const unsafe = previewContent({ kind: 'image', data: 'https://example.invalid/tracker' });
  assert.equal(unsafe.querySelector('img'), null);
});

test("clipboard files become attachments and long text keeps its original bytes", () => {
  globalThis.File = dom.window.File;
  const image = new File(['image'], 'pasted.png', { type: 'image/png' });
  const mixed = pastedFiles({ files: [image], getData: () => 'A caption' });
  assert.equal(mixed.files[0], image);
  assert.equal(mixed.text, 'A caption');
  const short = pastedFiles({ files: [], getData: () => 'Keep this in the composer' });
  assert.equal(short.files.length, 0);
  assert.equal(short.text, 'Keep this in the composer');
  const long = pastedFiles({ files: [], getData: () => '🍞'.repeat(3000) });
  assert.equal(long.files[0].name, 'Pasted text.txt');
  assert.equal(long.files[0].size, new TextEncoder().encode('🍞'.repeat(3000)).length);
  assert.equal(long.text, '');
});

test('task inspector stays tucked away, preserves disclosure state, and checks only observed completed steps', () => {
  const inspector = taskInspector({ openChat: async () => {} });
  document.body.replaceChildren(inspector.trigger, inspector.element);
  inspector.update([]);
  assert.equal(inspector.trigger.hidden, true);
  assert.equal(inspector.element.getAttribute('popover'), 'auto');
  const task = { id: 'current', title: '<script>Your notes</script>', current: true, active: true, state: 'running', steps: [
    { id: 'read', tool: 'read_file', state: 'completed' }, { id: 'search', tool: 'web_search', state: 'running' },
  ], plans: [{ id: 'plan', steps: ['Read notes', 'Prepare a summary'] }] };
  inspector.update([task]);
  assert.match(inspector.trigger.textContent, /In progress · 1/);
  assert.equal(inspector.element.querySelector('script'), null);
  assert.equal(inspector.element.querySelectorAll('.task-steps [data-state="completed"]').length, 1);
  assert.equal(inspector.element.querySelectorAll('.task-proposal .task-check').length, 0);
  const row = inspector.element.querySelector('.task-item'); row.open = false;
  inspector.update([{ ...task, state: 'completed', active: false }]);
  assert.equal(inspector.element.querySelector('.task-item'), row);
  assert.equal(row.open, false);
  assert.equal(inspector.element.querySelectorAll('.task-steps [data-state="completed"]').length, 1);
  assert.equal(inspector.element.querySelectorAll('.task-steps [data-state="stopped"]').length, 1);
  inspector.update([task], { connected: false });
  assert.match(inspector.element.textContent, /Live updates paused/);
  assert.equal(inspector.element.querySelectorAll('.task-steps [data-state="running"]').length, 0);
});

test('composer progress shows observed steps, folds on completion, and preserves later manual expansion', () => {
  const progress = composerProgress(); document.body.replaceChildren(progress.element);
  progress.update(); assert.equal(progress.element.hidden, true);
  const task = { id: 'task', started_at: '2026-11-22T00:00:00Z', state: 'running', active: true, steps: [
    { id: 'read', text: 'Read your notes', state: 'completed' }, { id: 'write', text: 'Write a summary', icon: 'notebook-pen', state: 'running' },
  ], plans: [{ phase: 'review', steps: ['A proposed future step'] }] };
  progress.update(task);
  assert.equal(progress.element.open, true);
  assert.match(progress.element.querySelector('summary').textContent, /Write a summary/);
  assert.equal(progress.element.querySelectorAll('li[data-state="completed"]').length, 1);
  assert.equal(progress.element.querySelectorAll('li[data-state="planned"]').length, 1);
  assert.equal(progress.element.querySelector('summary .task-check svg').dataset.icon, 'notebook-pen');
  assert.equal(progress.element.querySelector('li[data-state="running"] svg').dataset.icon, 'notebook-pen');
  assert.equal(progress.element.querySelector('li[data-state="completed"] svg').dataset.icon, 'check');
  assert.equal(progress.element.querySelector('li[data-state="planned"] svg').dataset.icon, 'circle-dashed');
  progress.update({ ...task, steps: [{ ...task.steps[1], tool: 'web_search', icon: '<svg onload=bad>' }] });
  assert.equal(progress.element.querySelector('summary .task-check svg').dataset.icon, 'search');
  progress.update(task);
  const finished = { ...task, state: 'completed', active: false };
  progress.update(finished); assert.equal(progress.element.open, false);
  assert.equal(progress.element.querySelectorAll('li[data-state="completed"]').length, 1);
  progress.element.open = true; progress.update(finished); assert.equal(progress.element.open, true);
  progress.update(task, { connected: false });
  assert.equal(progress.element.querySelectorAll('li[data-state="running"]').length, 0);
});

test('scheduled task actions use the displayed digest and expose stale errors without changing the task', async () => {
  const calls = [], task = { id: 'job-sample', digest: 'original', title: 'Morning notes', enabled: true, schedule: '0 9 * * *', timezone: 'UTC' };
  const pane = scheduledPane({ request: async action => {
    calls.push(action);
    if (action.action === 'pause') throw new Error('Schedule changed. Refresh and review it.');
    return { entries: [task], running: true };
  } });
  pane.update({ entries: [task], running: true }); document.body.replaceChildren(pane.element);
  [...pane.element.querySelectorAll('button')].find(button => button.textContent === 'Pause').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(calls[0], { action: 'pause', id: task.id, digest: 'original' });
  assert.match(pane.element.querySelector('[role="alert"]').textContent, /Schedule changed/);
  assert.equal(task.enabled, true);
  pane.element.querySelector('.task-item').open = true;
  pane.update({ entries: [task, { ...task, id: 'another', title: 'Evening notes' }], running: true });
  assert.equal(pane.element.querySelector('[data-task-id="job-sample"]').open, true);
  assert.equal(pane.element.querySelector('[data-task-id="another"]').open, false);
});

test('live chat activity can remain collapsed while its status updates', () => {
  const activity = activityView('quiet', { remember: false, autoExpand: false });
  activity.update({ state: 'running', entries: [] });
  assert.equal(activity.element.open, false);
  activity.element.open = true;
  activity.update({ state: 'running', entries: [{ id: 'read', kind: 'tool', tool: 'read_file', state: 'running' }] });
  assert.equal(activity.element.open, true);
});

test('Memory editing, forgetting, filtering, and reset use the real pane', async () => {
  const samples = createMemorySamples();
  const pane = memoryPane({ request: samples.request, manage: () => {}, description: 'Fictional preview data.' });
  document.body.replaceChildren(pane.element);
  await pane.load();
  const findButton = (root, text) => [...root.querySelectorAll('button')].find(node => node.textContent === text);
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(pane.element.querySelectorAll('.memory-section').length, 1);
  assert.equal(pane.element.querySelectorAll('.memory-topics button').length, 8);
  let topic = pane.element.querySelector('.memory-topic');
  findButton(topic, 'Edit').click();
  topic.querySelector('textarea').value = 'An edited preview preference.';
  findButton(topic, 'Save').click(); await settle();
  assert.match(pane.element.textContent, /An edited preview preference/);
  topic = pane.element.querySelector('.memory-topic');
  findButton(topic, 'Forget').click();
  findButton(topic, 'Cancel').click();
  assert.equal((await samples.request()).total, 15);
  findButton(topic, 'Forget').click();
  findButton(topic, 'Forget memory').click(); await settle();
  assert.doesNotMatch(pane.element.textContent, /An edited preview preference/);
  assert.equal((await samples.request()).total, 14);
  [...pane.element.querySelectorAll('.memory-topics button')].find(node => node.textContent.startsWith('Project context')).click(); await settle();
  const search = pane.element.querySelector('input'); search.value = 'local-first';
  pane.element.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await settle();
  assert.match(pane.element.querySelector('.memory-content h3').textContent, /Project context/);
  samples.reset(); search.value = ''; await pane.load();
  assert.equal(pane.element.querySelectorAll('.memory-topic').length, 2);
  findButton(pane.element, 'Add memory').click();
  pane.element.querySelector('.memory-create select').value = 'fact';
  pane.element.querySelector('.memory-create textarea').value = 'I enjoy quiet libraries.';
  pane.element.querySelector('.memory-create').dispatchEvent(new window.Event('submit', { cancelable: true })); await settle();
  assert.equal((await samples.request()).total, 16);
  assert.match(pane.element.querySelector('.memory-content').textContent, /I enjoy quiet libraries/);
  const added = pane.element.querySelector('.memory-topic'); added.open = true;
  findButton(added, 'Edit').click();
  added.querySelector('textarea').value = 'I enjoy quiet places to read.';
  findButton(added, 'Save').click(); await settle();
  assert.equal(pane.element.querySelector('.memory-topic-title').textContent, 'I enjoy quiet places to read.');
});

test("Memory groups topics and keeps an unsuccessful correction available for editing", async () => {
  const catalog = { total: 1, matched: 1, page: 0, pages: 1, categories: { Preferences: 1 }, entries: [
    { id: 'mem-fixture', kind: 'memory', title: 'Response style', category: 'Preferences', text: '<script>Concise answers</script>', scope: 'Across chats', source: 'user', status: 'Active', revision: 'original', editable: true, updated_at: '2026-11-22T00:00:00Z' },
  ] };
  const requests = [];
  const pane = memoryPane({ manage: () => {}, request: async action => {
    requests.push(action);
    if (action.action === 'correct') throw new Error('This memory changed. Reopen it.');
    return catalog;
  } });
  document.body.replaceChildren(pane.element);
  await pane.load();
  assert.match(pane.element.querySelector('.memory-content h3').textContent, /Preferences/);
  assert.equal(pane.element.querySelector('script'), null);
  const buttons = () => [...pane.element.querySelectorAll('button')];
  buttons().find(node => node.textContent === 'Edit').click();
  const editor = pane.element.querySelector('textarea');
  editor.value = 'Keep my correction';
  buttons().find(node => node.textContent === 'Save').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(editor.value, 'Keep my correction');
  assert.equal(editor.disabled, false);
  assert.match(pane.element.querySelector('[role=alert]').textContent, /changed/);
  assert.equal(requests.at(-1).revision, 'original');
});

test('work history excludes the HCB home in both browsing and search', async () => {
  const menu=chatMenu({request:async()=>({items:[{id:'main',title:'Main notes',selection:'main-selection'},{id:'side',title:'A side chat',selection:'side-selection'}]}),open(){}});
  document.body.replaceChildren(menu.element);
  menu.updateCurrent('side','main');await menu.load('owner');
  assert.deepEqual([...menu.element.querySelectorAll('.chat-item')].map(node=>node.dataset.chat),['side']);
  assert.equal(menu.element.querySelector('[aria-current="page"]').textContent,'A side chat');
  const search=menu.element.querySelector('input');search.value='notes';search.dispatchEvent(new window.Event('input'));
  await new Promise(resolve=>setTimeout(resolve,200));
  assert.equal(menu.element.querySelector('[data-chat="main"]'), null);
});

test('the chat menu pages inside its own scroll area and opens only returned selections', async () => {
  const requests = [], opened = [];
  const menu = chatMenu({ request: async request => {
    requests.push(request);
    return request.after ? { items: [{ id: 'older', title: '<script>Older chat</script>', selection: 'older-selection' }], next: '' }
      : { items: [{ id: 'newer', title: 'Newer chat', selection: 'newer-selection' }], next: 'cursor' };
  }, open: async selection => opened.push(selection) });
  document.body.replaceChildren(menu.element);
  await menu.load('chat-context');
  const nav = menu.element.querySelector('nav');
  Object.defineProperties(nav, { scrollHeight: { value: 600 }, clientHeight: { value: 200 } });
  nav.scrollTop = 390; nav.dispatchEvent(new window.Event('scroll'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(requests.map(request => request.after), ['', 'cursor']);
  assert.equal(nav.querySelectorAll('.chat-row').length, 2);
  assert.equal(menu.element.dataset.top, 'true');
  assert.equal(menu.element.querySelector('script'), null);
  nav.querySelector('.chat-row').click(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(opened, [{ context: 'chat-context', selection: 'newer-selection' }]);
});

test('settings routes to real management pages', () => {
  const destinations = [];
  const settings = settingsView({ state: { model: 'Configured model' }, navigate: route => destinations.push(route), backend: route => destinations.push(route) });
  assert.match(settings.textContent, /Configured model/);
  [...settings.querySelectorAll('button')].find(node => node.textContent.startsWith('Memory & privacy')).click();
  [...settings.querySelectorAll('button')].find(node => node.textContent.startsWith('Web search')).click();
  [...settings.querySelectorAll('button')].find(node => node.textContent.startsWith('Skills and routines')).click();
  assert.deepEqual(destinations, ['/memory', '/search', '/routines']);

});

test('local model selection binds the displayed review and never repeats an unconfirmed mutation', async () => {
  const calls = [], review = { id: 'review', generation: 'generation', model_id: 'local', tag: 'local:latest', digest: 'a'.repeat(64), endpoint: 'http://127.0.0.1:11434', notice: 'Future requests only.' };
  const local = { reachable: true, installed_known: true, installed: [{}], catalog: [{ id: 'local', name: 'Local model', tag: 'local:latest', digest: 'a'.repeat(64), downloaded: true, eligible: true }] };
  const pane = localModelsView({ request: async action => {
    calls.push(action);
    if (action.action === 'local_review_select') return { local_review: review };
    if (action.action === 'local_select') throw new Error('Publication could not be confirmed. Refresh and reconcile.');
    return { local, runtime: { state: "running", available: true } };
  } });
  document.body.replaceChildren(pane.element); await pane.load();
  const find = text => [...pane.element.querySelectorAll('button')].find(node => node.textContent === text);
  find('Review selection').click(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(pane.element.querySelector('.local-selection-review').textContent, /Future requests only/);
  find('Confirm future selection').click(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(calls.at(-1), { action: 'local_select', model_id: 'local', review_id: 'review', generation: 'generation', app_owned: true });
  assert.equal(find('Confirm future selection'), undefined);
  assert.match(pane.element.querySelector('[role="alert"]').textContent, /could not be confirmed/);
  assert.equal(calls.filter(call => call.action === 'local_select').length, 1);
});

test('management forms expose source checkboxes, labeled budgets, mappings, and RFC3339 dates', () => {
  const sources = panelField({ kind: 'multi', value: 'null', max: 4, options: [{ value: 'notes', label: 'Notes' }] }, 'Connected sources');
  assert.equal(sources.element.querySelector('input').type, 'checkbox');
  sources.element.querySelector('input').checked = true;
  assert.deepEqual(JSON.parse(sources.value), ['notes']);
  const budget = panelField({ kind: 'budget', value: '2,1000,60', parts: [{ label: 'Requests', min: 1, max: 10 }, { label: 'Tokens', min: 10, max: 10000 }, { label: 'Seconds', min: 1, max: 300 }] }, 'Limits');
  assert.equal(budget.element.querySelectorAll('input[type="number"]').length, 3);
  budget.element.querySelector('input').value = '3';
  assert.equal(budget.value, '3,1000,60');
  const date = panelField({ kind: 'datetime', value: '2026-11-22T09:15:00+08:00' }, 'End date');
  assert.equal(Date.parse(date.value), Date.parse('2026-11-22T01:15:00Z'));
  date.element.querySelector('input').value = ''; assert.equal(date.value, '');
  const mapping = panelField({ kind: 'mappings', value: '[{"from":"/old","to":"/new"}]' }, 'Folders');
  assert.deepEqual(JSON.parse(mapping.value), [{ from: '/old', to: '/new' }]);
  const password = panelField({ secret: true, value: 'must not appear' }, 'Credential');
  assert.equal(password.value, '');
});

test('chat search retires prior results and renames the exact returned selection without opening it', async () => {
  const requests = [], renamed = [];
  const menu = chatMenu({ request: async value => {
    requests.push(value); return { items: [{ id: 'a', title: value.query ? 'Matching chat' : 'Original chat', snippet: '<b>literal</b>', selection: value.query ? 'searched' : 'original' }] };
  }, open: () => assert.fail('rename must not navigate'), rename: async value => renamed.push(value) });
  document.body.replaceChildren(menu.element); await menu.load('owner');
  const search = menu.element.querySelector('input[type="search"]'); search.value = 'notes'; search.dispatchEvent(new window.Event('input'));
  assert.equal(menu.element.querySelector('.chat-row'), null);
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(requests.at(-1).query, 'notes'); assert.equal(menu.element.querySelector('b'), null);
  menu.element.querySelector('.rename-chat').click();
  const editor = menu.element.querySelector('form'), title = editor.querySelector('input'); title.value = 'My notes'; editor.dispatchEvent(new window.Event('submit', { cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(renamed, [{ context: 'owner', selection: 'searched', title: 'My notes' }]);
});

test('Find uses the command palette, scopes matches to the current chat, and jumps to selected text', () => {
  document.body.innerHTML = '<textarea id="message"></textarea><div id="transcript"><article class="turn" data-message-id="one"><p>Hello <strong>quiet</strong> world. Quiet again.</p><details><summary>Source</summary><pre>quiet hidden</pre></details><button>quiet action</button></article></div><aside>quiet other chat</aside>';
  const node = document.querySelector('.turn'); node.scrollIntoView = () => {};
  let revealed = 0;
  const find = transcriptFind({ transcript: document.querySelector('#transcript'), revealed: () => revealed++ });
  installPalette(() => [], async () => ({items: []}), find);
  const dialog = document.querySelector('dialog'), input = dialog.querySelector('input'); find.refresh('one');
  for (const modifier of ['ctrlKey', 'metaKey']) {
    document.getElementById('message').focus();
    const event = new window.KeyboardEvent('keydown', { key: 'f', [modifier]: true, cancelable: true });
    window.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true); assert.equal(dialog.open, true);
    assert.equal(dialog.className, 'command-palette');
    assert.equal(dialog.getAttribute('aria-label'), 'Find in this chat');
    assert.equal(document.activeElement, input);
    assert.equal(dialog.querySelector('.palette-empty').hidden, true);
    assert.equal(dialog.querySelector('[role="listbox"]').hidden, true);
    assert.equal(dialog.querySelector('.palette-footer').textContent, '↑ ↓ to move · Enter to open · Esc to close');
    assert.doesNotMatch(dialog.textContent, /Type to search this chat|Current chat’s loaded text only/);
    input.value = 'quiet'; input.dispatchEvent(new window.Event('input'));
    assert.equal(dialog.querySelectorAll('[role="option"]').length, 2);
    assert.equal(document.querySelectorAll('mark').length, 2);
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown' }));
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
    assert.equal(dialog.open, false); assert.equal(document.activeElement.id, 'message');
    assert.equal(revealed > 0, true);
    find.open();
    input.value = 'quiet world'; input.dispatchEvent(new window.Event('input'));
    assert.equal(dialog.querySelectorAll('[role="option"]').length, 1);
    assert.equal(document.querySelector('strong').textContent, 'quiet');
    input.value = 'missing'; input.dispatchEvent(new window.Event('input'));
    assert.equal(dialog.querySelectorAll('[role="option"]').length, 0);
    assert.match(dialog.textContent, /No matches in this chat/);
    dialog.close(); assert.equal(document.querySelector('mark'), null);
  }
  find.open(); input.value = 'quiet'; input.dispatchEvent(new window.Event('input'));
  find.refresh('two'); assert.equal(dialog.open, false); assert.equal(document.querySelector('mark'), null);
});

test('reactions require exact durable answered-turn metadata and preferences preserve text fallbacks', () => {
  const turn = { id: 'turn', state: 'answered', revision: 2, response: "You're welcome.", reaction: { version: 1, conversation_id: 'chat', turn_id: 'turn', revision: 2, kind: 'appreciation', emoji: '❤️', level: 'subtle' } };
  const reaction = reactionFor(turn, 'chat'); assert.equal(reaction.emoji, '❤️'); assert.match(reactionChip(reaction).getAttribute('aria-label'), /conversational only/);
  for (const changed of [{ issue: 'failed' }, { task_chat: 'work' }, { revision: 3 }, { input_ids: ['file'] }, { reply_to_update_id: 'update' }, { response: 'Different response' }]) assert.equal(reactionFor({ ...turn, ...changed }, 'chat'), null);
  assert.equal(reactionFor(turn, 'wrong'), null); assert.equal(reactionFor(turn, 'chat', 'off'), null);
  const greeting = { ...turn, response: 'Hello!', reaction: { ...turn.reaction, kind: 'greeting', emoji: '👋', level: 'expressive' } };
  assert.equal(reactionFor(greeting, 'chat'), null); assert.ok(reactionFor(greeting, 'chat', 'expressive'));
  reactionPreference('off'); assert.equal(reactionPreference(), 'off'); reactionPreference('subtle');
});

test('task details require explicit receipt confirmation and retain uncertainty after a missing acknowledgement', async () => {
  const requests = [];
  const pane = taskDetailView({ id: 'chat', request: async value => {
    requests.push(value);
    if (value.op === 'task-control') throw new Error('Receipt check not confirmed');
    return { id: 'chat', current: true, connected: true, title: 'Your request', state: 'Interrupted', identity: [], records: [], receipts: [{ title: 'gmail_send', state: 'Outcome uncertain', uncertain: true, selection: 'exact', fields: [] }] };
  } });
  document.body.replaceChildren(pane.element); await pane.load();
  const byText = text => [...pane.element.querySelectorAll('button')].find(node => node.textContent === text);
  byText('Check Sent · read-only').click(); assert.equal(requests.length, 1); assert.match(pane.element.textContent, /never sends or resends/);
  byText('Check Sent').click(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(requests.at(-1), { op: 'task-control', selection: 'exact', action: 'check_sent' });
  assert.match(pane.element.textContent, /No action was replayed/); assert.equal(byText('Check Sent'), undefined);
});

test('reading positions survive updates, chat switches, and reloads without pulling a reader to the end', () => {
  const saved = new Map(), storage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
  const frames = new Map(); let frameID = 0, scroll = 0;
  globalThis.requestAnimationFrame = callback => { frames.set(++frameID, callback); return frameID; };
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  const flushFrames = () => { for (let pass = 0; pass < 5 && frames.size; pass++) { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(); } };
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scroll });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 3200 });
  let scrollBehavior; const oldScroll = window.scrollTo; window.scrollTo = value => { scrollBehavior = value.behavior; scroll = Math.max(0, Math.min(2400, value.top)); };
  document.body.innerHTML = '<div id="transcript"><article data-message-id="first"></article><article data-message-id="middle"></article><article data-message-id="last"></article></div>';
  const transcript = document.querySelector('#transcript');
  for (const [index, node] of [...transcript.children].entries()) node.getBoundingClientRect = () => ({ top: index * 600 + 100 - scroll, bottom: index * 600 + 500 - scroll });
  let reading = readingPosition({ transcript, storage }); reading.before('chat-a'); reading.after(); flushFrames(); assert.equal(scroll, 2400);
  scroll = 700; window.dispatchEvent(new window.Event('scroll')); assert.equal(reading.element.hidden, false);
  reading.before('chat-a'); reading.after(); flushFrames(); assert.equal(scroll, 700);
  reading.before('chat-b'); reading.after(); flushFrames(); assert.equal(scroll, 2400);
  reading.before('chat-a'); reading.after(); flushFrames(); assert.equal(scroll, 700);
  reading.dispose(); scroll = 0;
  reading = readingPosition({ transcript, storage }); reading.before('chat-a'); reading.after(); flushFrames(); assert.equal(scroll, 700);
  reading.element.click(); assert.equal(scroll, 2400); assert.equal(reading.element.hidden, true); assert.equal(scrollBehavior, 'smooth');
  reading.after(); flushFrames(); assert.equal(scrollBehavior, 'smooth');
  window.dispatchEvent(new window.Event('scrollend'));
  const oldMotion = window.matchMedia; window.matchMedia = () => ({ matches: true }); reading.latest(); assert.equal(scrollBehavior, 'instant'); window.matchMedia = oldMotion;
  scroll = 700; let attempts = 0; window.scrollTo = () => { attempts++; }; reading.latest(); window.dispatchEvent(new window.Event('scrollend')); assert.equal(attempts, 1); assert.equal(reading.element.hidden, false);
  reading.dispose(); window.scrollTo = oldScroll; delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame;
});

test('recovery access stays disabled until an exact review and preparation requires a separate confirmation', async () => {
  const requests = [], account = { id: 'account-a', label: 'Personal inbox', destination: 'Gmail', operation: 'gmail_read', permission: 'Read mail' };
  const pane = taskDetailView({ id: 'chat', request: async value => {
    requests.push(value);
    if (value.op === 'task-inspect') return { id: 'chat', current: true, connected: true, title: 'Original task', state: 'Failed', records: [{ title: 'Review my notes', detail: 'Access needs review.', retrySafe: true, selection: 'original', needs: [{ operation: 'gmail_read' }], fields: [] }], receipts: [] };
    if (value.action === 'review_access') return { access: { ready: true, connections: ['account-a'], requirements: [{ selected: 'account-a', need: { operation: 'gmail_read' }, choices: [account] }] } };
    return { accepted: true };
  } });
  document.body.replaceChildren(pane.element); await pane.load();
  const byText = text => [...pane.element.querySelectorAll('button')].find(node => node.textContent === text);
  assert.equal(byText('Prepare recovery plan').disabled, true);
  byText('Review configured account access').click(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(byText('Prepare recovery plan').disabled, false);
  byText('Prepare recovery plan').click(); assert.equal(requests.length, 2); assert.match(pane.element.textContent, /may consume model usage/);
  byText('Confirm preparation').click(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(requests.at(-1), { op: 'task-control', selection: 'original', action: 'prepare_access', connections: ['account-a'] });
  assert.match(pane.element.textContent, /Nothing has been approved or repeated/);
});

test('workspace browsing is explicit and activity badges update without replacing focused chat rows', async () => {
  const requests = [], selected = [];
  const workspace = workspaceView({ source: '/notes', request: async value => { requests.push(value); return { source: value.path, parent: '/', folders: [{ name: 'Reading', path: '/notes/reading' }], changed: true }; }, selected: value => selected.push(value) });
  document.body.replaceChildren(workspace.element); await workspace.load(); assert.equal(requests[0].op, 'workspace-browse');
  [...workspace.element.querySelectorAll('button')].find(node => node.textContent === 'Use this folder').click(); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(requests.at(-1).op, 'workspace-select'); assert.equal(selected.length, 1);
  const menu = chatMenu({ request: async () => ({ items: [{ id: 'one', title: 'Notes', selection: 'one' }, { id: 'two', title: 'Dinner', selection: 'two' }] }), open() {} });
  document.body.replaceChildren(menu.element); await menu.load('current'); menu.updateCurrent('one');
  const row = menu.element.querySelector('.chat-row'); row.focus();
  menu.updateActivity([{ id: 'two', status: 'Needs review' }], [{ id: 'one', state: 'running' }]);
  assert.equal(document.activeElement, row); assert.equal(menu.element.querySelector('.chat-activity-summary').textContent, '1 needs you');
  assert.match(menu.element.querySelectorAll('.chat-row')[1].getAttribute('aria-label'), /Needs review/);
  menu.updateActivity(); assert.equal(menu.element.querySelector('.chat-state'), null);
});

test('streaming reveal keeps graphemes intact, bounds backlog, and copies the complete received source', async () => {
  const cursor = new StreamingReveal(); cursor.receive('Hello', 'one'); cursor.receive('Hello 👩‍💻 quiet world', 'one');
  assert.equal(cursor.text, 'Hello'); assert.ok(cursor.pending); cursor.tick(); assert.ok(!cursor.text.endsWith('\u200d'));
  while (cursor.pending) cursor.tick(); assert.equal(cursor.text, 'Hello 👩‍💻 quiet world');
  cursor.receive('A'.repeat(4000), 'one'); assert.equal(cursor.pending, 0);
  cursor.receive('Replacement', 'two'); assert.equal(cursor.text, 'Replacement');
  cursor.receive('Replacement now', 'two', false); assert.equal(cursor.text, 'Replacement now');
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  let copied; Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async text => { copied = text; } } } });
  const stream = streamingResponse(); document.body.replaceChildren(stream.element);
  stream.update('A quiet thought', 'run'); stream.update('A quiet thought about tomorrow.', 'run');
  stream.element.querySelector('button').click(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(copied, 'A quiet thought about tomorrow.');
  stream.update('## Structured\n\n```js\nconst x = 1\n```', 'run'); assert.ok(stream.element.querySelector('code')); stream.dispose();
  const complete = turn('**Original** markdown', false, 'Hot Cross Buns'); complete.querySelector('.response-tools button').click(); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(copied, '**Original** markdown');
});

test('plan reviews show effects, sources, changed inputs, budgets, and prior attempts before technical data', () => {
  const view = planReview({ task: 'Review the notes', revision: 3, phase: 'review', state: 'queued',
    content: { outcome: 'A short summary', steps: [{ id: 'one', text: 'Read the note' }], effects: ['Read only; no writes'], sources: ['note.md'] },
    sources: ['Personal notes'], input_names: ['note.md'], input_additions: ['new.md'], input_removals: ['old.md'],
    budget: { max_steps: 8, code_max_steps: 2 }, original_budget: { max_steps: 12, code_max_steps: 4 }, attempts: [{ uncertain: true, measured_steps: 4 }] });
  const visible = [...view.children].filter(node => node.tagName !== 'DETAILS').map(node => node.textContent).join('\n');
  assert.match(visible, /Declared effectsRead only; no writes/); assert.match(visible, /Inputs addednew.md/); assert.match(visible, /Inputs removedold.md/);
  assert.match(visible, /Remaining execution budgetWork steps: 8/); assert.match(visible, /Original budgetWork steps: 12/); assert.match(visible, /Prior attempt 1 · effects uncertain/);
  assert.equal(view.querySelector('details').open, false); assert.match(view.querySelector('details pre').textContent, /"revision": 3/);
});

test('correction messages keep the user instruction readable without exposing routing identifiers', () => {
  const raw = 'Regarding the pending action in conversation work-fixture:\nUse a calmer subject.\nThis is a correction request for review, not approval or permission to start or send anything.';
  assert.deepEqual(correctionText(raw), { label: 'Requested an action correction', text: 'Use a calmer subject.' });
  assert.equal(correctionText('Regarding an unrelated note'), null);
});

test('whole-response copy keeps exact Markdown available when clipboard permission is denied', async () => {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async () => { throw new Error('denied'); } } } });
  const raw = '**A quiet note**\n\n```html\n<button>Continue</button>\n```';
  const response = turn(raw, false, 'Hot Cross Buns'); document.body.replaceChildren(response);
  response.querySelector('.response-tools button').click(); await new Promise(resolve => setTimeout(resolve, 0));
  const fallback = response.querySelector('.response-tools textarea'); assert.equal(fallback.value, raw); assert.equal(fallback.readOnly, true); assert.equal(document.activeElement, fallback); assert.match(response.querySelector('.response-tools [role="status"]').textContent, /Ctrl\+C/);
});

test('local runtime controls review exact operations and never replay a lost confirmation', async () => {
  const calls = [], runtime = { state: 'stopped', available: true, generation: 'g', binary: '/installed/ollama' };
  const review = { id: 'review', generation: 'g', action: 'runtime_start', binary: '/installed/ollama', storage: '/private/models', notice: 'Separate model storage. No inference.' };
  const pane = localModelsView({ request: async action => {
    calls.push(action);
    if (action.action === 'runtime_review_start') return { runtime, runtime_review: review };
    if (action.action === 'runtime_start') throw new Error('Confirmation unavailable. Refresh before retrying.');
    return { local: { catalog: [] }, runtime };
  } });
  document.body.replaceChildren(pane.element); await pane.load();
  const find = label => [...pane.element.querySelectorAll('button')].find(button => button.textContent === label);
  assert.equal(find('Start').querySelector('svg').dataset.icon, 'power');
  find('Start').click(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(pane.element.querySelector('.local-runtime-review').textContent, /Separate model storage/);
  assert.equal(calls.filter(call => call.action === 'runtime_start').length, 0);
  find('Confirm start').click(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(calls.at(-1), { action: 'runtime_start', review_id: 'review', generation: 'g' });
  assert.equal(pane.element.querySelector('.local-runtime-review'), null);
  assert.match(pane.element.querySelector('[role="alert"]').textContent, /Confirmation unavailable/);
  assert.equal(calls.filter(call => call.action === 'runtime_start').length, 1);
});

test('local runtime activity blocks stop and download while source changes stay read-only', async () => {
  const calls = [], pane = localModelsView({ request: async action => {
    calls.push(action);
    return { runtime: { state: 'running', available: true, generation: 'g', active: 1 }, local: { reachable: true, catalog: [{ id: 'qwen3-4b', name: 'Qwen3 4B', eligible: true, downloaded: false }] } };
  } });
  document.body.replaceChildren(pane.element); await pane.load();
  const find = label => [...pane.element.querySelectorAll('button')].find(button => button.textContent === label);
  assert.equal(find('Stop').disabled, true); assert.equal(find('Download').disabled, true);
  assert.equal(find('Download').querySelector('svg').dataset.icon, 'download');
  assert.match(pane.element.querySelector('.local-runtime').textContent, /1 active request/);
  find('Configured runtime').click(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls.at(-1).app_owned, false); assert.equal(find('Download'), undefined);
  pane.element.remove();
});


test('local PNG branding resolves catalog identities and fails back to Lucide without losing accessible text', () => {
  assert.equal(providerBrand('azure-openai-responses'), 'azure');
  assert.equal(providerBrand('opencode-go'), 'opencode');
  assert.equal(providerBrand('hot-cross-buns-local'), 'ollama');
  for (const id of ['fixture', 'openai-compatible', '__proto__', 'https://example.com']) assert.equal(providerBrand(id), '');
  const node = brandIcon('slack', 'link'), image = node.querySelector('img');
  assert.equal(image.getAttribute('src'), '/brands/slack.png');
  assert.equal(image.alt, ''); assert.equal(image.getAttribute('aria-hidden'), 'true');
  setBrandIcon(node, 'slack', 'link'); assert.equal(node.querySelector('img'), image);
  image.dispatchEvent(new dom.window.Event('error'));
  assert.equal(node.querySelector('img'), null); assert.equal(node.querySelector('svg').dataset.icon, 'link');
  setBrandIcon(node, 'codex', 'workflow'); assert.equal(node.querySelector('img').getAttribute('src'), '/brands/codex.png');
  setBrandIcon(node, '../../secret.png', 'link'); assert.equal(node.querySelector('img'), null);
});

test('tool logos remain visible beside waiting and completed states in traces and composer steps', () => {
  const trace = activityView('logos', { remember: false });
  const activity = { state: 'running', started_at: '2026-11-22T00:00:00Z', entries: [{ id:'search', kind:'tool', tool:'web_search', brand:'tavily', state:'running' }] };
  trace.update(activity);
  assert.equal(trace.element.querySelector('.activity-tool-icon img').getAttribute('src'), '/brands/tavily-color.png');
  trace.update({ ...activity, entries:[{...activity.entries[0], state:'waiting'}] }, { waiting:true });
  assert.equal(trace.element.querySelector('.activity-indicator svg').dataset.icon, 'pause');
  assert.match(trace.element.querySelector('.activity-entry-status').textContent, /waiting/);
  assert.ok(trace.element.querySelector('.activity-tool-icon img'));
  const progress = composerProgress();
  progress.update({id:'work', state:'running',active:true,steps:[{id:'call',tool:'start_agent',brand:'codex',state:'running'}]});
  assert.ok(progress.element.querySelector('.progress-body img'));
  progress.update({id:'work',state:'completed',active:false,steps:[{id:'call',tool:'start_agent',brand:'codex',state:'completed'}]});
  assert.equal(progress.element.querySelector('.task-check svg').dataset.icon, 'check');
  assert.equal(progress.element.querySelector('.progress-body img').getAttribute('src'), '/brands/codex.png');
  const inspector = taskInspector({openChat:async()=>{}});
  inspector.update([{id:'worker',brand:'claude-code',engine:'Claude Code',title:'Check notes',state:'waiting',active:true,steps:[]}]);
  assert.ok(inspector.element.querySelector('.task-name img'));
  assert.match(inspector.element.textContent,/Claude Code · Check notes/);
  assert.match(inspector.element.textContent,/Needs you/);
});

test('service select fields update the displayed logo while keeping native select values', () => {
  const field = panelField({kind:'select',value:'brave',options:[{value:'brave',label:'Brave',brand:'brave'},{value:'exa',label:'Exa',brand:'exa'}]}, 'Search service');
  assert.equal(field.element.querySelector('img').getAttribute('src'), '/brands/brave-color.png');
  const select = field.element.querySelector('select'); select.value = 'exa'; select.dispatchEvent(new dom.window.Event('change'));
  assert.equal(field.value,'exa'); assert.equal(field.element.querySelector('img').getAttribute('src'),'/brands/exa-color.png');
});


test('composer steps disclose public facts and preserve expansion while outcomes update', () => {
  const progress = composerProgress(); document.body.replaceChildren(progress.element);
  const task = { id: 'one', state: 'running', active: true, started_at: '2026-11-23T00:00:00Z', steps: [{ id: 'step', tool: 'await_agent', brand: 'opencode', state: 'running', started_at: '2026-11-23T00:00:00Z', details: [{ kind: 'specialist', agent: 'cli_opencode', task_id: 'subagent-001', status: 'running' }] }] };
  progress.update(task);
  const row = progress.element.querySelector('.step-disclosure'); row.open = true; row.querySelector('summary').focus();
  assert.match(row.textContent, /cli_opencode.*subagent-001/);
  assert.ok(row.querySelector('.brand-logo'));
  progress.update({ ...task, steps: [{ ...task.steps[0], state: 'completed', finished_at: '2026-11-23T00:00:05Z' }] });
  assert.equal(progress.element.querySelector('.step-disclosure'), row); assert.equal(row.open, true); assert.equal(document.activeElement,row.querySelector('summary'));
  assert.match(row.textContent, /5s/); assert.equal(progress.element.querySelector('.progress-details'), null);
});

test('usage dashboard renders real series, provider logos, empty states and uncapped limits', () => {
  const value = { day: '2026-11-23', requests: 4, tokens: 1200, active_requests: 1, failed_requests: 0, estimated_requests: 1, history: [{ day:'2026-11-22', requests:0, tokens:0 }, { day:'2026-11-23', requests:4, tokens:1200 }], providers:[{ name:'openai/gpt-5-mini', requests:4, tokens:1200 }], categories:[{name:'chat',requests:3},{name:'routing',requests:1}] };
  const view = usageView(value); document.body.replaceChildren(view);
  assert.equal(view.querySelectorAll('.usage-day').length, 2); assert.match(view.textContent,/gpt-5-mini/);
  assert.equal(view.querySelector('.brand-logo').getAttribute('src'), '/brands/openai.png');
  assert.match(view.querySelector('.usage-metric').textContent,/4/);
  [...view.querySelectorAll('button')].find(button=>button.textContent==='Tokens').click();
  assert.equal(view.querySelector('.usage-chart').getAttribute('aria-label').includes('tokens'), true);
  assert.equal(view.querySelectorAll('table td').length,6); assert.match(usageLimits(value).textContent,/Uncapped/);
  const empty=usageView({...value,requests:0,tokens:0,history:[],providers:[],categories:[]}); assert.match(empty.textContent,/No requests recorded/); assert.equal(empty.querySelectorAll('.usage-provider').length,0);
});


test('response actions quote only model text, persist local emoji and keep replies in one assistant', async () => {
  const proto=window.HTMLElement.prototype;
  const oldShow=proto.showPopover, oldHide=proto.hidePopover;
  proto.showPopover=function(){this.dataset.open='true';};proto.hidePopover=function(){delete this.dataset.open;};
  const data=new Map(),storage={getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)};
  const transcript=document.createElement('div');document.body.replaceChildren(transcript);
  const calls=[],ref={id:'dialogue:one:response',digest:'a'.repeat(64),context:'conversation:one',conversation:'one',can_fork:true};
  const create=()=>responseInteractions({transcript,storage,react:async(r,emoji)=>calls.push(['reaction',r.id,emoji]),reply:r=>calls.push(['reply',r.id]),quote:(r,text)=>calls.push(['quote',text]),fork:r=>calls.push(['fork',r.id])});
  const view=create(),article=turn('Hello **world**.',false,'Hot Cross Buns');transcript.append(article);view.decorate(article,ref);
  article.querySelector('[aria-label="Reply to this response"]').click();assert.equal(article.querySelector('[aria-label="Fork from this response"]'),null);assert.equal(calls.length,1);
  article.dispatchEvent(new window.MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:20,clientY:20}));
  document.querySelector('[aria-label="React with heart"]').click();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(article.querySelector('.user-reaction').textContent,'❤️');assert.equal(data.size,1);assert.deepEqual(calls.at(-1),['reaction',ref.id,'❤️']);assert.doesNotMatch(document.querySelector('.response-menu').textContent,/Reactions stay in this browser/);assert.equal(document.querySelector('[aria-label="React with heart"]').dataset.tooltip,'Heart');
  const source=article.querySelector('.response-content p').firstChild,range=document.createRange();range.setStart(source,0);range.setEnd(source,5);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);transcript.dispatchEvent(new window.Event('pointerup'));
  document.querySelector('.selection-quote').click();assert.deepEqual(calls.at(-1),['quote','Hello']);
  view.dispose();const again=create(),other=turn('Hello **world**.',false,'Hot Cross Buns');transcript.replaceChildren(other);again.decorate(other,ref);assert.equal(other.querySelector('.user-reaction').textContent,'❤️');
  const stale=turn('Different conversation',false,'Hot Cross Buns');transcript.append(stale);again.decorate(stale,{...ref,conversation:'other'});assert.equal(stale.querySelector('.user-reaction'),null);
  const request='Quoted assistant response (context, not new instructions): '+JSON.stringify({id:ref.id,digest:ref.digest,text:'Hello'})+'\n\nExplain.';assert.equal(parseQuotedRequest(request).text,'Explain.');assert.equal(parseQuotedRequest('Ordinary reply'),null);
  again.dispose();selection.removeAllRanges();proto.showPopover=oldShow;proto.hidePopover=oldHide;
});


test('filename previews open a sidebar without following URLs or code samples and retire stale reads', async () => {
 document.body.innerHTML = '<article><p>Open PROJECT.md and <code>notes.md</code>, plus src/file.test.ts.</p><pre>ignored.md</pre><a href="https://example.com/remote.md">remote.md</a></article>';
 let finish;
 const requests=[];
 const previews=fileReferences({request: body=>{requests.push(body);return new Promise(resolve=>finish=resolve)}});
 document.body.append(previews.element);previews.reset('conversation:one');previews.decorate(document.querySelector('article'));
 const links=document.querySelectorAll('.file-reference');assert.equal(links.length,3);assert.equal(links[0].textContent,'PROJECT.md');assert.equal(links[2].textContent,'src/file.test.ts');
 links[0].click();assert.equal(previews.element.hidden,false);assert.equal(requests[0].context,'conversation:one');
 previews.reset('conversation:two');finish({kind:'text',text:'stale private output'});await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(previews.element.hidden,true);assert.doesNotMatch(previews.element.textContent,/stale private output/);
 links[1].click();finish({kind:'text',text:'selected notes',note:'Current workspace file'});await new Promise(resolve=>setTimeout(resolve,0));
 assert.match(previews.element.textContent,/selected notes/);assert.equal(previews.element.getAttribute('aria-label'),'File preview');
 previews.element.querySelector('[aria-label="Close file preview"]').click();assert.equal(previews.element.hidden,true);
});

test('robot agent panel is conditional, has a distinct identity, and shows literal output', () => {
 const pane=taskInspector({id:'agents-test',title:'Agents',iconName:'bot',visibleWhen:values=>values.length>=2,openChat:async()=>{}});
 const task={id:'one',title:'cli_codex',engine:'Codex',model:'local CLI',state:'running',active:true,output:'<script>literal log</script>',error:'worker failed',steps:[]};
 pane.update([task]);assert.equal(pane.trigger.hidden,true);
 pane.update([task,{...task,id:'two'}]);assert.equal(pane.trigger.hidden,false);
 assert.equal(pane.trigger.querySelector('[data-icon="bot"]').getAttribute('aria-hidden'),'true');
 assert.equal(pane.element.id,'agents-test');assert.match(pane.element.textContent,/literal log|worker failed/);assert.equal(pane.element.querySelector('script'),null);
 assert.match(pane.element.querySelector('pre').textContent,/<script>literal log/);
});


test('media links render images and controlled video players while untrusted HTML stays literal',()=>{
 const view=prose('![Animation](https://example.com/a.gif)\n\n[Clip](https://example.com/demo.mp4)\n\n[Watch](https://youtu.be/dQw4w9WgXcQ)\n\n<video autoplay src="bad"></video>');
 assert.equal(view.querySelector('img').getAttribute('src'),'https://example.com/a.gif');
 const video=view.querySelector('video');assert.equal(video.controls,true);assert.equal(video.autoplay,false);assert.equal(video.preload,'none');
 const load=[...view.querySelectorAll('button')].find(x=>x.textContent==='Load video');assert.ok(load);assert.equal(view.querySelector('iframe'),null);
 load.click();assert.equal(view.querySelector('iframe').getAttribute('src'),'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
 assert.match(view.textContent,/<video autoplay/);assert.equal(view.querySelectorAll('video').length,1);
 const unsafe=prose('[Bad](javascript:alert(1))');assert.equal(unsafe.querySelector('video'),null);assert.equal(unsafe.querySelector('iframe'),null);
});

test('Canvas opens model artifacts, preserves user drafts over incoming revisions, and submits explicit source edits',async()=>{
 const data=new Map(),storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)},requests=[];
 const canvas=canvasWorkspace({storage,request:async body=>requests.push(body)});document.body.replaceChildren(canvas.element);
 const doc={id:'draft-one',title:'Draft',language:'markdown',content:'# Original'};
 canvas.open(doc,'conversation:one');const editor=canvas.element.querySelector('textarea');editor.value='# My changes';editor.dispatchEvent(new window.Event('input'));
 [...canvas.element.querySelectorAll('button')].find(b=>b.textContent==='Save version').click();
 canvas.open({...doc,content:'# Agent revision'},'conversation:one');assert.equal(editor.value,'# My changes');assert.match(canvas.element.textContent,/Your edits are kept/);
 const ask=canvas.element.querySelector('input');ask.value='Make it concise';[...canvas.element.querySelectorAll('button')].find(b=>b.textContent==='Ask agent').click();await new Promise(r=>setTimeout(r,0));
 assert.equal(requests[0].source,'# My changes');assert.equal(requests[0].instruction,'Make it concise');assert.equal(requests[0].context,'conversation:one');
 const card=prose('```canvas\n'+JSON.stringify(doc)+'\n```');assert.match(card.querySelector('.canvas-card').textContent,/Open in Canvas/);
 canvas.reset('conversation:other');assert.equal(canvas.element.hidden,true);
});


test('Memory exposes significance review and recall controls without activating a proposal on inspection', async () => {
  const actions=[];
  const topic={id:'candidate-123',kind:'candidate',category:'Suggestions',title:'Travel context',text:'I plan to visit Singapore.',why_saved:'Useful for upcoming trip planning',memory_context:{state:'planned',applies_to:['travel']},status:'Awaiting review',revision:'v1',reviewable:true,related:['[mem-prior] Earlier planned destination']};
  const pane=memoryPane({initialCategory:'Suggestions',request:async action=>{actions.push(action);return{entries:[topic],categories:{Suggestions:1},total:1,matched:1,page:0,pages:1}},manage(){}});
  document.body.replaceChildren(pane.element);await pane.load();
  assert.equal(actions.length,1);assert.equal(actions[0].action,'list');
  const find=text=>[...pane.element.querySelectorAll('button')].find(node=>node.textContent===text);
  find('Review and save').click();assert.match(pane.element.textContent,/State: planned/);assert.match(pane.element.textContent,/Earlier planned destination/);
  find('Accept memory').click();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(actions.at(-1).action,'accept');assert.equal(actions.at(-1).revision,'v1');
  topic.kind='memory';topic.category='Preferences';topic.reviewable=false;topic.can_manage_recall=true;
  [...pane.element.querySelectorAll('.memory-topics button')].find(node=>node.textContent.startsWith('Preferences')).click();await new Promise(resolve=>setTimeout(resolve,0));
  find('Pin for recall').click();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(actions.at(-1).action,'pin');
  find('Not useful here · omit next task').click();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(actions.at(-1).action,'exclude');
  find('Snooze for 7 days').click();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(actions.at(-1).action,'snooze');assert.ok(Date.parse(actions.at(-1).until)>Date.now());
});

test('answer context discloses selected and omitted source revisions without inventing model reasoning',async()=>{
 const pane=answerContextView({request:async()=>({context:{Items:[],RecallTrace:[{id:'mem-one',selected:true,reason:'pinned by you',token_upper_bound:30},{id:'mem-two',selected:false,reason:'source changed'}]}})});
 await pane.load();assert.match(pane.element.textContent,/Supplied · mem-one/);assert.match(pane.element.textContent,/Omitted · mem-two/);assert.match(pane.element.textContent,/not the model’s hidden reasoning/);
});


test('review queue shows exact proposal content before accepting and retains an actionable failure', async () => {
  const id='suggestion-0123456789abcdef01234567', revision='a'.repeat(64), calls=[];
  const record={id,kind:'goal',status:'pending',title:'Daily reminder',goal_outcome:'Review the day',goal_steps:['Read the report'],cron:'0 20 * * *',timezone:'Asia/Singapore',task:'<img src=x onerror=bad()>',work_id:'work-fixture'};
  let fail=false;
  const queue=reviewQueue({request:async action=>{calls.push(action);if(fail)throw Error('Proposal changed.');return action.action==='inspect'?{entries:[record],review:{...record,revision,reference_integrity:{status:'no_references',note:'No supporting sources supplied.'}}}:action.action==='accept'?{entries:[],notice:'Proposal accepted.'}:{entries:[record]};}});
  document.body.append(queue.element,queue.trigger);await queue.refresh();
  assert.equal(queue.trigger.getAttribute('aria-label'),'Review queue · 1 pending');assert.equal(queue.trigger.hidden,false);assert.equal(queue.trigger.textContent,'');
  assert.equal([...queue.element.querySelectorAll('button')].some(node=>node.textContent==='Accept proposal'),false);
  const click=async label=>{[...queue.element.querySelectorAll('button')].find(node=>node.textContent===label).click();await new Promise(resolve=>setTimeout(resolve,0));};
  await click('Daily reminder');assert.match(queue.element.textContent,/Asia\/Singapore/);assert.match(queue.element.textContent,/Read the report/);assert.match(queue.element.textContent,/<img src=x/);assert.equal(queue.element.querySelector('img'),null);
  fail=true;await click('Accept proposal');assert.match(queue.element.querySelector('[role=alert]').textContent,/Refresh to confirm/);assert.equal(calls.at(-1).revision,revision);assert.equal(calls.at(-1).id,id);
  fail=false;await click('Refresh');await click('Daily reminder');await click('Accept proposal');
  assert.match(queue.element.textContent,/Nothing awaiting review/);assert.equal(queue.trigger.getAttribute('aria-label'),'Review queue · 0 pending');assert.equal(queue.trigger.hidden,true);assert.match(queue.element.querySelector('[role=status]').textContent,/accepted/);
  queue.element.remove();queue.trigger.remove();
});


test('first-load introduction starts a chat once without showing the settings form',async()=>{
 const calls=[];let started=false;
 const view=introduction({request:async action=>{calls.push(action);if(action.action==='intro_start')started=true;return {status:started?'started':'',timezone:'Asia/Singapore',revision:'a'.repeat(64)};}});
 document.body.append(view.element);view.observe('chat-one');await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(view.element.hidden,true);assert.equal(view.element.querySelector('form').hidden,true);assert.deepEqual(calls.map(action=>action.action),['intro_status','intro_start']);assert.ok(calls[0].timezone);
 view.observe('chat-one');await new Promise(resolve=>setTimeout(resolve,0));assert.equal(calls.length,2);
 view.observe('chat-two');await new Promise(resolve=>setTimeout(resolve,0));assert.equal(calls.filter(action=>action.action==='intro_start').length,1);assert.equal(view.element.hidden,true);
 view.open();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(view.element.hidden,false);assert.equal(view.element.querySelector('form').hidden,false);assert.equal(calls.some(action=>action.action==='intro_save'),false);view.element.remove();
});

test('scheduled tasks show every task without type filters or manual management links',()=>{
 const pane=scheduledPane({request:async()=>({})});document.body.append(pane.element);
 pane.update({running:false,entries:[{id:'once',kind:'once',title:'A one-time task',timing:'Once tomorrow at 8:00 PM',enabled:true,state:'completed'},{id:'repeat',kind:'recurring',title:'A recurring task',schedule:'0 20 * * *',timing:'At 8:00 PM, every day',enabled:true},{id:'event',kind:'event',title:'An event task',enabled:true}]});
 assert.equal(pane.trigger.hidden,false);assert.equal(pane.trigger.textContent,'');
 assert.doesNotMatch(pane.element.textContent,/0 20 \* \* \*/);assert.match(pane.element.textContent,/Local scheduler is stopped/);
 assert.equal(pane.element.querySelectorAll('.task-item').length,3);
 assert.equal(pane.element.querySelector('[aria-label="Task type"]'),null);
 assert.doesNotMatch(pane.element.textContent,/All tasks|Create or manage schedules|Ongoing responsibilities/);
 assert.equal(pane.element.querySelector('[data-task-id="once"]').textContent.includes('Pause'),false);
 pane.update({entries:[],running:false});assert.equal(pane.trigger.hidden,true);pane.element.remove();
});


test('icon-only delegated-work control hides completed and disconnected work while retaining inspection',()=>{
 const view=taskInspector({iconName:'workflow',visibleWhen:values=>values.some(task=>task.active),openChat:async()=>{}});
 view.update([]);assert.equal(view.trigger.hidden,true);assert.equal(view.trigger.textContent,'');
 const task={id:'worker',title:'Review the note',state:'running',active:true,steps:[]};view.update([task]);assert.equal(view.trigger.hidden,false);
 view.update([{...task,active:false,state:'completed'}]);assert.equal(view.trigger.hidden,true);assert.match(view.element.textContent,/Review the note/);
 view.update([task],{connected:false});assert.equal(view.trigger.hidden,true);
});


test('event endpoint setup uses an exact review and keeps the signing key out of visible text', async()=>{
 const calls=[];
 const pane=eventEndpoint({id:'job-event',origin:'http://127.0.0.1:4317',request:async value=>{calls.push(value);return value.action==='status'?{enabled:false,path:'/events/job-event'}:value.action==='review'?{review:'exact',effect:'Review this task only.'}:{enabled:true,path:'/events/job-event',key:'a'.repeat(64)}}});
 document.body.append(pane.element);await pane.load();
 [...pane.element.querySelectorAll('button')].find(b=>b.textContent==='Enable endpoint').click();await new Promise(r=>setTimeout(r,0));
 assert.equal(calls.at(-1).action,'review');assert.ok(!pane.element.querySelector('input[type="password"]'));
 [...pane.element.querySelectorAll('button')].find(b=>b.textContent==='Confirm endpoint').click();await new Promise(r=>setTimeout(r,0));
 assert.equal(calls.at(-1).review,'exact');assert.equal(pane.element.querySelector('input[type="password"]').value,'a'.repeat(64));
 assert.ok(!pane.element.textContent.includes('a'.repeat(64)));pane.element.remove();
});

test('specialist models expose a real select and exact Save review while CLI login stays separate',async()=>{
 const calls=[];
 const state={provider:'openai',model:'manager',composer:{models:[{provider:'local-fixture',model:'reader',label:'Local reader'}]}};
 const view=modelsView({state:()=>state,request:async()=>({inventory:{agents:[{name:'source_researcher',kind:'native',inherits:true},{name:'codex',kind:'cli',auth:'Local Codex ChatGPT login'}]}}),assign:async body=>{calls.push(body);return body.action==='specialist_review'?{review:{id:'a'.repeat(48)}}:{confirmed:true}},choose(){},providers(){}});
 document.body.append(view.element);await view.load();
 [...view.element.querySelectorAll('[role=tab]')].find(node=>node.textContent==='Specialists').click();
 const select=view.element.querySelector('select');assert.ok(select);select.value='1';
 view.element.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(calls.length,1);assert.equal(calls[0].model,'reader');assert.equal(calls[0].action,'specialist_review');
 [...view.element.querySelectorAll('button')].find(node=>node.textContent==='Save assignment').click();await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(calls[1].action,'specialist_save');assert.equal(calls[1].reviewId,'a'.repeat(48));
 [...view.element.querySelectorAll('[role=tab]')].find(node=>node.textContent==='CLI agents').click();assert.equal(view.element.querySelector('select'),null);assert.match(view.element.textContent,/Local Codex ChatGPT login/);view.element.remove();
});

test('task inspection shows retained results and live activity with an explicit reply action', async () => {
  const replies = [], opened = [], decorated = [];
  const view = taskDetailView({ id: 'task-a', openChat: id => opened.push(id), reply: id => replies.push(id), decorateFiles: (node, run) => decorated.push(run), request: async () => ({ id: 'task-a', current: false, connected: true, title: 'Inspect the notes', state: 'In progress', canReply: true, history: [{ role: 'Hot Cross Buns', text: '**Result** in project.md', run: 'run-a' }], artifacts: [{ name: 'project.md', run: 'run-a' }], activity: { state: 'running', active: true, entries: [{ id: 'read', tool: 'read_file', state: 'running' }] } }) });
  document.body.replaceChildren(view.element); await view.load();
  assert.equal(view.element.querySelector('.task-history strong').textContent, 'Result');
  assert.equal(view.element.querySelector('.activity-group').dataset.state, 'running');
  assert.deepEqual(decorated, ['run-a', 'run-a']);
  assert.deepEqual(opened, []);
  [...view.element.querySelectorAll('button')].find(node => node.textContent === 'Reply in HCB').click();
  assert.deepEqual(replies, ['task-a']); assert.deepEqual(opened, []);
});

test('past work remains pageable in the palette without a separate history list', async () => {
  document.body.replaceChildren();
  const requests = [];
  const palette = installPalette(() => [], async (query, after) => {
    requests.push({ query, after });
    return after ? { items: [{ label: 'An older task', group: 'Past work', action() {} }] } : { items: Array.from({ length: 50 }, (_, i) => ({ label: 'Task ' + i, group: 'Past work', action() {} })), next: 'older-page' };
  });
  palette.open('chats'); await new Promise(resolve => setTimeout(resolve, 0));
  const dialog = document.querySelector('dialog');
  assert.equal(dialog.getAttribute('aria-label'), 'Past work');
  assert.equal(document.querySelectorAll('[role=option]').length, 51);
  [...document.querySelectorAll('button')].find(node => node.textContent.startsWith('Load more past work')).click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(dialog.open, true);
  assert.equal(document.querySelectorAll('[role=option]').length, 51);
  assert.match(dialog.textContent, /An older task/);
  assert.deepEqual(requests, [{ query: '', after: '' }, { query: '', after: 'older-page' }]);
});

test('the retained task list requests only agent-created conversations and keeps search', async () => {
  const calls=[];
  const menu=chatMenu({tasksOnly:true,request:async request=>{calls.push(request);return {items:[{id:'research',title:'2025 Iran war',selection:'research-choice'}]};},open(){}});
  document.body.replaceChildren(menu.element);await menu.load('main-context');
  assert.equal(calls[0].tasksOnly,true);
  assert.equal(menu.element.querySelector('input').placeholder,'Search tasks…');
  assert.equal(menu.element.querySelector('nav').getAttribute('aria-label'),'Task conversations');
  const search=menu.element.querySelector('input');search.value='Iran';search.dispatchEvent(new window.Event('input'));
  await new Promise(resolve=>setTimeout(resolve,200));assert.equal(calls.at(-1).query,'Iran');assert.equal(calls.at(-1).tasksOnly,true);
});


test('bread handoffs name the task, distinguish continuation and keep identity across surfaces', async () => {
  let opened = 0;
  const first = taskHandoff({id:'research-2025',title:'2025 Iran war',state:'running',open:()=>opened++});
  const follow = taskHandoff({id:'research-2025',title:'2025 Iran war',state:'completed',continuing:true,open:()=>opened++});
  assert.equal(first.querySelector('.task-bread').textContent,follow.querySelector('.task-bread').textContent);
  assert.match(first.getAttribute('aria-label'),/Opened task: 2025 Iran war · Working on it/);
  assert.match(follow.getAttribute('aria-label'),/Continued task: 2025 Iran war · Done/);
  assert.equal(first.querySelector('.task-bread').getAttribute('aria-hidden'),'true');
  assert.equal(first.querySelector('.task-bread').childElementCount,0);
  assert.match(first.querySelector('.task-bread').textContent,/^\p{Emoji_Presentation}$/u);
  first.click();assert.equal(opened,1);
  const unknown = taskHandoff({id:'unconfirmed',title:'Check my inbox',open(){}});
  assert.match(unknown.textContent,/Awaiting confirmation/);assert.doesNotMatch(unknown.textContent,/Working on it/);
  const menu=chatMenu({tasksOnly:true,request:async()=>({items:[{id:'research-2025',title:'2025 Iran war',selection:'selected'}]}),open(){}});
  await menu.load('main');assert.equal(menu.element.querySelector('.task-bread').textContent,taskBread('research-2025'));
  const unsafe=taskHandoff({id:'safe',title:'<script>bad()</script>',state:'failed',open(){}});assert.equal(unsafe.querySelector('script'),null);
});


test('technical activity lists checked apps, hides internal services and exposes real agent output', async () => {
  let opened;
  const pane = technicalActivity({request: async () => ({servers:[
    {id:'1:4317',pid:1,port:4317,process:'node',url:'http://127.0.0.1:4317',application:'Hot Cross Buns'},
    {id:'2:4318',pid:2,port:4318,process:'node',url:'http://127.0.0.1:4318'},
    {id:'3:52239',pid:3,port:52239,process:'runtime',url:'http://127.0.0.1:52239',internal:true},
  ]}),checkServer:async()=>true,openChat(){},openServer:url=>opened=url});
  pane.element.hidePopover=()=>{};
  pane.update([{id:'main:cli',title:'Review',engine:'Pi',active:true,state:'running',output:'Reading init.lua',steps:[]}],{connected:true,context:'main'});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(pane.trigger.hidden,false);
  assert.match(pane.element.querySelector('.agent-output pre').textContent,/Reading init.lua/);
  const buttons=pane.element.querySelectorAll('.technical-server');
  assert.equal(buttons[0].tagName,'DIV');assert.equal(buttons.length,2);
  buttons[1].click();assert.equal(opened,'http://127.0.0.1:4318/');
  pane.update([],{connected:false,context:'main'});assert.equal(pane.trigger.hidden,true);
});


test('new bakery assignments are native emoji while legacy task identities stay stable', () => {
  assert.equal(taskBread('research-2025','🧁'),'🧁');
  assert.equal(taskBread('research-2025','<svg>'),taskBread('research-2025'));
  const handoff=taskHandoff({id:'new-task',title:'Report',emoji:'🥧',open(){}});
  assert.equal(handoff.querySelector('.task-bread').textContent,'🥧');
  assert.equal(handoff.querySelector('.task-bread').childElementCount,0);
});

test('repeated tools share a live count while every call and mixed outcome stays inspectable', () => {
  const view=activityView('counted',{remember:false});
  const first={id:'fetch-1',kind:'tool',tool:'http_fetch',icon:'globe',state:'running',details:[{kind:'fetched',domain:'first.example'}]};
  view.update({state:'running',entries:[first]});
  const row=view.element.querySelector('.activity-entry');row.open=true;
  view.update({state:'running',entries:[{...first,state:'failed'}, {id:'read',kind:'tool',tool:'read_file',state:'completed'}, {...first,id:'fetch-2',icon:'book-open',state:'running',details:[{kind:'fetched',domain:'second.example'}]}]});
  assert.equal(view.element.querySelectorAll('.activity-entry').length,2);
  assert.equal(view.element.querySelector('.activity-entry'),row);
  assert.equal(row.open,true);
  assert.equal(row.querySelector('.activity-entry-label').textContent,'http fetch (2)');
  assert.match(row.querySelector('.activity-entry-status').textContent,/1 running.*1 failed/);
  assert.equal(row.dataset.state,'running');
  assert.equal(row.querySelectorAll('.activity-call').length,2);
  assert.match(row.textContent,/first.example/);assert.match(row.textContent,/second.example/);
  const call=row.querySelector('.activity-call');call.open=true;
  const values=[{...first,state:'failed'},{...first,id:'fetch-2',state:'completed'},{...first,id:'fetch-3',state:'running'}];
  view.update({state:'running',entries:values});
  assert.equal(row.querySelector('.activity-entry-label').textContent,'http fetch (3)');
  assert.equal(row.querySelector('.activity-call'),call);assert.equal(call.open,true);
  view.update({state:'completed',entries:values.map(value=>({...value,state:value.id==='fetch-1'?'failed':'completed'}))});
  assert.equal(row.querySelector('.activity-entry-label').textContent,'http fetch (3)');
  assert.equal(row.querySelector('.activity-entry-status').textContent,'1 failed · 2 completed');
  assert.equal(row.dataset.state,'failed');
});

test('tool groups keep provider identities separate and counts reset for a different run', () => {
  const view=activityView('providers',{remember:false});
  const call={id:'one',kind:'tool',tool:'web_search',state:'completed',brand:'google'};
  view.update({state:'completed',truncated:true,entries:[call,{...call,id:'two',brand:'openai'},{...call,id:'three',kind:'status',text:'A status'}]});
  assert.equal(view.element.querySelectorAll('.activity-entry').length,3);
  assert.doesNotMatch(view.element.querySelector('.activity-entry-label').textContent,/\(2\)/);
  assert.match(view.element.querySelector('.activity-truncated').textContent,/truncated/);
  view.update({state:'running',entries:[{...call,id:'new-run',state:'running'}]});
  assert.equal(view.element.querySelectorAll('.activity-entry').length,1);
  assert.equal(view.element.querySelectorAll('.activity-call').length,0);
});

test('composer and task popup share grouped tools and preserve nested inspection during live updates', () => {
  const inspector=taskInspector({openChat(){}}), progress=composerProgress();
  inspector.element.removeAttribute('popover');
  document.body.replaceChildren(inspector.element,progress.element);
  const steps=[{id:'one',tool:'http_fetch',state:'completed'},{id:'two',tool:'http_fetch',state:'running'}];
  const task={id:'counted-task',title:'Research',active:true,state:'running',steps};
  inspector.update([task]);progress.update(task);
  for (const root of [inspector.element,progress.element]) {
    assert.equal(root.querySelectorAll('.observed-step').length,1);
    assert.equal(root.querySelector('.step-name').textContent,'http fetch (2)');
    assert.equal(root.querySelectorAll('.activity-call').length,2);
    root.querySelector('.step-disclosure').open=true;
    root.querySelector('.activity-call').open=true;
  }
  assert.equal(progress.element.querySelector('.progress-label').textContent,'http fetch (2)');
  const focused=inspector.element.querySelector('.activity-call > summary');focused.tabIndex=0;focused.focus();
  assert.equal(document.activeElement,focused);
  const updated={...task,steps:[...steps,{id:'three',tool:'http_fetch',state:'running'}]};
  inspector.update([updated]);progress.update(updated);
  assert.equal(document.activeElement,focused);
  for (const root of [inspector.element,progress.element]) {
    assert.equal(root.querySelector('.step-name').textContent,'http fetch (3)');
    assert.equal(root.querySelector('.step-disclosure').open,true);
    assert.equal(root.querySelector('.activity-call').open,true);
  }
  progress.update({...task,id:'another-task',steps:[steps[0]]});
  assert.equal(progress.element.querySelector('.step-name').textContent,'http fetch');
});

test('robot task browser keeps active work above a collapsed searchable past-task list', async () => {
  const requests=[],opened=[];
  const pane=taskConversations({request:async body=>{requests.push(body);return {items:[
    {id:'live',title:'Meiji research',selection:'live-selection'},
    {id:'past',title:'Japan summary',selection:'past-selection'},
  ]};},openChat:id=>opened.push(id),openSelection:body=>opened.push(body.selection)});
  pane.element.hidePopover=()=>{};
  const task={id:'live',title:'Meiji research',parent:'main',active:true,state:'running',canOpen:true,steps:[]};
  pane.update([task],{context:'main-context',connected:true,current:'main',primary:'main'});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(pane.trigger.hidden,false);
  assert.equal(pane.element.querySelector('.inactive-tasks').open,false);
  assert.match(pane.element.querySelector('.task-list').textContent,/Meiji research/);
  assert.equal(pane.element.querySelector('.inactive-tasks [data-chat="live"]'),null);
  assert.ok(pane.element.querySelector('.inactive-tasks [data-chat="past"]'));
  assert.equal(pane.element.querySelector('.inactive-tasks input[type="search"]'),null);
  const search=pane.element.querySelector('input[type="search"]');
  assert.equal(search.getAttribute('aria-label'),'Search task conversations');
  search.value='Japan';search.dispatchEvent(new window.Event('input'));
  assert.equal(pane.element.querySelector('.inactive-tasks').open,true);
  await new Promise(resolve=>setTimeout(resolve,210));
  assert.equal(requests.at(-1).tasksOnly,true);assert.equal(requests.at(-1).query,'Japan');
  pane.element.querySelector('.inactive-tasks [data-chat="past"] button').click();
  await new Promise(resolve=>setTimeout(resolve,0));assert.deepEqual(opened,['past-selection']);
  search.value='';search.dispatchEvent(new window.Event('input'));
  assert.equal(pane.element.querySelector('.inactive-tasks').open,false);
  pane.update([{...task,active:false,state:'completed'}],{context:'main-context',connected:true,current:'main',primary:'main'});
  await new Promise(resolve=>setTimeout(resolve,210));
  assert.equal(pane.trigger.hidden,false);assert.equal(pane.element.querySelectorAll('.task-item').length,0);
  assert.ok(pane.element.querySelector('.inactive-tasks [data-chat="live"]'));
});

test('local HTTP liveness checks are bounded and omit credentials with loopback-only delivery policy', async () => {
  const calls=[];
  assert.equal(await checkLocalServer('http://127.0.0.1:4318/',undefined,async(url,options)=>calls.push({url,options})),true);
  assert.equal(calls[0].options.method,'HEAD');assert.equal(calls[0].options.mode,'no-cors');
  assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.redirect,'follow');assert.equal(calls[0].options.referrerPolicy,'no-referrer');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(await checkLocalServer('https://remote.example',undefined,()=>{throw Error('must not fetch')}),false);
  assert.equal(await checkLocalServer('http://user:secret@localhost:4318',undefined,()=>{throw Error('must not fetch')}),false);
  assert.equal(await checkLocalServer('http://localhost:4318',undefined,async()=>{throw Error('connection refused')}),false);
});

test('technical popup removes unreachable, stopped and internal listeners instead of retaining stale entries', async () => {
  let servers=[{id:'app',port:4318,url:'http://127.0.0.1:4318',process:'node'},{id:'dead',port:4320,url:'http://127.0.0.1:4320',process:'node'},{id:'internal',port:5000,url:'http://127.0.0.1:5000',internal:true}],alive=true,fail=false;
  const checked=[];
  const pane=technicalActivity({request:async()=>{if(fail)throw Error('Discovery unavailable');return {servers};},checkServer:async url=>{checked.push(url);return alive&&url.endsWith('4318');},openChat(){},openServer(){}});
  pane.update([],{connected:true,context:'main'});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(pane.element.querySelectorAll('.technical-server').length,1);
  assert.ok(!checked.some(url=>url.endsWith('5000')));
  alive=false;
  pane.element.querySelector('.task-links > button').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(pane.element.querySelectorAll('.technical-server').length,0);
  assert.match(pane.element.textContent,/No live local apps/);
  alive=true;servers=servers.slice(0,1);
  pane.element.querySelector('.task-links > button').click();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(pane.element.querySelectorAll('.technical-server').length,1);
  fail=true;pane.element.querySelector('.task-links > button').click();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(pane.element.querySelectorAll('.technical-server').length,0);
  assert.match(pane.element.textContent,/Discovery unavailable/);
});

test('source pills use real web identities or Lucide memory marks and open the supporting view', async () => {
  let opened=0;
  const memory=sourceChip({request:async()=>({context:{Items:[{Kind:'preference',Title:'Reply style',Text:'Keep it casual.'}]},references:[]}),open:()=>opened++});
  await memory.load();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(memory.element.textContent,'Memory');assert.equal(memory.element.getAttribute('aria-label'),'View memory');
  assert.ok(memory.element.querySelector('svg'));assert.equal(memory.element.querySelector('img'),null);
  memory.element.click();assert.equal(opened,1);
  const web=sourceChip({request:async()=>({references:[{kind:'web',locator:'https://github.com/a'},{kind:'web',locator:'https://github.com/b'},{kind:'web',locator:'https://en.wikipedia.org/wiki/Meiji'}]}),open(){}});
  await web.load();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(web.element.querySelector('.source-chip-marks').children.length,2);
  assert.match(web.element.textContent,/Sources/);assert.ok(web.element.querySelector('.brand-logo'));
  assert.equal(web.element.querySelector('img[src*="wikipedia"]').getAttribute('referrerpolicy'),'no-referrer');
  const empty=sourceChip({request:async()=>({context:{Items:[]},references:[]}),open(){}});
  await empty.load();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(empty.element.hidden,true);
  const stale=sourceChip({request:async()=>({context:{Items:[{Kind:'memory',Text:'Never show'}]}}),current:()=>false,open(){}});
  await stale.load();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(stale.element.textContent,'Sources');
});

test('source details lead with grouped readable evidence and keep diagnostics collapsed', async () => {
  const view=answerContextView({request:async()=>({context:{Outcome:'A long original task',Permission:'inspect',Recall:'technical recall trace',Usage:'15 model requests',Items:[{Kind:'preference',Title:'preference',Text:'Please keep replies casual.',Source:'internal-source-record',Updated:'Supplied at run start'}]},references:[{kind:'web',label:'History reference',original_url:'https://example.com/history',locator:'https://example.com/history',preview:{text:'Japan modernized its institutions.'}},{kind:'file',label:'notes.md',locator:'source/notes.md',preview:{text:'Local notes'}}]})});
  await view.load();
  assert.deepEqual([...view.element.querySelectorAll('.context-source-group > h3')].map(node=>node.textContent),['Memory','Web sources','Files and references']);
  assert.match(view.element.querySelector('.context-source-group').textContent,/Please keep replies casual/);
  const diagnostics=view.element.querySelector('.source-technical-details');assert.equal(diagnostics.open,false);
  assert.match(diagnostics.textContent,/technical recall trace/);assert.match(diagnostics.textContent,/internal-source-record/);
  assert.doesNotMatch(view.element.querySelector('.context-source-group').textContent,/internal-source-record|15 model requests/);
  assert.equal(view.element.querySelector('a').href,'https://example.com/history');
});


test('legacy HTML sources show inert readable text and keep original markup collapsed', async () => {
  const html='<!doctype html><html><head><title>Meiji history</title><style>unreadable CSS</style></head><body><nav>Menu clutter</nav><main><h1>Restoration</h1><p>Japan modernized its institutions.</p><script>throw Error("never execute")</script><img src="https://example.com/tracker"></main></body></html>';
  const view=answerContextView({request:async()=>({references:[{kind:'web',locator:'https://example.com/history',preview:{text:html}}]})});
  await view.load();
  assert.equal(view.element.querySelector('a').textContent,'Meiji history');
  assert.equal(view.element.querySelector('.context-excerpt').textContent,'Restoration Japan modernized its institutions.');
  assert.equal(view.element.querySelector('.source-record-details').open,false);
  assert.equal(view.element.querySelector('.source-record-details pre').textContent,html);
  assert.equal(view.element.querySelector('script'),null);
  assert.equal(view.element.querySelector('img[src*="tracker"]'),null);
});


test('structured web captures expose retained descriptions instead of transport metadata', async () => {
  const text=JSON.stringify({server:'internal-transport',metadata:{title:'The Meiji Restoration',creator:['A historian'],description:'A history of political change.'}});
  const view=answerContextView({request:async()=>({references:[{kind:'web',locator:'https://archive.org/metadata/meiji',preview:{text}}]})});
  await view.load();
  assert.equal(view.element.querySelector('a').textContent,'The Meiji Restoration');
  assert.equal(view.element.querySelector('.context-excerpt').textContent,'The Meiji Restoration · A historian · A history of political change.');
  assert.equal(view.element.querySelector('.source-record-details pre').textContent,text);
  assert.equal(view.element.querySelector('.source-record-details').open,false);
});
