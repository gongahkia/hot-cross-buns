import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { get } from "node:http";
import test from "node:test";
import brands from "../../internal/branding/catalog.json" with { type: "json" };
import { fixture } from "./fixture.mjs";
import { pngFixture, pdfFixture } from "../../app-host/tests/pdf-fixture.mjs";

async function stream(url) {
  const abort = new AbortController();
  const response = await fetch(url + "/api/events", { signal: abort.signal });
  assert.equal(response.status, 200);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  return {
    async until(predicate, label) {
      let latest;
      const timer = setTimeout(() => abort.abort(), 10000);
      try {
        while (true) {
          const end = buffer.indexOf("\n\n");
          if (end !== -1) {
            const event = JSON.parse(buffer.slice(6, end));
            latest = event;
            buffer = buffer.slice(end + 2);
            if (predicate(event)) return event;
          } else {
            const { value, done } = await reader.read();
            if (done) throw new Error("Browser event stream closed");
            buffer += value;
          }
        }
      } catch (error) {
        const state = latest?.state;
        throw new Error("Waiting for " + label + " · " + JSON.stringify({
          context: latest?.context, issue: latest?.issue, status: state?.status,
          messages: state?.messages?.slice(-6).map(message => message.text),
        }), { cause: error });
      } finally { clearTimeout(timer); }
    },
    close: () => abort.abort(),
  };
}

test("local browser keeps the Go owner and draft across reconnects, with exact file admission and review", { timeout: 35000 }, async () => {
  const app = await fixture({ startInSide: true });
  const send = (value, origin = app.url) => fetch(app.url + "/api/action", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(value),
  });
  const act = async value => {
    const response = await send(value), data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    return data;
  };
  let live;
  try {
    const page = await fetch(app.url);
    const html = await page.text();
    assert.match(html, /Hot Cross Buns/);
    assert.doesNotMatch(html, /data-route="\/scheduled"/);
    for (const file of new Set(brands.map(brand => brand.file))) {
      const response = await fetch(app.url + '/brands/' + file);
      assert.equal(response.status, 200, file);
      assert.equal(response.headers.get('content-type'), 'image/png');
      const png = Buffer.from(await response.arrayBuffer());
      assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.ok(png.readUInt32BE(16) >= 16 && png.readUInt32BE(20) >= 16);
    }
    for (const file of ['unknown.png', 'catalog.json', 'README.md']) assert.equal((await fetch(app.url + '/brands/' + file)).status, 404);
    assert.doesNotMatch(html, /Output preview|Memory preview|\/preview\//);
    for (const path of ['/preview.mjs', '/memory-preview.mjs', '/output-samples.mjs', '/memory-samples.mjs', '/preview.gif']) assert.equal((await fetch(app.url + path)).status, 404);
    assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    const artifact = await fetch(app.url + "/artifact");
    assert.equal(artifact.status, 200);
    const policy = artifact.headers.get("content-security-policy");
    assert.match(policy, /script-src 'unsafe-inline'/);
    for (const directive of ["default-src", "connect-src", "frame-src", "form-action", "object-src"]) {
      assert.ok(policy.includes(directive + " 'none'"));
    }
    assert.doesNotMatch(page.headers.get("content-security-policy"), /script-src[^;]*unsafe-inline/);
    assert.equal((await send({ op: "draft" }, "https://other.example")).status, 403);
    const foreignHost = await new Promise((resolve, reject) => {
      get(app.url + "/api/events", { headers: { Host: "other.example" } }, response => {
        resolve(response.statusCode);
        response.resume();
      }).on("error", reject);
    });
    assert.equal(foreignHost, 421);
    live = await stream(app.url);
    const { context } = await live.until(s => s.connection === "connected", "connection");
    assert.equal((await send({ op: "frame", context, frame: { type: "external_done", error: "" } })).status, 400);
    assert.equal((await send({ op: "save", context: "conversation:other", text: "Other draft" })).status, 409);
    await act({ op: "save", context, text: "What is in the fixture brief?" });
    const upload = await fetch(app.url + "/api/attachment?" + new URLSearchParams({ context, name: "brief.txt" }), {
      method: "POST", headers: { "Content-Type": "application/octet-stream", Origin: app.url }, body: "Frozen fixture attachment",
    });
    assert.equal(upload.status, 200);
    const { uploads } = await upload.json();
    live.close();
    live = await stream(app.url);
    const saved = await act({ op: "draft", context });
    assert.equal(saved.text, "What is in the fixture brief?");
    assert.deepEqual(saved.uploads, uploads);
    app.block();
    const message = { op: "send", context, text: saved.text, files: uploads.map(file => file.id), id: randomUUID() };
    await act(message);
    const working = await live.until(s => s.state?.running && s.state?.conversation_id, "work admission");
    live.close();
    live = await stream(app.url);
    assert.equal((await live.until(s => s.state?.running, "reconnected running state")).state.conversation_id, working.state.conversation_id);
    await act(message);
    app.release();
    const finished = await live.until(s => !s.state?.running && s.state?.messages.some(item => item.text.includes("Fixture answer")), "finished reply");
    assert.equal(finished.state.messages.filter(item => item.text === saved.text).length, 1);
    assert.ok(app.payloads.some(value => value.tools?.length && value.messages.some(message =>
      message.role === "system" && String(message.content).includes("muted sage #888f7b"))));
    assert.ok(app.payloads.some(value => JSON.stringify(value).includes("Frozen fixture attachment")));
    const file = await send({ op: "download", context: finished.context, ref: { kind: "upload", id: uploads[0].id } });
    assert.equal(await file.text(), "Frozen fixture attachment");
    assert.equal((await act({ op: "draft", context: finished.context })).text, "");
    await act({ op: "send", context: finished.context, id: randomUUID(), text: "Run a fixture approval for a web source", files: [] });
    const review = await live.until(s => s.state?.approval, "exact review");
    assert.match(JSON.stringify(review.state.approval.result), /example\.invalid/);
    assert.equal(review.state.pending_approval, undefined);
    assert.equal((await send({ op: "approve", context: review.context, id: "a".repeat(64), approved: true })).status, 409);
    await act({ op: "approve", context: review.context, id: review.state.approval.id, approved: false });
    await live.until(s => !s.state?.needsApproval && !s.state?.running, "decline");
    await act({ op: "navigate", context: finished.context, route: "/new" });
    const fresh = await live.until(s => s.context !== finished.context && !s.switching, "new chat");
    assert.equal((await act({ op: "draft", context: fresh.context })).text, "");
    const old = fresh.state.recent.find(item => item.id === finished.state.conversation_id);
    assert.ok(old);
    await act({ op: "frame", context: fresh.context, frame: { type: "conversation", conversation: { id: old.id, list_id: fresh.state.recentId } } });
    await live.until(s => s.context === finished.context && !s.switching, "reopen chat");
    const provider = { op: "providers", context: finished.context, provider: "openai" };
    const inventory = await act({ ...provider, action: "status" });
    assert.ok(inventory.rows.some(row => row.id === "openai"));
    const settings = { model: "gpt-4.1", endpoint_mode: "default", endpoint: "", api_version: "", options: {} };
    const { review: providerReview } = await act({ ...provider, action: "review", input: settings, replaceKey: true });
    const dummyKey = "web-fixture-credential-never-sent-to-a-provider";
    const configured = await act({ ...provider, action: "save", reviewId: providerReview.id, key: dummyKey });
    assert.equal(configured.confirmed, true);
    assert.ok(!JSON.stringify(configured).includes(dummyKey));
    const ready = await live.until(s => s.state?.provider === "openai", "reviewed provider selection");
    assert.ok(!JSON.stringify(ready).includes(dummyKey));
    await act({ op: "save", context: ready.context, text: "Keep this draft while changing models." });
    await act({ op: "frame", context: ready.context, frame: { type: "composer", composer: {
      id: ready.state.composer.id, request_id: randomUUID(), action: "model", provider: "fixture", model: "fixture",
    } } });
    const switched = await live.until(s => s.state?.provider === "fixture", "composer model selection");
    assert.ok(switched.state.composer.models.some(model => model.provider === 'openai' && model.model === 'gpt-4.1'));
    const catalog = await act({op:'providers',context:ready.context,action:'inventory'});
    assert.ok(catalog.inventory.providers.some(row=>row.id==='gemini'));
    assert.ok(catalog.inventory.providers.find(row=>row.id==='openai').models.includes('gpt-4.1'));
    await act({op:'frame',context:ready.context,frame:{type:'composer',composer:{
      id:switched.state.composer.id,request_id:randomUUID(),action:'model',provider:'openai',model:'gpt-4.1',
    }}});
    const restored = await live.until(s=>s.state?.provider==='openai'&&s.state?.model==='gpt-4.1','saved cloud model selection');
    await act({op:'frame',context:ready.context,frame:{type:'composer',composer:{
      id:restored.state.composer.id,request_id:randomUUID(),action:'model',provider:'fixture',model:'fixture',
    }}});
    await live.until(s=>s.state?.provider==='fixture','restore fixture model');
    assert.equal((await act({ op: "draft", context: ready.context })).text, "Keep this draft while changing models.");
    await act({op:'navigate',context:ready.context,route:'/search'});
    const search = await live.until(s => s.state?.panel?.kind === 'search', 'web search management');
    const row = search.state.panel.rows.findIndex(row => row.label === 'Choose search service');
    assert.ok(row >= 0);
    await act({op:'frame',context:ready.context,frame:{type:'panel',panel:{id:search.state.panel.id,action:'activate',row}}});
    const form = await live.until(s => s.state?.panel?.kind === 'settings-form', 'search service choices');
    assert.deepEqual(form.state.panel.rows[0].input.options.map(option => option.brand), ['tinyfish','exa','tavily','brave']);
    assert.equal(form.state.panel.brand, undefined);
  } finally {
    live?.close();
    await app.close();
  }
});

test("composer effort is scoped to its conversation, preserves the draft, and rejects stale controls", { timeout: 20000 }, async () => {
  const app = await fixture({ startInSide: true }), live = await stream(app.url);
  const act = async (body, status = 200) => {
    const response = await fetch(app.url + '/api/action', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.url }, body: JSON.stringify(body),
    });
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return data;
  };
  try {
    const initial = await live.until(s => s.connection === 'connected', 'connection');
    const { context } = initial;
    assert.equal(initial.state.composer.effort, 'standard');
    await act({ op: 'save', context, text: 'Keep this draft while choosing effort.' });
    const upload = await fetch(app.url + '/api/attachment?' + new URLSearchParams({ context, name: 'context.txt' }), {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Origin: app.url }, body: 'Private test attachment',
    });
    assert.equal(upload.status, 200);
    const { uploads } = await upload.json();
    const choose = (composer, effort) => act({ op: 'frame', context, frame: { type: 'composer', composer: {
      id: composer.id, request_id: randomUUID(), action: 'effort', effort,
    } } });
    await choose(initial.state.composer, 'high');
    const high = await live.until(s => s.state?.composer?.effort === 'high', 'high effort');
    assert.deepEqual(high.state.composer.budget, { work_steps: 48, code_steps: 32 });
    await act({ op: 'frame', context, frame: { type: 'composer', composer: {
      id: initial.state.composer.id, request_id: randomUUID(), action: 'effort', effort: 'low',
    } } }, 409);
    const saved = await act({ op: 'draft', context });
    assert.equal(saved.text, 'Keep this draft while choosing effort.');
    assert.deepEqual(saved.uploads, uploads);
    await choose(high.state.composer, 'low');
    const low = await live.until(s => s.state?.composer?.effort === 'low', 'low effort');
    assert.deepEqual(low.state.composer.budget, { work_steps: 12, code_steps: 8 });
    await choose(low.state.composer, 'high');
    await live.until(s => s.state?.composer?.effort === 'high', 'restored high effort');
    await act({ op: 'navigate', context, route: '/new' });
    const fresh = await live.until(s => s.context !== context && !s.switching, 'new chat');
    assert.equal(fresh.state.composer.effort, 'standard');
    await act({ op: 'frame', context: fresh.context, frame: { type: 'conversation', conversation: {
      id: initial.state.conversation_id, list_id: fresh.state.recentId,
    } } });
    const reopened = await live.until(s => s.context === context && !s.switching, 'original chat');
    assert.equal(reopened.state.composer.effort, 'high');
    assert.equal((await act({ op: 'draft', context })).text, saved.text);
    assert.equal(app.payloads.length, 0);
  } finally { live.close(); await app.close(); }
});

test('scheduled tasks refresh through the canonical check API and reject unsupported or stale actions', { timeout: 20000 }, async () => {
  const app = await fixture({ startInSide: true }), live = await stream(app.url);
  try {
    const initial = await live.until(snapshot => snapshot.connection === 'connected', 'connection');
    const send = body => fetch(app.url + '/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.url }, body: JSON.stringify({ context: initial.context, op: 'scheduled', ...body }) });
    const response = await send({ action: 'refresh' });
    assert.equal(response.status, 200);
    const value = await response.json(); assert.deepEqual(value.entries, []);
    assert.equal(typeof value.running, 'boolean');
    assert.equal((await send({ action: 'pause', id: 'job-missing', digest: 'old' })).status, 400);
    assert.equal((await send({ action: 'pause', id: 'job-missing', digest: 'a'.repeat(64) })).status, 409);
    assert.equal((await send({ action: 'run' })).status, 400);
    assert.equal((await send({ context: 'conversation:other', action: 'refresh' })).status, 409);
    assert.equal(app.payloads.length, 0);
  } finally { live.close(); await app.close(); }
});

test("browser activity streams real tool outcomes and retains timing with the finished answer", { timeout: 20000 }, async () => {
  const app = await fixture({ startInSide: true });
  const live = await stream(app.url);
  try {
    const initial = await live.until(s => s.connection === "connected", "connection");
    app.blockAfterTool();
    const response = await fetch(app.url + "/api/action", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: app.url },
      body: JSON.stringify({ op: "send", context: initial.context, text: "Run fixture activity. Read the note and summarize it.", files: [], id: randomUUID() }),
    });
    assert.equal(response.status, 200);
    const working = await live.until(s => s.state?.activity?.entries.some(entry => entry.kind === "tool" && entry.state === "completed"), "public tool outcome");
    assert.equal(working.state.running, true);
    assert.ok(working.state.activity.started_at);
    const tool = working.state.activity.entries.find(entry => entry.kind === "tool");
    assert.equal(tool.tool, "read_file");
    assert.ok(tool.started_at);
    assert.ok(tool.finished_at);
    assert.match(JSON.stringify(tool.details), /source\/note.md/);
    assert.doesNotMatch(JSON.stringify(working.state.activity), /Private fixture note content/);
    const schedulesWhileWorking = await fetch(app.url + '/api/action', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.url },
      body: JSON.stringify({ op: 'scheduled', context: working.context, action: 'refresh' }),
    });
    assert.equal(schedulesWhileWorking.status, 200);
    assert.ok(Array.isArray((await schedulesWhileWorking.json()).entries));
    const task = working.tasks.find(task => task.id === working.state.conversation_id);
    assert.equal(task.current, true);
    assert.equal(task.state, 'running');
    assert.equal(task.steps.find(step => step.tool === 'read_file').state, 'completed');
    assert.doesNotMatch(JSON.stringify(task), /Private fixture note content|arguments|approval_token/);
    const navigate = await fetch(app.url + '/api/action', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.url },
      body: JSON.stringify({ op: 'navigate', context: working.context, route: '/new' }),
    });
    assert.equal(navigate.status, 200);
    const fresh = await live.until(s => s.context !== working.context && !s.switching, 'new chat with background activity');
    const background = fresh.tasks.find(task => task.id === working.state.conversation_id);
    assert.equal(background.current, false);
    assert.equal(background.state, 'running');
    assert.equal(background.steps[0].state, 'completed');
    assert.equal(background.steps[0].icon, 'book-open');
    app.release();
    const ready = await live.until(s => s.tasks?.some(task => task.id === background.id && task.state === 'completed'), 'background completion');
    assert.equal(ready.context, fresh.context);
    assert.equal(ready.tasks.find(task => task.id === background.id).steps[0].state, 'completed');
    const reopen = await fetch(app.url + '/api/action', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.url },
      body: JSON.stringify({ op: 'open-work', context: fresh.context, id: background.id }),
    });
    assert.equal(reopen.status, 200);
    const finished = await live.until(s => !s.state?.running && s.state?.messages.some(message => message.activity?.finished_at), "finished activity");
    const retained = finished.state.messages.find(message => message.activity?.entries.some(entry => entry.tool === "read_file"));
    assert.equal(retained.activity.state, "completed");
    assert.ok(retained.activity.finished_at);
    assert.match(retained.text, /Fixture answer/);
    assert.equal(retained.activity.entries.filter(entry => entry.text?.includes("Fixture answer")).length, 0);
    const requestContext = async body => {
      const response = await fetch(app.url + '/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.url }, body: JSON.stringify({ op: 'answer-context', context: finished.context, ...body }) });
      return { status: response.status, value: await response.json() };
    };
    const calls = app.payloads.length;
    const inspected = await requestContext({ run: retained.run_id });
    assert.equal(inspected.status, 200, JSON.stringify(inspected.value));
    assert.equal(inspected.value.context.WorkID, retained.run_id);
    assert.equal(inspected.value.context_error, undefined);
    assert.match(inspected.value.references.find(reference => reference.locator === 'source/note.md').preview.text, /Private fixture note content/);
    assert.equal(app.payloads.length, calls, 'inspection must not call the model');
    assert.equal((await requestContext({ run: retained.run_id, context: 'conversation:other' })).status, 409);
    const foreign = await requestContext({ run: 'run-foreign' });
    assert.match(foreign.value.context_error, /answer’s conversation/);
    assert.equal(foreign.value.context, undefined);
    assert.equal((await fetch(app.url + '/answer-context.mjs')).status, 200);
  } finally { live.close(); await app.close(); }
});

test("attachment previews restore selected files, render PDF pages, and enforce conversation ownership", { timeout: 25000 }, async () => {
  const app = await fixture({ startInSide: true });
  const live = await stream(app.url);
  const action = async body => {
    const response = await fetch(app.url + "/api/action", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: app.url }, body: JSON.stringify(body),
    });
    return { status: response.status, value: await response.json() };
  };
  try {
    const initial = await live.until(s => s.connection === "connected", "connection");
    const context = initial.context;
    const files = [];
    for (const [name, bytes] of [["note.txt", "<script>keep this as text</script>"], ["picture.png", pngFixture()], ["pages.pdf", pdfFixture()]]) {
      const response = await fetch(app.url + "/api/attachment?" + new URLSearchParams({ context, name }), {
        method: "POST", headers: { "Content-Type": "application/octet-stream", Origin: app.url }, body: bytes,
      });
      assert.equal(response.status, 200);
      const draft = await response.json();
      files.push(draft.uploads.at(-1));
    }
    const text = await action({ op: "attachment-preview", context, id: files[0].id });
    assert.equal(text.status, 200);
    assert.equal(text.value.kind, "text");
    assert.equal(text.value.text, "<script>keep this as text</script>");
    const image = await action({ op: "attachment-preview", context, id: files[1].id });
    assert.match(image.value.data, /^data:image\/png;base64,/);
    const pdf = await action({ op: "attachment-preview", context, id: files[2].id, page: 2 });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.value.page, 2);
    assert.equal(pdf.value.pages, 2);
    assert.match(pdf.value.data, /^data:image\/png;base64,/);
    assert.equal((await action({ op: "attachment-preview", context, id: files[2].id, page: 3 })).status, 400);
    assert.equal((await action({ op: "draft", context })).value.uploads.length, 3);
    assert.equal((await action({ op: "attachment-preview", context, id: "a".repeat(32) + "/other.txt" })).status, 400);
    assert.equal((await action({ op: "attachment-preview", context: "conversation:other", id: files[0].id })).status, 409);
    await action({ op: "navigate", context, route: "/new" });
    const fresh = await live.until(s => s.context !== context && !s.switching, "new context");
    assert.equal((await action({ op: "attachment-preview", context: fresh.context, id: files[0].id })).status, 400);
  } finally { live.close(); await app.close(); }
});

test("Memory reads canonical records and protects corrections and forgetting with revisions", { timeout: 20000 }, async () => {
  const app = await fixture({ memories: ["I prefer quiet interfaces.", "I like concise answers."] });
  const live = await stream(app.url);
  const action = async body => {
    const response = await fetch(app.url + "/api/action", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: app.url }, body: JSON.stringify(body),
    });
    return { status: response.status, value: await response.json() };
  };
  try {
    const { context } = await live.until(s => s.connection === "connected", "connection");
    const catalog = await action({ op: "memory", action: "list", context });
    assert.equal(catalog.status, 200);
    assert.equal(catalog.value.total, 2);
    assert.equal(catalog.value.categories.Preferences, 2);
    const item = catalog.value.entries.find(topic => topic.text.includes("quiet"));
    assert.equal(item.editable, true);
    const changed = await action({ op: "memory", action: "correct", context, id: item.id, revision: item.revision, text: "I prefer minimal interfaces." });
    assert.equal(changed.status, 200);
    assert.match(changed.value.entries.find(topic => topic.id === item.id).text, /minimal/);
    assert.equal((await action({ op: "memory", action: "forget", context, id: item.id, revision: item.revision })).status, 409);
    const updated = changed.value.entries.find(topic => topic.id === item.id);
    const removed = await action({ op: "memory", action: "forget", context, id: item.id, revision: updated.revision });
    assert.equal(removed.status, 200);
    assert.equal(removed.value.total, 1);
    const filtered = await action({ op: "memory", action: "list", context, query: "concise", category: "Preferences" });
    assert.equal(filtered.value.matched, 1);
    assert.equal((await action({ op: "memory", action: "list", context: "conversation:other" })).status, 409);
    assert.equal((await action({ op: "frame", context, frame: { type: "personal_memory", personal_memory: { action: "list", request_id: "untrusted" } } })).status, 400);
    assert.equal(app.payloads.length, 0);
  } finally { live.close(); await app.close(); }
});

test('all-chat browsing loads beyond the recent limit and opens a version-checked older selection without model work', { timeout: 25000 }, async () => {
  const app = await fixture({ chatCount: 62 });
  const live = await stream(app.url);
  const action = async body => {
    const response = await fetch(app.url + '/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.url }, body: JSON.stringify(body) });
    return { status: response.status, value: await response.json() };
  };
  try {
    const initial = await live.until(s => s.connection === 'connected', 'connection');
    const first = await action({ op: 'chats', context: initial.context });
    assert.equal(first.status, 200);
    assert.equal(first.value.items.length, 50);
    assert.ok(first.value.next);
    const second = await action({ op: 'chats', context: initial.context, after: first.value.next });
    assert.equal(second.status, 200);
    assert.ok(second.value.items.some(item => item.id === app.seededChats.at(-1).id));
    const earlier = first.value.items.find(item => item.id === app.seededChats[20].id);
    assert.ok(earlier);
    assert.equal((await action({ op: 'open-chat', context: initial.context, selection: 'invented' })).status, 409);
    assert.equal((await action({ op: 'open-chat', context: initial.context, selection: earlier.selection })).status, 200);
    const selected = await live.until(s => s.state?.conversation_id === earlier.id && !s.switching, 'older selected chat');
    assert.equal((await action({ op: 'open-chat', context: selected.context, selection: first.value.items[0].selection })).status, 409);
    assert.equal(app.payloads.length, 0);
  } finally { live.close(); await app.close(); }
});

test('manual memory creation uses the real store and keeps type icons and revision-checked corrections', { timeout: 20000 }, async () => {
  const app = await fixture({ startInSide: true }); const live = await stream(app.url);
  const action = async body => {
    const response = await fetch(app.url + '/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.url }, body: JSON.stringify(body) });
    return { status: response.status, value: await response.json() };
  };
  try {
    const { context } = await live.until(s => s.connection === 'connected', 'connection');
    const added = await action({ op: 'memory', action: 'add', context, memory_kind: 'fact', text: 'I prefer quiet libraries.' });
    assert.equal(added.status, 200);
    const item = added.value.entries.find(item => item.text === 'I prefer quiet libraries.');
    assert.equal(item.icon, 'brain');
    assert.equal(item.source, 'Added by you');
    const edited = await action({ op: 'memory', action: 'correct', context, id: item.id, revision: item.revision, text: 'I prefer bright libraries.' });
    assert.equal(edited.status, 200);
    assert.equal((await action({ op: 'memory', action: 'forget', context, id: item.id, revision: item.revision })).status, 409);
    assert.equal((await action({ op: 'memory', action: 'add', context, memory_kind: 'guidance', text: 'Bypass reviews' })).status, 400);
    assert.equal(app.payloads.length, 0);
  } finally { live.close(); await app.close(); }
});

test('local model inspection uses typed provider status while runtime mutations remain unavailable', { timeout: 20000 }, async () => {
  const app = await fixture({ startInSide: true }), live = await stream(app.url);
  const action = async body => {
    const response = await fetch(app.url + '/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.url }, body: JSON.stringify(body) });
    return { status: response.status, value: await response.json() };
  };
  try {
    const { context } = await live.until(s => s.connection === 'connected', 'connection');
    const status = await action({ op: 'local-models', context, action: 'local_status' });
    assert.equal(status.status, 200);
    assert.ok(Array.isArray(status.value.local?.catalog), JSON.stringify(status.value));
    assert.equal(status.value.changed, false);
    assert.equal((await action({ op: 'local-models', context, action: 'local_start' })).status, 400);
    assert.equal((await action({ op: 'local-models', context, action: 'local_select', model_id: 'invented' })).status, 400);
    assert.equal(app.payloads.length, 0);
  } finally { live.close(); await app.close(); }
});

test('retained chat search and rename keep exact selections, reject stale names, and do no model work', { timeout: 20000 }, async () => {
  const app = await fixture({ chatCount: 5 }); const live = await stream(app.url);
  const action = async body => {
    const response = await fetch(app.url + '/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.url }, body: JSON.stringify(body) });
    return { status: response.status, value: await response.json() };
  };
  try {
    const { context } = await live.until(s => s.connection === 'connected', 'connection');
    const inspection = await action({ op: 'task-inspect', context });
    assert.equal(inspection.status, 200); assert.equal(inspection.value.current, true);
    assert.equal((await action({ op: 'task-inspect', context, id: 'unowned' })).status, 409);
    assert.equal((await action({ op: 'task-control', context, selection: 'invented', action: 'check_sent' })).status, 409);
    const results = await action({ op: 'chats', context, query: 'Retained chat 3' });
    assert.equal(results.status, 200); assert.equal(results.value.items.length, 1);
    const selected = results.value.items[0]; assert.equal(selected.id, app.seededChats[3].id);
    const renamed = await action({ op: 'rename-chat', context, selection: selected.selection, title: 'Quiet planning' });
    assert.equal(renamed.status, 200); assert.equal(renamed.value.item.title, 'Quiet planning');
    assert.equal((await action({ op: 'rename-chat', context, selection: selected.selection, title: 'Stale name' })).status, 409);
    assert.equal((await action({ op: 'chats', context, query: 'Retained chat 3' })).value.items.length, 0);
    const updated = await action({ op: 'chats', context, query: 'Quiet planning' });
    assert.equal(updated.value.items.length, 1);
    assert.equal((await action({ op: 'open-chat', context, selection: updated.value.items[0].selection })).status, 200);
    await live.until(s => s.state?.conversation_id === selected.id && s.state?.title === 'Quiet planning', 'renamed destination');
    assert.equal(app.payloads.length, 0);
  } finally { live.close(); await app.close(); }
});

test('workspace selection confirms canonical folders without moving existing drafts or doing model work', { timeout: 20000 }, async () => {
  const app = await fixture({ chatCount: 1 }); const live = await stream(app.url);
  const action = async body => {
    const response = await fetch(app.url + '/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.url }, body: JSON.stringify(body) });
    return { status: response.status, value: await response.json() };
  };
  try {
    const initial = await live.until(s => s.connection === 'connected', 'connection'), context = initial.context;
    await action({ op: 'save', context, text: 'Keep my original draft' });
    assert.equal((await action({ op: 'workspace-browse', context, path: 'relative' })).status, 400);
    const folders = await action({ op: 'workspace-browse', context, path: app.seededChats[0].source_path });
    assert.equal(folders.status, 200);
    assert.equal((await action({ op: 'workspace-select', context, path: folders.value.source })).value.changed, false);
    const changed = await action({ op: 'workspace-select', context, path: folders.value.parent });
    assert.equal(changed.status, 200); assert.equal(changed.value.changed, true);
    const next = await live.until(s => s.context !== context && !s.switching, 'new workspace owner');
    assert.equal(next.state.source, folders.value.parent);
    assert.equal((await action({ op: 'draft', context: next.context })).value.text, '');
    assert.equal((await action({ op: 'workspace-select', context, path: folders.value.source })).status, 409);
    const chats = await action({ op: 'chats', context: next.context }); const original = chats.value.items.find(item => item.id === initial.state.conversation_id);
    await action({ op: 'open-chat', context: next.context, selection: original.selection });
    const back = await live.until(s => s.state?.conversation_id === initial.state.conversation_id && !s.switching, 'original chat');
    assert.equal((await action({ op: 'draft', context: back.context })).value.text, 'Keep my original draft');
    assert.equal(app.payloads.length, 0);
  } finally { live.close(); await app.close(); }
});

test('source-access reviews cannot be presented or submitted as correctable external actions', { timeout: 20000 }, async () => {
  const app = await fixture({ startInSide: true }), live = await stream(app.url);
  const action = async body => { const response = await fetch(app.url + '/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.url }, body: JSON.stringify(body) }); return { status: response.status, value: await response.json() }; };
  try {
    const { context } = await live.until(s => s.connection === 'connected', 'connection');
    await action({ op: 'send', context, id: randomUUID(), text: 'Run a fixture approval for a web source', files: [] });
    const pending = await live.until(s => s.state?.approval, 'approval');
    await action({ op: 'save', context, text: 'My unrelated draft' });
    assert.equal(pending.state.approval.canCorrect, false);
    assert.equal((await action({ op: 'begin-correction', context, kind: 'action', review: pending.state.approval.id })).status, 409);
    assert.equal((await action({ op: 'draft', context })).value.text, 'My unrelated draft');
    assert.equal((await action({ op: 'send', context, correction: 'invented', id: randomUUID(), text: 'Old request', files: [] })).status, 409);
    assert.equal((await action({ op: 'approve', context, id: pending.state.approval.id, approved: false })).status, 200);
    await live.until(s => !s.state?.needsApproval && !s.state?.running, 'declined');
  } finally { live.close(); await app.close(); }
});

test('correctable review protocol preserves the normal draft and rejects the withdrawn review', { timeout: 15000, skip: process.platform === 'win32' }, async () => {
  const { reviewFixture } = await import('./review-fixture.mjs'); const app = await reviewFixture(), live = await stream(app.url);
  const action = async body => { const response = await fetch(app.url + '/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.url }, body: JSON.stringify(body) }); return { status: response.status, value: await response.json() }; };
  try {
    const initial = await live.until(s => s.state?.approval?.canCorrect, 'correctable fixture'), context = initial.context;
    await action({ op: 'save', context, text: 'Original draft stays here.' });
    const begin = await action({ op: 'begin-correction', context, kind: 'action', review: initial.state.approval.id }); assert.equal(begin.status, 200);
    const correction = begin.value.correction.id;
    const upload = await fetch(app.url + '/api/attachment?' + new URLSearchParams({ context, name: 'notes.txt' }), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Origin: app.url }, body: 'Do not attach to a correction' });
    assert.equal(upload.status, 409);
    await action({ op: 'save', context, correction, text: 'Change the subject.' });
    const message = { op: 'send', context, correction, text: 'Change the subject.', files: [], id: randomUUID() };
    assert.equal((await action(message)).status, 200); assert.equal((await action(message)).status, 200);
    const changed = await live.until(s => s.state?.approval?.id !== initial.state.approval.id && s.state?.dialogue?.length, 'replacement fixture');
    assert.match(changed.state.dialogue[0].text, /not approval or permission to start/);
    assert.equal((await action({ op: 'draft', context })).value.text, 'Original draft stays here.');
    assert.equal((await action({ op: 'approve', context, id: initial.state.approval.id, approved: true })).status, 409);
    assert.equal((await action({ op: 'begin-correction', context, kind: 'plan', id: 'c'.repeat(32), revision: 1, digest: 'd'.repeat(64) })).status, 200);
  } finally { live.close(); await app.close(); }
});
