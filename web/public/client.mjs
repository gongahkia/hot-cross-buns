import { voiceInput } from './voice.mjs';
import { responseInteractions, parseQuotedRequest } from "./response-actions.mjs";
import { brandIcon, setBrandIcon, providerBrand } from './brands.mjs';
import { animateSurfaceHeight, viewTransition } from './surface-motion.mjs';
import { element, prose, turn } from "./text.mjs";
import { activityView } from "./activity.mjs";
import { memoryPane } from "./memory.mjs";
import { taskInspector, composerProgress } from "./task-inspector.mjs";
import { scheduledPane } from './scheduled.mjs';
import { canvasWorkspace } from './canvas.mjs';
import { fileReferences } from './file-references.mjs';
import { localBrowser } from './local-browser.mjs';
import { modelPicker } from './model-picker.mjs';
import { modelsView } from './models-view.mjs';
let modelDashboard;
import { chatMenu } from './chats.mjs';
import { settingsView } from './views.mjs';
import { localModelsView } from './local-models.mjs';
import { panelField } from './fields.mjs';
import { transcriptFind } from './find.mjs';
import { readingPosition } from './reading.mjs';
import { reactionFor, reactionChip, reactionPreference } from './reactions.mjs';
import { usageView, usageLimits } from './usage.mjs';
import { taskDetailView } from './task-details.mjs';
import { workspaceView } from './workspace.mjs';
import { streamingResponse } from './streaming.mjs';
import { currentPlan, planReview, planQuestions, correctionText } from './reviews.mjs';
import { icon } from "./icons.mjs";
import { attachmentCard, previewContent, pastedFiles } from "./attachments.mjs";

const $ = id => document.getElementById(id);
const input = $("message"), dialog = $("detail"), detail = $("detail-body");
animateSurfaceHeight($('history'));
animateSurfaceHeight(dialog);
const detailMotion = viewTransition(detail);
const chatMotion = viewTransition(document.querySelector('.paper'));
dialog.addEventListener('beforetoggle', event => {
  if (event.target === dialog && event.newState === 'closed') detailMotion.cancel();
});
const storage = "hot-cross-buns.web.v1";
let snapshot = {}, draft, pending, revision = 0, saveTimer, busy = false, online = false, issue = "";
let transcriptKey = "", streamingText = "", historyKey = "", panelKey = "", workKey = "", panelMode = false;
let draftLoad = 0, saveTail = Promise.resolve(), detailGeneration = 0;
let previewContext;
const previewCache = new Map();
const correctionBar = element('div', undefined, 'correction-context'); correctionBar.hidden = true;
document.querySelector('#composer').prepend(correctionBar);
const draftTextKey = value => ':text:' + value?.context + (value?.correction ? ':correction:' + value.correction.id : '');
const quoteCard=element('div',undefined,'composer-quote');quoteCard.hidden=true;document.querySelector('#composer').prepend(quoteCard);
const interaction= responseInteractions({transcript:$('transcript'),
 reply:ref=>respondTo(ref,'reply'), quote:(ref,text)=>respondTo(ref,'quote',text),
 react:async(ref,emoji)=>{if(pending)throw new Error('Resolve the pending message before reacting.');await flush();await call({op:'reaction',context:ref.context,id:ref.id,digest:ref.digest,emoji,requestId:crypto.randomUUID()});},
 fork:ref=>void execute(async()=>{if(pending)throw new Error('Resolve the pending message before forking.');await flush();await call({op:'response',action:'fork',context:ref.context,id:ref.id,digest:ref.digest,requestId:ref.requestId ||= crypto.randomUUID()});}),
});
async function respondTo(ref,action,text){
  let focusContext;
  await execute(async()=>{
    if(pending)throw new Error('Resolve the pending message before adding a quote.');
    await flush();
    const next=await call({op:'response',action,context:ref.context,id:ref.id,digest:ref.digest,draftText:input.value,...(text!==undefined?{text}:{})});
    if(next.context===snapshot.context){showDraft(next);window.getSelection()?.removeAllRanges();focusContext=next.context;}
  });
  if(focusContext===snapshot.context&&!input.disabled)input.focus();
}
function quotedTurn(text,name){const parsed=parseQuotedRequest(text);const article=turn(parsed?.text??text,true,name);if(parsed){const quote=element('blockquote',parsed.quote.text,'message-quote');quote.prepend(element('small','In reply to Hot Cross Buns'));article.prepend(quote);}return article;}
const reading = readingPosition({ transcript: $('transcript'), streaming: $('streaming') });
document.querySelector('.composer-wrap').prepend(reading.element);
export const find = transcriptFind({ transcript: $('transcript'), revealed: reading.moved });
let reactionMode = reactionPreference();
const filePreviews = fileReferences({ request: body => call({ op: 'file-preview', ...body }) });
document.body.append(filePreviews.element);
const canvas=canvasWorkspace({request:body=>call({op:'canvas-request',...body})});
document.body.append(canvas.element);
document.addEventListener('open-canvas',event=>{filePreviews.close();canvas.open(event.detail,snapshot.context)});
document.addEventListener('local-file-preview-open',()=>canvas.close());
const browser = localBrowser(); document.body.append(browser.element);
document.addEventListener('open-local-app', event => browser.open(event.detail.url, event.detail.trigger));
document.addEventListener('local-app-preview-open', () => { filePreviews.close(); canvas.close(); });
document.addEventListener('local-file-preview-open', () => browser.close());
document.addEventListener('open-canvas', () => browser.close());
const models = modelPicker({select: async (action, state) => {
  if (pending || snapshot.context !== state.context) throw new Error('Resolve the current message before changing models or effort.');
  await flush();
  await frame({type:'composer',composer:{id:state.composer.id,request_id:crypto.randomUUID(),...action}}, state.context);
}, local: () => void execute(showLocalModels), providers: () => void execute(showProviderSetup)});
document.body.append(models.element);
const chats = chatMenu({ request: body => call({ op: 'chats', ...body }), open: async selection => {
  await flush(); await call({ op: 'open-chat', ...selection }); showHistory(false);
}, rename: body => call({ op: 'rename-chat', ...body }) });
$('chat-menu').append(chats.element);
$("attach").replaceChildren(icon("plus"));
$("send").replaceChildren(icon("send"));
$("model-picker").append(icon("chevron"));
const progress = composerProgress();
document.querySelector('.composer-wrap').prepend(progress.element);
const inspector = taskInspector({ iconName: 'helpers', showEmpty: true, openChat: async id => {
  await flush();
  if (id !== snapshot.state?.conversation_id) await call({ op: 'open-work', id });
} });
document.querySelector('.top-actions').prepend(inspector.trigger);
document.body.append(inspector.element);
const agents = taskInspector({ id: 'agent-inspector', title: 'Agents', iconName: 'bot',
  visibleWhen: tasks => tasks.length >= 2,
  openChat: async id => { await flush(); if (id !== snapshot.state?.conversation_id) await call({ op: 'open-work', id }); },
});
document.querySelector('.top-actions').append(agents.trigger);
document.body.append(agents.element);
const scheduled = scheduledPane({ request: body => call({ op: 'scheduled', ...body }),
  description: 'Things I’ll check or remind you about later.',
  manage: () => execute(() => backendRoute('/followup')), goals: () => execute(() => backendRoute('/goals')) });
document.querySelector('.top-actions').prepend(scheduled.trigger);
document.body.append(scheduled.element);
const voice = voiceInput({
  getDraft: () => ({ context: snapshot.context, text: input.value, files: draft?.uploads?.length || 0,
    attachments: JSON.stringify(draft?.uploads?.map(file => file.id) || []), quoted: draft?.response_quote?.id,
    correction: draft?.correction?.id, messages: snapshot.state?.messages, running: snapshot.state?.running || snapshot.state?.working }),
  append: async (text, context) => {
    if (context !== snapshot.context || draft?.context !== context || pending || input.disabled) throw new Error('The draft changed. Return to this chat before recording again.');
    const next = [input.value.trimEnd(), text.trim()].filter(Boolean).join('\n');
    if (new TextEncoder().encode(next).length > 128 * 1024) throw new Error('The transcript exceeds the draft limit. Try a shorter recording.');
    input.value = next; input.dispatchEvent(new Event('input', { bubbles: true }));
  },
  submit: async context => {
    if (context !== snapshot.context || busy || pending) throw new Error('Review the voice transcript in the composer before sending.');
    busy = true; controls();
    try { await submitMessage(); }
    finally { busy = false; controls(); status(); }
  },
});
document.querySelector('#attach').after(voice.trigger);
document.body.append(voice.settings);
document.querySelector('.composer-wrap').prepend(voice.bar);

function renderProgress() {
  chats.updateActivity(snapshot.activity, snapshot.tasks);
  const candidates = (snapshot.tasks || []).filter(task => task.current || task.parent === snapshot.state?.conversation_id);
  const current = candidates.find(task => task.active && task.current) || candidates.find(task => task.active) || candidates.find(task => task.current) || candidates[0];
  progress.update(current, { connected: online });
  inspector.update(snapshot.helpers, { connected: online });
  agents.update(snapshot.agents, { connected: online });
  scheduled.update(snapshot.scheduled);
}

function restore(key) {
  try { return JSON.parse(sessionStorage.getItem(storage + key)); }
  catch { return null; }
}
function remember(key, value) {
  try { if (value) sessionStorage.setItem(storage + key, JSON.stringify(value)); else sessionStorage.removeItem(storage + key); }
  catch { issue = "This browser could not save the draft for reload."; }
}
function status() {
  $("status").textContent = issue || (!online ? "Connecting to local host…" :
    snapshot.connection === "disconnected" ? "The local host disconnected." : snapshot.issue || "");
}
function button(label, action, className = "quiet") {
  const node = element("button", label, className);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}
function controls() {
  const state = snapshot.state;
  const enabled = online && snapshot.connection === "connected" && !snapshot.switching && !busy;
  const writing = enabled && draft?.context === snapshot.context && !state?.panel && !state?.external;
  const waiting = pending?.context === snapshot.context;
  voice.update({ ...state, context: snapshot.context, connected: online && snapshot.connection === 'connected' && !snapshot.switching }, writing && !waiting);
  input.disabled = !writing;
  input.readOnly = waiting;
  $("attach").disabled = !writing || waiting || !!draft?.correction;
  const correction = snapshot.correction?.id === draft?.correction?.id ? snapshot.correction : draft?.correction;
  $("send").disabled = !writing || !waiting && (!!correction?.issue || !input.value.trim() && !draft?.uploads.length);
  const sendLabel = waiting ? "Retry message" : state?.running && !state.dialogueActive ? "Queue message" : "Send message";
  $("send").setAttribute("aria-label", sendLabel);
  $("send").title = sendLabel;
  const model = state?.composer?.models?.find(row => row.provider === state.provider && row.model === state.model);
  const modelLabel = model?.label || state?.model || "Choose model";
  $("model-label").textContent = modelLabel;
  setBrandIcon($("model-brand"), providerBrand(state?.provider), "cpu");
  $("model-picker").setAttribute("aria-label", "Model · " + modelLabel);
  $("model-picker").title = state?.composer?.disabled || state?.composer?.readiness?.issue || modelLabel;
  $("model-picker").disabled = !enabled || !state?.composer || !!state.composer.disabled || !!state?.external;
  const effort = state?.composer?.effort || 'standard';
  $("effort").textContent = effort[0].toUpperCase() + effort.slice(1);
  $("effort").disabled = !enabled || !state?.composer || !!state.composer.disabled || !!state?.external || waiting;
  $("effort").title = state?.composer?.disabled || "Work budget for future messages in this chat";
  $('plan-mode').hidden = !currentPlan(state);
  $('plan-mode').disabled = !enabled;
  models.update({context:snapshot.context,composer:state?.composer,provider:state?.provider,model:state?.model}, enabled && !waiting && !state?.external);
  if (modelDashboard?.element.isConnected) modelDashboard.update();
  for (const node of document.querySelectorAll(".attachment-remove")) node.disabled = !writing || waiting;
  for (const node of document.querySelectorAll(".attachment-open")) node.disabled = !enabled;
  $("new-chat").disabled = !enabled;
  for (const node of document.querySelectorAll("[data-route], #chat-list button")) node.disabled = !enabled;
  renderCorrection(correction);
}
function renderCorrection(value = draft?.correction) {
  correctionBar.hidden = !value;
  if (!value) { correctionBar.replaceChildren(); return; }
  const cancel = button('Cancel', () => void execute(async () => {
    if (pending?.context === draft?.context) throw new Error('Inspect the unconfirmed submission before cancelling its correction draft.');
    const context = draft.context;
    if (!value.recovered) { await flush(); await call({ op: 'cancel-correction', correction: value.id }); }
    remember(':correction:' + context, null); remember(draftTextKey(draft), null); await loadDraft();
  })); cancel.disabled = !!pending || busy;
  const inspect = button('Inspect proposal', () => void execute(() => showTaskDetails(value.owner)));
  correctionBar.replaceChildren(element('span', value.label), inspect, cancel, element('small', value.issue || 'A correction request only. Nothing is approved or executed.', 'hint'));
}
async function execute(operation) {
  if (busy) return;
  busy = true; issue = ""; controls(); status();
  try { await operation(); }
  catch (error) {
    issue = error.message;
    status();
    if (dialog.open) {
      detail.querySelector("[data-action-error]")?.remove();
      const note = element("p", issue, "issue");
      note.dataset.actionError = "";
      note.setAttribute("role", "alert");
      detail.prepend(note);
    }
  } finally { busy = false; controls(); status(); }
}
async function call(data, binary = false) {
  let response;
  try {
    response = await fetch("/api/action", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: snapshot.context, ...data }),
    });
  } catch { throw new Error("The local host did not respond. Check the conversation before trying again."); }
  if (!response.ok) {
    const error = new Error((await response.json()).error);
    error.status = response.status;
    throw error;
  }
  return binary ? response.blob() : response.json();
}

function showDraft(value) {
  draft = value;
  quoteCard.replaceChildren();quoteCard.hidden=!value?.response_quote;
  if(value?.response_quote){
    const text=element('div');
    const origin=button('Replying to Hot Cross Buns',()=>void execute(()=>{const source=[...$('transcript').querySelectorAll('[data-response-id]')].find(node=>node.dataset.responseId===value.response_quote.id);if(!source)throw new Error('Load the earlier response to view the source.');reading.moved();source.scrollIntoView({block:'center',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});source.classList.add('quoted-source');setTimeout(()=>source.classList.remove('quoted-source'),1600);}), 'quiet quote-origin');origin.title='Show quoted response';text.append(origin,element('blockquote',value.response_quote.text));
    const close=button('',()=>void execute(async()=>{if(pending)throw new Error('Resolve the pending message before changing the quote.');await flush();const next=await call({op:'response',action:'clear',context:value.context,draftText:input.value});if(next.context===snapshot.context)showDraft(next);}), 'quiet icon-button');close.append(icon('x'));close.setAttribute('aria-label','Remove quote');close.title='Remove quote';quoteCard.append(icon('quote'),text,close);
  }
  if (value?.correction) remember(':correction:' + value.context, { ...value.correction, text: value.text });
  input.value = value?.text || "";
  const files = value?.uploads || [];
  $("attachments").hidden = !files.length;
  if (previewContext !== value?.context) { previewCache.clear(); previewContext = value?.context; }
  for (const key of previewCache.keys()) if (!files.some(file => key.startsWith(file.id + ":"))) previewCache.delete(key);
  $("attachments").replaceChildren(...files.map(file => attachmentCard(file, {
    load: () => loadPreview(file, value.context),
    open: () => void execute(() => openAttachment(file, value.context)),
    remove: () => void execute(async () => {
      if (pending?.context === value.context) return;
      await flush();
      const next = await call({ op: "remove-file", context: value.context, id: file.id, text: input.value });
      if (snapshot.context === next.context) showDraft(next);
    }),
  })));
  controls();
}
function save(value = draft) {
  if (!value) return Promise.resolve();
  if (value.correction?.recovered) return Promise.resolve();
  const record = { context: value.context, text: value.text, ...(value.correction ? { correction: value.correction.id } : {}) };
  const operation = saveTail.then(() => call({ op: "save", ...record }));
  saveTail = operation.catch(() => {});
  return operation.then(() => {
    if (!value.correction && restore(draftTextKey(value)) === record.text) remember(draftTextKey(value), null);
  });
}
function flush() {
  if (!saveTimer && (typeof restore(draftTextKey(draft)) !== "string" || !draft)) return saveTail;
  clearTimeout(saveTimer); saveTimer = undefined;
  return save();
}
input.addEventListener("input", () => {
  if (!draft) return;
  revision++;
  draft.text = input.value;
  remember(draftTextKey(draft), draft.text);
  if (draft.correction) remember(':correction:' + draft.context, { ...draft.correction, text: draft.text });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    void save().catch(error => { issue = error.message; status(); });
  }, 220);
  controls();
});

async function loadDraft() {
  const context = snapshot.context, version = revision, request = ++draftLoad;
  showDraft(undefined);
  if (snapshot.connection !== "connected" || !context) return;
  try {
    const value = await call({ op: "draft", context });
    if (request !== draftLoad || snapshot.context !== context || version !== revision) return;
    const savedCorrection = restore(':correction:' + context);
    if (!value.correction && savedCorrection?.id) {
      value.correction = { ...savedCorrection, recovered: true, issue: 'This host no longer owns the saved correction target. Your text is kept; cancel this draft and inspect the current proposal before requesting a fresh correction.' };
      value.text = savedCorrection.text || ''; value.uploads = [];
    }
    const unsaved = restore(draftTextKey(value));
    if (typeof unsaved === "string") value.text = unsaved;
    showDraft(value);
  } catch (error) { if (request === draftLoad) { issue = error.message; status(); } }
}
function acceptMessage(id) {
  if (pending?.id !== id) return;
  const context = pending.context;
  const correction = pending.correction;
  pending = undefined;
  remember(":pending", null);
  remember(draftTextKey({ context, ...(correction ? { correction: { id: correction } } : {}) }), null);
  if (correction) { remember(':correction:' + context, null); void loadDraft(); }
  else if (draft?.context === context) showDraft({ ...draft, text: "", uploads: [], response_quote: undefined });
}
pending = restore(":pending");

$("composer").addEventListener("submit", event => {
  event.preventDefault();
  void execute(submitMessage);
});
async function submitMessage() {
    if (!draft || draft.context !== snapshot.context) return;
    if (new TextEncoder().encode(input.value).length > 128 * 1024) throw new Error("Shorten the message to 128 KiB before sending.");
    await flush();
    if (pending && pending.context !== draft.context) {
      throw new Error("A message in another conversation is unconfirmed. Return there to review it.");
    }
    if (!pending && draft.response_quote) await call({op:'response',action:'validate',context:draft.context});
    const next = pending || { id: crypto.randomUUID(), context: draft.context, text: input.value, files: draft.uploads.map(file => file.id), ...(draft.correction ? { correction: draft.correction.id } : {}), ...(draft.response_quote ? {response_quote:draft.response_quote} : {}) };
    if (!next.text.trim() && !next.files.length) return;
    pending = next;
    remember(":pending", pending);
    try { await call({ op: "send", ...next }); acceptMessage(next.id); }
    catch (error) {
      // An explicit backend rejection is shown by the matching admission result.
      // Transport failures retain the original message and ID for a manual retry.
      if (snapshot.state?.uploadResult?.request_id === next.id && snapshot.state.uploadResult.error) {
        pending = undefined; remember(":pending", null);
      }
      throw error;
    }
}
input.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing && !$("send").disabled) {
    event.preventDefault();
    $("composer").requestSubmit();
  }
});

$("attach").addEventListener("click", () => $("files").click());
async function attachFiles(files) {
  if (!files.length || !draft || input.readOnly) return;
  await flush();
  const context = draft.context;
  for (const file of files) {
    const query = new URLSearchParams({ context, name: file.name });
    const response = await fetch("/api/attachment?" + query, {
      method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file,
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error);
    if (snapshot.context === context) showDraft(value);
  }
}
$("files").addEventListener("change", () => {
  const files = [...$("files").files];
  $("files").value = "";
  void execute(() => attachFiles(files));
});
input.addEventListener("paste", event => {
  if (!event.clipboardData || input.disabled || input.readOnly || busy) return;
  const { files, text } = pastedFiles(event.clipboardData);
  if (!files.length) return;
  event.preventDefault();
  if (text) {
    input.setRangeText(text, input.selectionStart, input.selectionEnd, "end");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  void execute(() => attachFiles(files));
});
$("composer").addEventListener("dragover", event => {
  if (!event.dataTransfer.types.includes("Files") || input.disabled || input.readOnly || busy) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  $("composer").classList.add("drag-over");
});
$("composer").addEventListener("dragleave", event => {
  if (!$("composer").contains(event.relatedTarget)) $("composer").classList.remove("drag-over");
});
$("composer").addEventListener("drop", event => {
  $("composer").classList.remove("drag-over");
  const files = [...event.dataTransfer.files];
  if (!files.length) return;
  event.preventDefault();
  if (!input.disabled && !input.readOnly && !busy) void execute(() => attachFiles(files));
});
function loadPreview(file, context, page = 1) {
  const key = file.id + ":" + page;
  if (!previewCache.has(key)) {
    const load = call({ op: "attachment-preview", context, id: file.id, page }).catch(error => { previewCache.delete(key); throw error; });
    previewCache.set(key, load);
    if (previewCache.size > 24) previewCache.delete(previewCache.keys().next().value);
  }
  return previewCache.get(key);
}
async function openAttachment(file, context, page = 1) {
  openDetail(file.name, element("p", "Preparing preview…", "hint"));
  const generation = detailGeneration;
  const view = await loadPreview(file, context, page);
  if (context !== snapshot.context || generation !== detailGeneration || !dialog.open) return;
  const actions = element("div", undefined, "preview-actions");
  const original = download(file.name, { kind: "upload", id: file.id }, context);
  original.textContent = "Download original";
  if (view.kind === "pdf") {
    const previous = button("Previous page", () => void execute(() => openAttachment(file, context, page - 1)));
    const next = button("Next page", () => void execute(() => openAttachment(file, context, page + 1)));
    previous.disabled = page <= 1;
    next.disabled = page >= view.pages;
    actions.append(previous, element("span", "Page " + page + " of " + view.pages, "hint"), next);
  }
  actions.append(original);
  openDetail(file.name, previewContent(view), actions);
}
$("model-picker").addEventListener("click", () => models.open($('model-picker')));

function showHistory(open) {
  const history = $('history');
  if (open === history.matches(':popover-open')) return;
  if (open) history.showPopover(); else history.hidePopover();
}
$('history').addEventListener('toggle', event => {
  if (event.target !== $('history')) return;
  const open = event.newState === 'open';
  $('history-toggle').setAttribute('aria-expanded', String(open));
  if (open) void chats.load(snapshot.context);
});
async function navigate(route) {
  await flush();
  showHistory(false);
  if (route === '/workspace') {
    const context = snapshot.context;
    const view = workspaceView({ source: snapshot.state?.source, request: body => call({ context, ...body }), selected: () => dialog.close() });
    openDetail('Workspace', view.element); await view.load(); return;
  }
  if (['/settings', '/memory', '/knowledge', '/model', '/scheduled'].includes(route) && snapshot.state?.panel) await call({ op: 'navigate', route: '/chat' });
  if (route === '/settings') {
    openDetail('Settings', settingsView({ state: snapshot.state, scheduled: snapshot.scheduled,
      reactionMode, setReactionMode: mode => { reactionMode = reactionPreference(mode); transcriptKey = ''; renderTranscript(snapshot.state || {}); },
      navigate: route => void execute(() => navigate(route)), backend: route => void execute(() => route === '/recovery' ? showTaskDetails() : backendRoute(route)) }));
    return;
  }
  if (route === '/scheduled') { dialog.close(); scheduled.open(); return; }
  if (route === "/model") { await showModels(); return; }
  if (route === "/memory" || route === '/knowledge') {
    const context = snapshot.context;
    const pane = memoryPane({
      request: body => call({ op: "memory", context, ...body }),
      manage: route => void execute(() => backendRoute(route)),
      ...(route === '/knowledge' ? { initialCategory: 'Saved context', sections: ['Saved context'], canAdd: false, description: 'Your saved notes and reference material. Personal facts and preferences are in Memory.' } : {}),
    });
    openDetail(route === '/knowledge' ? 'Saved' : 'Memory', pane.element);
    await pane.load();
    return;
  }
  if (route === '/hot-cross-buns' || route === '/new') dialog.close();
  await call({ op: "navigate", route });
}
async function backendRoute(route) { await flush(); showHistory(false); await call({ op: 'navigate', route }); }
$("new-chat").addEventListener("click", () => void execute(() => navigate("/new")));
for (const node of document.querySelectorAll("[data-route]")) node.addEventListener("click", () => void execute(() => navigate(node.dataset.route)));

function renderHistory(state) {
  chats.updateCurrent(state.conversation_id, state.primary_conversation_id);
  $('main-chat').classList.toggle('picked', !!state.primary);
  if (state.primary) $('main-chat').setAttribute('aria-current', 'page');
  else $('main-chat').removeAttribute('aria-current');
  const key = JSON.stringify([snapshot.context, state.recentId]);
  if (key !== historyKey && $('history').matches(':popover-open')) void chats.load(snapshot.context);
  historyKey = key;
}
function showDetail(title, ...nodes) {
  const changingView = dialog.open;
  const previousTitle = $('detail-title').textContent;
  detailGeneration++;
  $('back-detail').hidden = true; $('back-detail').onclick = null;
  dialog.classList.toggle("memory-pane", nodes.some(node => node.classList?.contains("memory-pane-content")));
  dialog.classList.toggle('wide-pane', nodes.some(node => node.classList?.contains('settings-view') || node.classList?.contains('usage-dashboard') || node.classList?.contains('models-dashboard')));
  $("detail-title").textContent = title;
  detail.replaceChildren(...nodes);
  if (previousTitle !== title) dialog.scrollTop = 0;
  if (!dialog.open) dialog.showModal();
  else if (changingView) detailMotion.reveal();
}
function openDetail(title, ...nodes) {
  panelMode = false;
  showDetail(title, ...nodes);
}
async function showTaskDetails(id = snapshot.state?.conversation_id) {
  const context = snapshot.context;
  if (snapshot.state?.panel) await call({ op: 'navigate', context, route: '/chat' });
  const view = taskDetailView({ id, request: body => call({ context, ...body }),
    openChat: owner => void execute(async () => { await flush(); await call({ op: 'open-work', context, id: owner }); dialog.close(); }),
    reviewPlans: () => { dialog.close(); $('active-work').scrollIntoView({ block: 'center' }); },
    profileRecovery: () => void execute(() => backendRoute('/recovery')),
  });
  openDetail('Task recovery', view.element); await view.load();
}
dialog.addEventListener("cancel", event => { event.preventDefault(); $("close-detail").click(); });
$("close-detail").addEventListener("click", () => {
  if (panelMode) void execute(() => navigate("/chat"));
  else dialog.close();
});
function frame(value, context = snapshot.context) { return call({ op: "frame", frame: value, context }); }

$("effort").addEventListener('click', () => models.open($('effort'), true));
$('plan-mode').addEventListener('click', () => {
  const target = currentPlan(snapshot.state); if (!target) return;
  if (target.plan?.digest) showPlan(target.plan, snapshot.context, snapshot.state.conversation_id);
  else if (target.conversation) void execute(async () => { await flush(); await call({op:'open-work',context:snapshot.context,id:target.conversation}); });
});

async function showModels() {
  const context = snapshot.context;
  const view = modelsView({state:()=>snapshot.state || {}, request:()=>call({op:'providers',action:'inventory',context}),
    choose:async model=>{const state=snapshot.state;if(snapshot.context!==context||pending)throw Error('Return to the original chat before selecting a model.');await flush();await frame({type:'composer',composer:{id:state.composer.id,request_id:crypto.randomUUID(),action:'model',provider:model.provider,model:model.model}},context);},
    local:()=>void execute(showLocalModels),providers:()=>void execute(showProviderSetup)});
  modelDashboard=view;openDetail('Models',view.element);await view.load();
}
async function showLocalModels() {
  const context = snapshot.context;
  const pane = localModelsView({ request: body => call({ op: 'local-models', context, ...body }) });
  openDetail('Local models', pane.element); await pane.load();
}
async function showProviderSetup() {
    const context = snapshot.context;
    const { rows } = await call({ op: "providers", action: "status", context });
    const select = element("select"), label = element("label", "API provider");
    for (const row of rows || []) {
      const item = element("option", row.id);
      item.value = row.id; select.append(item);
    }
    const mark = brandIcon(providerBrand(select.value));
    select.addEventListener("change", () => setBrandIcon(mark, providerBrand(select.value)));
    const field = element("div", undefined, "brand-select"); field.append(mark, select); label.append(field);
    openDetail("Provider setup", label, button("Continue", () => {
      const row = rows?.find(item => item.id === select.value);
      if (row) editProvider(row, context);
    }));
}

function labeledInput(label, value = "", type = "text") {
  const wrapper = element("label", label), field = element("input");
  field.type = type;
  field.value = value;
  wrapper.append(field);
  return { wrapper, field };
}
function editProvider(row, context) {
  const model = labeledInput("Model", row.model || "");
  const endpoint = labeledInput("Endpoint override");
  endpoint.field.placeholder = "Keep current endpoint";
  const replace = labeledInput("Enter a new API key after review", "", "checkbox");
  replace.field.checked = !row.stored && !row.ambient;
  const options = new Map((row.fields || []).map(name => [name, labeledInput(name.replaceAll("_", " "), row.options?.[name] || (name === "api_version" ? row.api_version : ""))]));
  const extra = element("details");
  extra.append(element("summary", "Endpoint and provider options"), endpoint.wrapper, ...[...options.values()].map(item => item.wrapper));
  openDetail(row.id, model.wrapper, extra, replace.wrapper, button("Review settings", () => void execute(async () => {
    const { review } = await call({
      op: "providers", action: "review", provider: row.id, replaceKey: replace.field.checked, context,
      input: {
        model: model.field.value, endpoint_mode: endpoint.field.value ? "override" : "retain", endpoint: endpoint.field.value,
        api_version: options.get("api_version")?.field.value || "",
        options: Object.fromEntries([...options].filter(([name]) => name !== "api_version").map(([name, item]) => [name, item.field.value])),
      },
    });
    if (!review) throw new Error("The provider review is unavailable.");
    const key = labeledInput("API key", "", "password");
    key.field.autocomplete = "off";
    const needsKey = replace.field.checked;
    openDetail("Review provider setup",
      element("p", review.provider + " · " + review.model), element("p", "Processing destination · " + review.destination),
      element("p", "Credential · " + review.credential_action),
      ...Object.entries(review.options || {}).map(([name, value]) => element("p", name.replaceAll("_", " ") + " · " + value)),
      ...(needsKey ? [key.wrapper] : []),
      button("Save and select", () => void execute(async () => {
        const secret = key.field.value;
        key.field.value = "";
        const saved = await call({ op: "providers", action: "save", provider: row.id, reviewId: review.id, key: secret, context });
        if (!saved.confirmed) throw new Error("Provider setup was not confirmed. Review the current settings.");
        dialog.close();
      }), "send"));
    $("detail-title").prepend(brandIcon(providerBrand(review.provider)));
  }), "send"));
  $("detail-title").prepend(brandIcon(providerBrand(row.id)));
}

function renderPanel(panel) {
  const key = JSON.stringify([snapshot.context, panel]);
  if (!panel) {
    panelKey = "";
    if (panelMode && dialog.open) dialog.close();
    panelMode = false;
    return;
  }
  if (key === panelKey) return;
  panelKey = key;
  panelMode = true;
  const context = snapshot.context, id = panel.id, nodes = [], fields = new Map();
  const customUsage = panel.kind === 'usage' && panel.usage;
  if (customUsage) nodes.push(usageView(panel.usage));
  const controlStart = nodes.length;
  const act = (action, rest = {}, key) => frame({ type: "panel", ...(key ? { key } : {}), panel: { id, action, ...rest } }, context);
  if (panel.subtitle) nodes.push(element("p", panel.subtitle, "hint"));
  if (panel.notice) nodes.push(element("p", panel.notice, "hint"));
  if (panel.summary?.length) {
    const summary = element('dl', undefined, 'view-facts');
    for (const field of panel.summary) {
      if (panel.kind === 'memory' && ['Learn from chats', 'Refer to earlier chats'].includes(field.label)) continue;
      summary.append(element('dt', field.label), element('dd', field.value));
    }
    nodes.push(summary);
  }
  for (const block of customUsage ? [] : panel.blocks || []) {
    const section = element(block.collapsible ? 'details' : 'section', undefined, 'view-section');
    if (block.title) section.append(element(block.collapsible ? 'summary' : 'h3', block.title));
    for (const line of block.lines || []) section.append(element('p', panel.kind === 'followup' ? line.replace('Press N to choose sources', 'Choose New check to select sources') : line));
    if (block.fields?.length) {
      const fields = element('dl', undefined, 'view-facts');
      for (const field of block.fields) fields.append(element('dt', field.label), element('dd', field.value));
      section.append(fields);
    }
    nodes.push(section);
  }
  if (panel.filter?.options) {
    const label = element('label', 'Show'), select = element('select');
    for (const value of panel.filter.options) { const option = element('option', value.label); option.value = value.value; select.append(option); }
    select.value = panel.filter.value; select.addEventListener('change', () => void execute(() => act('filter', { text: select.value })));
    label.append(select); nodes.push(label);
  }
  let group;
  if (panel.catalog) {
    const label = element("label", "Search conversations");
    const search = element("input");
    search.value = panel.query || "";
    search.addEventListener("keydown", event => {
      if (event.key === "Enter") void execute(() => act("query", { text: search.value }));
    });
    label.append(search);
    nodes.push(label, button("Search", () => void execute(() => act("query", { text: search.value }))));
    if (panel.catalog.has_previous) nodes.push(button("Previous", () => void execute(() => act("previous"))));
    if (panel.catalog.has_next) nodes.push(button("Next", () => void execute(() => act("next"))));
  }
  for (const [row, item] of (panel.rows || []).entries()) {
    if (item.group && item.group !== group) { group = item.group; nodes.push(element('h3', group)); }
    if (!item.input) {
      if (item.label === 'Local tracking' && panel.kind === 'followup-form') { nodes.push(element('p', item.detail, 'hint')); continue; }
      const option = button(item.label, () => void execute(() => act("activate", { row })), "quiet option");
      if (item.brand) option.prepend(brandIcon(item.brand, item.icon || "link"));
      else if (item.icon) option.prepend(icon(item.icon));
      if (item.detail) option.append(element("small", item.detail));
      if (item.state_label || item.state) option.append(element('small', item.state_label || item.state, 'view-state'));
      for (const field of item.metadata || []) option.append(element('small', field.label + ' · ' + field.value));
      nodes.push(option);
      continue;
    }
    const control = panelField(item.input, item.label);
    if (!item.input.read_only) fields.set(row, control);
    nodes.push(control.element);
  }
  if (fields.size) {
    const hint = panel.hints?.find(item => /ctrl\s*\+\s*(r|enter)/i.test(item.shortcut));
    nodes.push(button(hint?.action || "Review", () => {
      if (![...fields.values()].every(field => field.valid())) return;
      void execute(() => act('key', {
        fields: Object.fromEntries([...fields].filter(([, field]) => field.type !== 'password' || field.value).map(([index, field]) => [index, field.value])),
      }, hint ? 'ctrl+r' : 'enter'));
    }, 'send'));
  } else if (panel.kind === "confirmation") {
    nodes.push(button(panel.hints?.find(hint => /^(enter|y)$/i.test(hint.shortcut))?.action || "Confirm", () => void execute(() => act("key", {}, "enter")), "send"));
  }
  if (["connector", "login"].includes(snapshot.state.external)) nodes.push(button("Continue sign-in", () => void execute(() => call({ op: "continue-setup", context }))));
  if (!fields.size && panel.kind !== 'confirmation') {
    const actions = element("div", undefined, "memory-controls");
    const advanced = element('details', undefined, 'view-advanced'); advanced.append(element('summary', 'Advanced controls'));
    const shown = new Set((panel.rows || []).map(row => row.label.toLowerCase()));
    for (const hint of panel.hints || []) if (/^(ctrl\+[a-z]|[a-z])$/i.test(hint.shortcut)) {
      if (shown.has(hint.action.toLowerCase())) continue;
      if (panel.kind === 'memory' && ['a', 'h'].includes(hint.shortcut.toLowerCase())) {
        const name = hint.shortcut.toLowerCase() === 'a' ? 'Learn from chats' : 'Refer to earlier chats';
        const value = panel.summary?.find(field => field.label === name)?.value;
        const toggle = button(name, () => void execute(() => act('key', {}, hint.shortcut.toLowerCase())), 'setting-switch');
        toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-checked', String(value === 'On'));
        toggle.disabled = !['On', 'Off'].includes(value);
        const status = element('span', value || 'Checking…'); status.append(icon(value === 'On' ? 'check' : 'x')); toggle.append(status); nodes.push(toggle);
        continue;
      }
      const control = button(hint.action.charAt(0).toUpperCase() + hint.action.slice(1), () => void execute(() =>
        panel.kind === 'memory' && hint.shortcut.toLowerCase() === 'c' ? navigate('/model') :
        panel.kind === 'memory' && hint.shortcut.toLowerCase() === 'k' ? navigate('/knowledge') :
        act('key', {}, hint.shortcut.toLowerCase())));
      (hint.group === 'more' ? advanced : actions).append(control);
    }
    if (actions.childNodes.length) nodes.push(actions);
    if (advanced.childNodes.length > 1) nodes.push(advanced);
  }
  for (const link of panel.links || []) if (/^https?:\/\//.test(link.url)) {
    const node = element('a', link.label); node.href = link.url; node.target = '_blank'; node.rel = 'noopener noreferrer'; nodes.push(node);
  }
  if (customUsage) {
    const controls = element('details', undefined, 'usage-controls');
    controls.append(element('summary', 'Limits & controls'), usageLimits(panel.usage), ...nodes.splice(controlStart));
    controls.append(element('p', 'Limits are shared across this computer and reset at midnight UTC. Token counts include estimates until reported. They are admission limits, not a billing ceiling.', 'hint'));
    nodes.push(controls);
  }
  if (!nodes.length) nodes.push(element('p', 'This view has no items yet.', 'hint'));
  const title = customUsage ? 'Usage' : panel.title === 'Follow-up checks' ? 'Scheduled tasks' : panel.title === 'Set up a follow-up check' ? 'Set up a scheduled task' : panel.title === 'Following' ? 'Ongoing responsibilities' : panel.title;
  showDetail(title, ...nodes);
  if (panel.brand) $("detail-title").prepend(brandIcon(panel.brand, "link"));
  $('back-detail').hidden = false; $('back-detail').title = panel.back_label || 'Back';
  $('back-detail').onclick = () => void execute(() => act('key', {}, 'esc'));
}

function describeResult(result) {
  const content = document.createDocumentFragment();
  if (result.summary) content.append(element("p", result.summary));
  for (const field of result.fields || []) content.append(element("p", field.label + " · " + field.value));
  for (const item of result.items || []) content.append(element("p", [item.label, item.state, item.detail].filter(Boolean).join(" · ")));
  for (const section of result.sections || []) {
    content.append(element("h3", section.title), describeResult(section));
  }
  for (const line of result.lines || []) content.append(element("p", line));
  if (result.markdown) content.append(prose(result.markdown));
  if (result.preview !== undefined) content.append(element("pre", JSON.stringify(result.preview, null, 2)));
  if (result.footer) content.append(element("p", result.footer, "hint"));
  return content;
}
function approval(review, context) {
  const actions = element("div", undefined, "review-actions");
  const choose = (approved) => void execute(async () => {
    await call({ op: "approve", context, id: review.id, approved });
    dialog.close();
  });
  if (review.canCorrect) actions.append(button('Request correction', () => void execute(() => beginCorrection({ kind: 'action', review: review.id }, context))));
  actions.append(button("Decline", () => choose(false)), button("Approve this action", () => choose(true), "send"));
  openDetail(review.result.title, describeResult({ ...review.result, footer: review.result.footer?.startsWith("/approve ") ? undefined : review.result.footer }), actions);
}
async function beginCorrection(target, context) {
  if (pending) throw new Error('Resolve the unconfirmed message before opening a correction draft.');
  await flush(); const value = await call({ op: 'begin-correction', context, ...target });
  dialog.close(); if (value.context === snapshot.context) showDraft(value); input.focus();
}
function showPlan(plan, context, conversation) {
  void execute(async () => {
    const action = verb => frame({
      type: "task_plan",
      task_plan: { conversation_id: conversation, task_id: plan.id, revision: plan.revision, digest: plan.digest, action: verb, request_id: crypto.randomUUID() },
    }, context);
    const { review } = await action("inspect");
    if (!review) throw new Error("The current plan is unavailable.");
    const controls = element("div", undefined, "review-actions");
    const questions = review.content?.questions || [];
    const answers = questions.length && review.phase === 'review' && plan.canRevise ? planQuestions(questions, text => void execute(async () => {
      if (pending) throw new Error('Resolve the unconfirmed message before answering plan questions.');
      await flush();
      const value = await call({op:'begin-correction',context,kind:'plan',id:plan.id,revision:plan.revision,digest:plan.digest});
      if (value.context !== snapshot.context) throw new Error('The conversation changed. Reopen the current plan.');
      showDraft({...value,text}); draft.text = text; await save(); dialog.close(); await submitMessage();
    })) : null;
    if (review.phase === 'review' && plan.canRevise) controls.append(button('Request revision', () => void execute(() => beginCorrection({ kind: 'plan', id: plan.id, revision: plan.revision, digest: plan.digest }, context))));
    if (review.state === "queued" && review.phase === "review" && !questions.length) {
      controls.append(button("Approve and start", () => void execute(async () => { await action("approve"); dialog.close(); }), "send"));
    } else if (review.state === "queued" && review.phase === "approved") {
      controls.append(button("Start reviewed work", () => void execute(async () => { await action("start"); dialog.close(); }), "send"));
    }
    openDetail(questions.length ? 'Before we start' : 'Task plan', ...(answers ? [answers] : []), planReview(review), element('p', 'Approval starts this exact revision. External actions still need their own required reviews.', 'hint'), controls);
  });
}

function download(label, ref, context) {
  return button(label, () => void execute(async () => {
    const blob = await call({ op: "download", ref, context }, true);
    const url = URL.createObjectURL(blob), link = element("a");
    link.href = url;
    link.download = label.split("/").at(-1);
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }));
}
function sources(run, context) {
  return button("Sources", () => void execute(async () => {
    const { references } = await call({ op: "sources", context, run });
    const items = references.map(ref => button(ref.label, () => void execute(async () => {
      const value = await call({ op: "source", context, run, path: "evidence:" + ref.id });
      openDetail(ref.label, element("pre", value.text || value.lines?.join("\n") || JSON.stringify(value, null, 2)));
    }), "quiet option"));
    openDetail("Sources", ...(items.length ? items : [element("p", "No sources were retained.", "hint")]));
  }));
}
function renderTranscript(state) {
  const context = snapshot.context;
  filePreviews.reset(context);
  canvas.reset(context);
  const messages = state.messages || [], talks = state.dialogue || [], updates = state.updates || [];
  const key = JSON.stringify([context, messages, talks, updates, state.peers, state.dialogueMore]);
  if (key === transcriptKey) return;
  transcriptKey = key;
  interaction.reset();
  const references=new Map((snapshot.responses||[]).map(ref=>[ref.message_id||ref.id,{...ref,context,conversation:state.conversation_id}]));
  const decorate=(article)=>{const ref=references.get(article.dataset.messageId);if(ref)interaction.decorate(article,ref);};
  reading.before(state.conversation_id || context);
  const time = value => Math.max(0, Date.parse(value) || 0);
  let lastMessageTime = 0;
  const orderedMessages = messages.map(value => {
    lastMessageTime = Math.max(lastMessageTime, time(value.created_at), time(value.activity?.started_at));
    return { type: "message", value, at: lastMessageTime };
  });
  const items = [
    ...orderedMessages,
    ...talks.map(value => ({ type: "talk", value, at: Date.parse(value.created_at) || 0 })),
    ...updates.map(value => ({ type: "update", value, at: Date.parse(value.created_at) || 0 })),
  ].sort((a, b) => a.at - b.at);
  const nodes = [], completions = [];
  if (state.dialogueMore && talks[0]) nodes.push(button("Earlier messages", () => void execute(() => frame({ type: "dialogue_page", dialogue_before: talks[0].sequence }, context))));
  let response;
  for (const { type, value } of items) {
    if (type === "talk") {
      response = undefined;
      const correction = correctionText(value.text);
      const request = quotedTurn(correction?.text ?? value.text, "You");
      if (correction) request.prepend(element('small', correction.label, 'hint'));
      request.dataset.messageId = 'dialogue:' + value.id + ':user';
      const reaction = reactionFor(value, state.conversation_id, reactionMode);
      if (reaction) request.append(reactionChip(reaction));
      if (value.input_ids?.length) {
        const files = element("div", undefined, "meta");
        for (const id of value.input_ids) files.append(download(id.split("/").at(-1), { kind: "upload", id }, context));
        request.append(files);
      }
      nodes.push(request);
      if (value.response && !reaction) { const answer = turn(value.response, false, "Hot Cross Buns"); answer.dataset.messageId = 'dialogue:' + value.id + ':response'; decorate(answer); nodes.push(answer); }
      if (value.issue) nodes.push(element("p", value.issue, "hint"));
      if (value.task_chat) {
        const peer = (state.peers || []).find(item => item.conversation_id === value.task_chat);
        if (peer?.summary) { const result = turn(peer.summary, false, "Task result"); result.dataset.fileRun = peer.run_id || ""; nodes.push(result); }
        nodes.push(button("Open task", () => void execute(async () => {
          await flush(); await call({ op: "open-work", context, id: value.task_chat });
        })));
      }
      continue;
    }
    if (type === "update") {
      response = undefined;
      const article = turn(value.summary, false, "Update");
      article.dataset.messageId = 'update:' + value.id;
      article.prepend(element("h3", value.title));
      nodes.push(article);
      continue;
    }
    if (value.result?.kind === "approval" || !value.text && !value.result && !value.bundle && !value.activity) continue;
    const article = value.role === "You" ? quotedTurn(value.text,value.role) : turn(value.text,false,value.role), meta = element("div", undefined, "meta");
    article.dataset.fileRun = value.bundle?.RunID || value.run_id || '';
    article.dataset.messageId = 'message:' + (value.revision_id || value.run_id || value.created_at || '') + ':' + messages.indexOf(value);
    decorate(article);
    if (value.result) meta.append(button(value.result.title || "Details", () => openDetail(value.result.title || "Details", describeResult(value.result))));
    for (const file of value.bundle?.Artifacts || []) if (file.Valid) meta.append(download(file.Path, { kind: "output", bundle: value.bundle.Path, path: file.Path }, context));
    for (const id of value.input_ids || []) meta.append(download(id.split("/").at(-1), { kind: "upload", id }, context));
    if (value.bundle?.RunID) meta.append(sources(value.bundle.RunID, context));
    if (value.activity) {
      const key = context + ":" + (value.run_id || value.created_at || value.activity.started_at);
      if (value.activity.started_at && liveTraceKey === context + ":" + value.activity.started_at) {
        const completed = liveActivity;
        completed.retain(key);
        article.prepend(completed.element);
        completions.push(() => completed.update(value.activity, { active: false }));
        liveActivity = activityView("live", { remember: false, autoExpand: false });
        $("live-activity").append(liveActivity.element);
        liveTraceKey = "";
      } else {
        const activity = activityView(key);
        activity.update(value.activity);
        article.prepend(activity.element);
      }
    }
    if (!value.text && response && meta.children.length) {
      let links = response.querySelector(".meta");
      if (!links) response.append(links = element("div", undefined, "meta"));
      links.append(...meta.children);
    } else {
      if (meta.children.length) article.append(meta);
      if (article.childNodes.length) nodes.push(article);
      response = value.role === "Hot Cross Buns" && value.text ? article : undefined;
    }
  }
  for (const node of nodes) filePreviews.decorate(node, node.dataset.fileRun);
  $("transcript").replaceChildren(...nodes);
  find.refresh(state.conversation_id || context);
  for (const complete of completions) requestAnimationFrame(complete);
  reading.after();
}
function renderWork(state) {
  const context = snapshot.context;
  const key = JSON.stringify([context, state.running, state.cancelling, state.working, state.approval?.id, state.needsApproval, state.plans, state.recoveries, state.queue?.length, state.composer?.readiness, state.external, snapshot.connection]);
  if (key === workKey) return;
  workKey = key;
  const nodes = [];
  if (snapshot.connection === "disconnected") nodes.push(button("Reconnect", () => void execute(() => call({ op: "reconnect" }))));
  else if (state.approval) {
    const review = state.approval;
    nodes.push(element("span", "Approval requested", "hint"), button("Review action", () => approval(review, context)));
  } else if (state.needsApproval) nodes.push(element("span", "Waiting for exact review details…", "hint"));
  if (state.running) {
    if (!state.cancelling) nodes.push(button("Stop", () => void execute(() => call({ op: "stop", context }))));
  } else if (!state.working && state.composer?.readiness?.state && state.composer.readiness.state !== "configured" && !state.panel) {
    nodes.push(element("span", state.composer.readiness.issue || "Choose a model to start.", "hint"));
  }
  for (const plan of state.plans || []) if (plan.digest) nodes.push(button(plan.questions?.length ? 'Answer plan questions' : "Review plan", () => showPlan(plan, context, state.conversation_id)));
  if (state.recoveries) nodes.push(button("Recovery", () => void execute(() => showTaskDetails())));
  if (state.queue?.length) nodes.push(button(state.queue.length + " queued", () => {
    openDetail("Queued messages", ...state.queue.map(item => element("p", item.text)));
  }));
  if (["connector", "login"].includes(state.external) && !state.panel) nodes.push(button("Continue sign-in", () => void execute(() => call({ op: "continue-setup", context }))));
  if (nodes.length) {
    const region = element("div", undefined, "work-actions");
    region.append(...nodes);
    $("active-work").replaceChildren(region);
  } else $("active-work").replaceChildren();
}
let liveTraceKey = "";
let liveActivity = activityView("live", { remember: false, autoExpand: false });
$("live-activity").append(liveActivity.element);
function renderLiveActivity(state) {
  const active = !!(state.running || state.working);
  $("live-activity").hidden = !active;
  if (active) {
    const traceKey = state.activity?.started_at ? snapshot.context + ":" + state.activity.started_at : "";
    if (liveTraceKey && liveTraceKey !== traceKey) {
      liveActivity = activityView("live", { remember: false, autoExpand: false });
      $("live-activity").replaceChildren(liveActivity.element);
    }
    liveTraceKey = traceKey;
    liveActivity.update(state.activity || {}, {
    active, waiting: !!(state.needsApproval || state.approval), stopping: !!state.cancelling,
    disconnected: snapshot.connection !== "connected" || !online,
    });
  }
}
setInterval(() => { if (!$("live-activity").hidden) liveActivity.clock(); progress.tick(); inspector.tick(); }, 1000);

const streamed = streamingResponse(); $('streaming').append(streamed.element);
function renderStreaming(state) {
  const live = state.running && state.activity?.entries?.at(-1);
  const text = live?.kind === "text" ? live.text : "";
  const identity = snapshot.context + ':' + (state.activity?.started_at || '') + ':' + (live?.id || '');
  const active = online && snapshot.connection === 'connected';
  if (text === streamingText && text && streamed.element.dataset.identity === identity && streamed.element.dataset.active === String(active)) return;
  reading.before(state.conversation_id || snapshot.context);
  streamingText = text;
  streamed.element.dataset.identity = identity;
  streamed.element.dataset.active = String(active);
  if (text) streamed.update(text, identity, { active }); else streamed.clear();
  reading.after();
}
const events = new EventSource("/api/events");
events.onopen = () => { online = true; renderLiveActivity(snapshot.state || {}); renderStreaming(snapshot.state || {}); renderProgress(); controls(); status(); };
events.onerror = () => { online = false; renderLiveActivity(snapshot.state || {}); renderStreaming(snapshot.state || {}); renderProgress(); controls(); status(); };
events.onmessage = ({ data }) => {
  const previous = snapshot;
  snapshot = JSON.parse(data);
  const state = snapshot.state || {};
  const receipt = state.uploadResult;
  if (receipt?.request_id === pending?.id && pending) {
    if (!receipt.error) acceptMessage(receipt.request_id);
    else { pending = undefined; remember(":pending", null); issue = receipt.error; }
  }
  $("title").textContent = state.title && state.title !== "Hot Cross Buns" ? state.title : "New chat";
  document.title = state.conversation_id ? $("title").textContent + " · Hot Cross Buns" : "Hot Cross Buns";
  renderHistory(state);
  renderProgress();
  renderTranscript(state);
  renderLiveActivity(state);
  renderStreaming(state);
  renderWork(state);
  renderPanel(state.panel);
  if (online && previous.state?.conversation_id && state.conversation_id && previous.state.conversation_id !== state.conversation_id) chatMotion.reveal();
  controls();
  status();
  if (previous.context !== snapshot.context || previous.connection !== "connected" && snapshot.connection === "connected" || previous.switching && !snapshot.switching && draft?.context !== snapshot.context) void loadDraft();
};

export function paletteCommands() {
  const commands = [
    { label: "New chat", action: () => $("new-chat").click() },
    { label: 'All chats', action: () => showHistory(true) },
    { label: 'Find in this chat', action: find.open },
    { label: 'Jump to latest', action: reading.latest },
    { label: 'Task recovery', action: () => void execute(() => showTaskDetails()) },
    { label: 'Delegated work', action: inspector.open },
    { label: 'Agents', action: agents.open },
    { label: 'Scheduled tasks', action: scheduled.open },
  ];
  for (const node of document.querySelectorAll("[data-route]")) {
    if (!node.disabled) commands.push({
      label: node.textContent.trim(), group: "Command",
      action: () => node.click(),
    });
  }
  return commands;
}

export async function paletteChats(query) {
  const context = snapshot.context;
  const page = await call({ op: 'chats', context, query });
  if (context !== snapshot.context) throw new Error('The conversation changed. Reopen Chats to refresh.');
  return {
    items: page.items.map(item => ({ label: item.title || 'New chat', group: 'Chat', action: () => void execute(async () => {
      await flush();
      await call({ op: 'open-chat', context, selection: item.selection });
    }) })),
    notice: page.incomplete || page.skipped ? 'Some retained chats could not be read. Reopen Chats to retry.' :
      page.next || page.items.length > 30 ? 'Showing the first 30 chats. Type to search, or use All chats for more.' : '',
  };
}
