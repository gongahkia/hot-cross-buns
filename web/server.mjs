import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, isAbsolute } from 'node:path';
import { createServer } from "node:http";
import { attachmentPreview } from "./attachment-preview.mjs";
import { taskSummaries, delegatedSummaries } from "./task-summaries.mjs";
import { taskDetails } from './task-details.mjs';
import { correctionDrafts } from './corrections.mjs';
import { buildBrowserDependencies } from "./build.mjs";
import { Application } from "../app-host/src/application.mjs";
import { attachmentLimit, uploadLimits } from "../app-host/src/attachment-limits.mjs";

import brandCatalog from "../internal/branding/catalog.json" with { type: "json" };

const assets = new Map([
  ["/brands.mjs", ["brands.mjs", "text/javascript; charset=utf-8"]],
  ...brandCatalog.map(brand => ["/brands/" + brand.file, ["brands/" + brand.file, "image/png"]]),
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
  ["/client.mjs", ["client.mjs", "text/javascript; charset=utf-8"]],
  ["/chats.mjs", ["chats.mjs", "text/javascript; charset=utf-8"]],
  ["/find.mjs", ["find.mjs", "text/javascript; charset=utf-8"]],
  ["/usage.mjs", ["usage.mjs", "text/javascript; charset=utf-8"]],
  ["/reading.mjs", ["reading.mjs", "text/javascript; charset=utf-8"]],
  ["/reactions.mjs", ["reactions.mjs", "text/javascript; charset=utf-8"]],
  ["/task-details.mjs", ["task-details.mjs", "text/javascript; charset=utf-8"]],
  ["/workspace.mjs", ["workspace.mjs", "text/javascript; charset=utf-8"]],
  ["/streaming.mjs", ["streaming.mjs", "text/javascript; charset=utf-8"]],
  ["/reviews.mjs", ["reviews.mjs", "text/javascript; charset=utf-8"]],
  ["/views.mjs", ["views.mjs", "text/javascript; charset=utf-8"]],
  ["/local-models.mjs", ["local-models.mjs", "text/javascript; charset=utf-8"]],
  ["/fields.mjs", ["fields.mjs", "text/javascript; charset=utf-8"]],
  ["/text.mjs", ["text.mjs", "text/javascript; charset=utf-8"]],
  ["/boot.mjs", ["boot.mjs", "text/javascript; charset=utf-8"]],
  ["/memory.mjs", ["memory.mjs", "text/javascript; charset=utf-8"]],
  ["/icons.mjs", ["icons.mjs", "text/javascript; charset=utf-8"]],
  ["/attachments.mjs", ["attachments.mjs", "text/javascript; charset=utf-8"]],
  ["/caret.mjs", ["caret.mjs", "text/javascript; charset=utf-8"]],
  ["/activity.mjs", ["activity.mjs", "text/javascript; charset=utf-8"]],
  ["/task-inspector.mjs", ["task-inspector.mjs", "text/javascript; charset=utf-8"]],
  ["/surface-motion.mjs", ["surface-motion.mjs", "text/javascript; charset=utf-8"]],
  ["/scheduled.mjs", ["scheduled.mjs", "text/javascript; charset=utf-8"]],
  ["/palette.mjs", ["palette.mjs", "text/javascript; charset=utf-8"]],
]);
const headers = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; frame-src 'self' about:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
const routes = new Set(["/chat", "/new", "/conversations", "/settings", "/connections", "/knowledge", "/followup", "/goals", "/inbox", "/usage", "/recovery", "/memory", "/learnings", "/model", "/data", "/search"]);
const frames = new Set(["conversation", "composer", "panel", "task_plan", "sources", "dialogue_page", "queue"]);
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function json(res, status, value) {
  res.writeHead(status, { ...headers, "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

async function readBody(req, limit) {
  if (Number(req.headers["content-length"]) > limit) throw new RequestError(413, "The request is too large.");
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > limit) throw new RequestError(413, "The request is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function reviewFor(state, context) {
  const action = state?.pending_approval;
  const message = state?.messages?.[action?.message_index];
  // Go binds this message index to its pending interaction. Some typed reviews
  // replace the generic request-ID field with their own fields.
  if (!action?.token || message?.result?.kind !== "approval") return null;
  return { id: digest([context, action, message]), result: message.result, canCorrect: state.can_correct_action === true };
}

function projection(host, corrections) {
  const snapshot = host.snapshot();
  const state = snapshot.state;
  return {
    context: host.context, connection: snapshot.connection, switching: snapshot.sessionSwitching,
    correction: corrections?.overlay({})?.correction,
    issue: snapshot.error || snapshot.sessionIssue || state?.requests_issue || state?.notice,
    activity: snapshot.chatActivity,
    tasks: taskSummaries(host),
    helpers: delegatedSummaries(host),
    scheduled: { entries: state?.checks || [], running: !!state?.supervisor_running, issue: state?.checks_issue },
    state: state && {
      conversation_id: state.conversation_id, title: state.title, recent: state.recent_conversations,
      source: state.source,
      recentId: state.recent_id, recentIssue: state.recent_issue, provider: state.provider, model: state.model,
      messages: state.messages, dialogue: state.dialogue, peers: state.dialogue_peers,
      dialogueMore: state.dialogue_more, dialogueActive: state.dialogue_active,
      running: state.running, cancelling: state.cancelling, working: state.dialogue_busy || state.pending_operation,
      status: state.status, queue: state.queue, panel: state.panel, composer: state.composer,
      activity: state.activity, approval: reviewFor(state, host.context), needsApproval: !!state.pending_approval,
      external: state.external?.kind, plans: state.task_plans?.map(plan => ({ ...plan, canRevise: !!state.can_revise_plans?.includes(plan.id) })), recoveries: state.request_recoveries?.length,
      updates: state.chat_updates, uploadResult: state.upload_result, latestBundle: state.work_details?.latest_bundle,
    },
  };
}

export async function startWeb(options, port = 4317) {
  await buildBrowserDependencies();
  const host = new Application(options);
  const inspection = taskDetails(host);
  const corrections = correctionDrafts(host, reviewFor);
  const streams = new Set();
  let tail = Promise.resolve(), closing = false;
  const admissions = new Map();
  const chatSelections = new Map();
  const serialized = operation => {
    const result = tail.then(operation);
    tail = result.catch(() => {});
    return result;
  };
  function requireContext(context) {
    if (!context || context !== host.context || host.sessions.switching) {
      throw new RequestError(409, "The conversation changed. Return to it before trying again.");
    }
  }
  async function draft() {
    const context = host.context;
    const { drafts } = await host.drafts.request({ action: "list" });
    const saved = drafts.find(item => item.context === context);
    const { title = "", source = "" } = host.backend.state;
    return corrections.overlay({ context, title, source, text: saved?.text ?? "", uploads: saved?.uploads ?? [], ...(saved?.plan_first ? { plan_first: true } : {}), ...(saved?.reply_to_update_id ? { reply_to_update_id: saved.reply_to_update_id } : {}) });
  }
  async function saveDraft(value) {
    await host.drafts.request({ action: "save", draft: value });
    return value;
  }
  async function providers(body) {
    host.mutable();
    const owner = host.backend;
    const action = { action: body.action, request_id: randomUUID() };
    if (["review", "save"].includes(body.action)) {
      if (typeof body.provider !== "string" || !/^[a-z0-9-]{1,128}$/.test(body.provider)) throw new RequestError(400, "Choose a provider.");
      action.provider = body.provider;
      if (body.action === "review") {
        const fields = body.input;
        if (!fields || typeof fields.model !== "string" || fields.model.length > 512 ||
          !["default", "retain", "override"].includes(fields.endpoint_mode) ||
          typeof fields.endpoint !== "string" || fields.endpoint.length > 2048 ||
          typeof fields.api_version !== "string" || fields.api_version.length > 128 ||
          !fields.options || typeof fields.options !== "object" || Array.isArray(fields.options) ||
          Object.values(fields.options).some(value => typeof value !== "string" || value.length > 512)) {
          throw new RequestError(400, "Check the provider settings.");
        }
        action.input = { model: fields.model, endpoint_mode: fields.endpoint_mode, endpoint: fields.endpoint, api_version: fields.api_version, options: fields.options };
        action.replace_key = body.replaceKey === true;
      } else {
        if (typeof body.reviewId !== "string" || !/^[a-f0-9]{48}$/.test(body.reviewId) ||
          typeof body.key !== "string" || body.key.length > 8192) throw new RequestError(400, "Open the exact provider review before saving.");
        action.review_id = body.reviewId;
        action.api_key = body.key;
      }
    } else if (body.action !== "status") throw new RequestError(400, "This provider action is unavailable.");
    const result = await owner.nativeProvider(action);
    if (owner !== host.backend) throw new RequestError(409, "The conversation changed. Review the current provider settings.");
    if (result.error) throw new RequestError(409, result.error);
    return { rows: result.rows, review: result.review, confirmed: result.confirmed };
  }
  async function action(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new RequestError(400, "Choose a browser action.");
    const { context, op } = body;
    if (op === "send") {
      if (typeof body.id !== "string" || !/^[a-f0-9-]{36}$/.test(body.id) || typeof body.text !== "string" || Buffer.byteLength(body.text) > 128 * 1024 || !Array.isArray(body.files)) throw new RequestError(400, "Invalid message.");
      const signature = digest([context, body.text, body.files, !!body.queueOnly, body.correction || '']);
      const accepted = admissions.get(body.id);
      if (accepted) {
        if (accepted !== signature) throw new RequestError(409, "This message identity has already been used.");
        return {};
      }
      requireContext(context);
      const saved = await draft();
      if ((saved.correction?.id || '') !== (body.correction || '')) throw new RequestError(409, 'The selected correction draft changed. Review the composer before sending.');
      const files = saved.uploads.map(file => file.id);
      if (JSON.stringify(files) !== JSON.stringify(body.files)) throw new RequestError(409, "The attachments changed. Review the draft before sending.");
      let text = body.text;
      if (saved.correction) {
        if (body.queueOnly || body.files.length) throw new RequestError(409, 'A correction is a text request for this exact proposal.');
        text = corrections.prepare(body.correction, body.text);
        if (Buffer.byteLength(text) > 128 * 1024) throw new RequestError(400, 'Shorten the correction before sending.');
        corrections.edit(body.correction, body.text);
      } else await saveDraft({ ...saved, text: body.text });
      await host.send({ type: "upload_submit", upload: {
        request_id: body.id, context, text, files,
        ...(body.queueOnly === true ? { queue_only: true } : {}),
        ...(!saved.correction && saved.plan_first ? { plan_first: true } : {}),
        ...(!saved.correction && saved.reply_to_update_id ? { reply_to_update_id: saved.reply_to_update_id } : {}),
      } });
      admissions.set(body.id, signature);
      if (saved.correction) { corrections.complete(body.correction); broadcast(); return {}; }
      if (admissions.size > 64) admissions.delete(admissions.keys().next().value);
      // Work was admitted even if draft cleanup fails. Keep the receipt.
      try { await host.drafts.request({ action: "remove", context }); }
      catch (error) { console.error("Could not clear an admitted draft:", error.message); }
      return {};
    }
    if (op === "reconnect") {
      if (!host.backend?.closed) throw new RequestError(409, "The host is already connected.");
      await host.sessions.restart();
      return {};
    }
    requireContext(context);
    switch (op) {
      case 'begin-correction':
        await corrections.begin(body, context); broadcast(); return draft();
      case 'cancel-correction':
        corrections.cancel(body.correction); broadcast(); return draft();
      case 'workspace-browse':
      case 'workspace-select': {
        host.mutable();
        if (typeof body.path !== 'string' || !isAbsolute(body.path) || Buffer.byteLength(body.path) > 8192 || /[\x00-\x1f\x7f]/.test(body.path)) throw new RequestError(400, 'Choose an absolute folder path.');
        const owner = host.backend;
        const result = await owner.workspace({ request_id: randomUUID(), path: body.path });
        requireContext(context);
        if (owner !== host.backend || result.conversation_id !== owner.state.conversation_id) throw new RequestError(409, 'The workspace owner changed. Choose the folder again.');
        if (result.error || !isAbsolute(result.source || '')) throw new RequestError(409, result.error || 'The folder could not be verified.');
        if (op === 'workspace-select') {
          if (result.new) await host.sessions.open({ new: true, source: result.source });
          return { source: result.source, changed: result.new };
        }
        const entries = (await readdir(result.source, { withFileTypes: true })).filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name));
        return { source: result.source, parent: dirname(result.source), folders: entries.slice(0, 200).map(entry => ({ name: entry.name, path: join(result.source, entry.name) })), truncated: entries.length > 200 };
      }
      case 'task-inspect':
        return inspection.inspect(body.id || host.backend.state.conversation_id);
      case 'task-control':
        return inspection.control(body);
      case 'chats': {
        host.mutable();
        const owner = host.backend;
        if (typeof (body.after ?? '') !== 'string' || (body.after || '').length > 1024 || typeof (body.query ?? '') !== 'string' || Buffer.byteLength(body.query || '') > 512) throw new RequestError(400, 'Check the chat search.');
        const query = body.query || '';
        const result = await owner.catalog({ request_id: randomUUID(), action: 'query', scope: 'all', text: query, after: body.after || '' });
        requireContext(context);
        if (owner !== host.backend) throw new RequestError(409, 'The chat changed. Reopen the list.');
        if (result.error) throw new RequestError(409, result.error);
        const items = (result.page?.items || []).map(item => {
          const selection = randomUUID();
          chatSelections.set(selection, { owner, context, id: item.id, version: item.version, query, after: body.after || '' });
          return { id: item.id, title: item.title, snippet: item.snippet, match: item.match, pinned: item.pinned, archived: item.archived, updated_at: item.updated_at, selection };
        });
        while (chatSelections.size > 10000) chatSelections.delete(chatSelections.keys().next().value);
        return { items, next: result.page?.next || '', incomplete: !!result.page?.incomplete, skipped: result.page?.skipped || 0 };
      }
      case 'open-chat':
      case 'rename-chat': {
        host.mutable();
        const chosen = chatSelections.get(body.selection);
        if (!chosen || chosen.owner !== host.backend || chosen.context !== context) throw new RequestError(409, 'Refresh the chat list and choose this chat again.');
        if (op === 'rename-chat' && (typeof body.title !== 'string' || !body.title.trim() || Buffer.byteLength(body.title) > 256)) throw new RequestError(400, 'Enter a chat title of up to 256 bytes.');
        const result = await chosen.owner.catalog({ request_id: randomUUID(), action: 'query', scope: 'all', text: chosen.query, after: chosen.after });
        requireContext(context);
        if (result.error) throw new RequestError(409, result.error);
        if (!result.page?.items.some(item => item.id === chosen.id && item.version === chosen.version)) throw new RequestError(409, 'This chat changed. Refresh the list.');
        const verified = await chosen.owner.catalog({ request_id: randomUUID(), action: op === 'rename-chat' ? 'rename' : 'open', page_id: result.page_id, id: chosen.id, version: chosen.version, ...(op === 'rename-chat' ? { title: body.title } : {}) });
        requireContext(context);
        if (verified.error || verified.item?.id !== chosen.id) throw new RequestError(409, verified.error || 'The chat selection could not be confirmed.');
        if (op === 'rename-chat') {
          chatSelections.delete(body.selection);
          return { item: { id: verified.item.id, title: verified.item.title } };
        }
        await host.sessions.open({ conversation_id: chosen.id, catalog_version: chosen.version });
        return {};
      }
      case "draft":
        return draft();
      case "scheduled": {
        host.mutable();
        if (!['refresh', 'inspect', 'edit', 'pause', 'resume'].includes(body.action) ||
            body.action !== 'refresh' && (typeof body.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(body.id) || typeof body.digest !== 'string' || !/^[a-f0-9]{64}$/.test(body.digest))) throw new RequestError(400, 'Refresh scheduled tasks before choosing an action.');
        const owner = host.backend;
        if (body.action === 'refresh' && (owner.state.running || owner.state.dialogue_busy || owner.state.pending_operation)) {
          return { entries: owner.state.checks || [], running: !!owner.state.supervisor_running, issue: owner.state.checks_issue };
        }
        const result = await owner.check({ request_id: randomUUID(), action: body.action,
          ...(body.action === 'refresh' ? {} : { id: body.id, digest: body.digest }),
        });
        requireContext(context);
        if (owner !== host.backend) throw new RequestError(409, 'The conversation changed. Reopen scheduled tasks.');
        if (result.error) throw new RequestError(409, result.error);
        return { entries: owner.state.checks || [], running: !!owner.state.supervisor_running, issue: owner.state.checks_issue };
      }
      case "providers":
        return providers(body);
      case 'local-models': {
        host.mutable();
        const fields = {
          local_review_select: ['model_id'], local_select: ['model_id', 'review_id', 'generation'], local_cancel_review: ['review_id', 'generation'], local_reconcile: ['operation_id'], local_status: [],
          runtime_status: [], runtime_review_start: [], runtime_review_stop: [], runtime_review_download: ['model_id'],
          runtime_start: ['review_id', 'generation'], runtime_stop: ['review_id', 'generation'], runtime_download: ['model_id', 'review_id', 'generation'],
          runtime_cancel_review: ['review_id', 'generation'], runtime_cancel_download: ['review_id', 'generation'],
        }[body.action];
        if (!Array.isArray(fields)) throw new RequestError(400, 'This local model action is unavailable.');
        if (body.app_owned !== undefined && (typeof body.app_owned !== 'boolean' || !['local_status', 'local_review_select', 'local_select', 'local_cancel_review', 'local_reconcile'].includes(body.action))) throw new RequestError(400, 'Invalid local model source.');
        const action = { request_id: randomUUID(), action: body.action };
        for (const name of fields) {
          const valid = name === 'model_id' ? /^[a-zA-Z0-9_.-]{1,128}$/ : /^[a-zA-Z0-9_-]{1,128}$/;
          if (typeof body[name] !== 'string' || !valid.test(body[name])) throw new RequestError(400, 'Refresh local models and review this selection again.');
          action[name] = body[name];
        }
        if (body.app_owned !== undefined) action.app_owned = body.app_owned;
        const owner = host.backend, result = await owner.nativeProvider(action);
        requireContext(context);
        if (owner !== host.backend) throw new RequestError(409, 'The conversation changed. Reopen local models.');
        return result;
      }
      case "save":
      case "remove-file": {
        const saved = await draft();
        if (typeof body.text !== "string" || Buffer.byteLength(body.text) > 128 * 1024) throw new RequestError(400, "Invalid draft text.");
        if (saved.correction || body.correction) {
          if (op !== 'save' || saved.correction?.id !== body.correction) throw new RequestError(409, 'This correction draft changed.');
          corrections.edit(body.correction, body.text); return draft();
        }
        saved.text = body.text;
        if (op === "remove-file") saved.uploads = saved.uploads.filter(file => file.id !== body.id);
        return saveDraft(saved);
      }
      case "navigate":
        if (!routes.has(body.route)) throw new RequestError(400, "This page is unavailable.");
        await host.send({ type: "navigate", text: body.route });
        break;
      case "open-work":
        await host.openSession(body.id);
        break;
      case "stop":
        if (!host.backend.state?.running) throw new RequestError(409, "This chat is no longer running.");
        await host.send({ type: "submit", text: "/cancel" });
        break;
      case "approve": {
        const state = host.backend.state, review = reviewFor(state, context);
        if (!review || body.id !== review.id || typeof body.approved !== "boolean") {
          throw new RequestError(409, "The request changed. Open the latest review.");
        }
        await host.send({ type: "approval", interaction_id: state.pending_approval.id, approval_token: state.pending_approval.token, approved: body.approved });
        break;
      }
      case "frame":
        if (!frames.has(body.frame?.type)) throw new RequestError(400, "This action is unavailable in the browser.");
        await host.send(body.frame);
        for (const key of ["composer", "task_plan", "sources", "queue"]) {
          const result = host.backend.state?.[key + "_result"];
          if (result && result.request_id === body.frame[key]?.request_id) {
            if (result.error) throw new RequestError(409, result.error);
            return result;
          }
        }
        break;
      case "continue-setup":
        if (!["connector", "login"].includes(host.backend.state?.external?.kind)) throw new RequestError(409, "This setup step needs the terminal.");
        const handoff = await host.runExternal();
        if (handoff.error) throw new RequestError(409, handoff.error);
        return {};
      case "sources":
        return host.sourceCatalog({ context, run: body.run });
      case "source":
        return host.sourcePreview({ context, run: body.run, path: body.path });
      case "memory": {
        host.mutable();
        const owner = host.backend;
        if (!["list", "add", "correct", "forget"].includes(body.action) ||
            typeof (body.query ?? "") !== "string" || (body.query || "").length > 512 ||
            typeof (body.category ?? "") !== "string" ||
            !Number.isSafeInteger(body.page ?? 0) || (body.page ?? 0) < 0 ||
            typeof (body.id ?? "") !== "string" || typeof (body.revision ?? "") !== "string" ||
            typeof (body.text ?? "") !== "string" ||
            body.action === 'add' && !['fact', 'preference', 'note'].includes(body.memory_kind)) throw new RequestError(400, "Check the memory request.");
        const result = await owner.personalMemory({
          request_id: randomUUID(), action: body.action, query: body.query || "", category: body.category || "",
          page: body.page || 0, id: body.id || "", revision: body.revision || "", text: body.text || "",
          memory_kind: body.memory_kind || '',
        });
        requireContext(context);
        if (owner !== host.backend) throw new RequestError(409, "The conversation changed. Reopen Memory.");
        if (result.error) throw new RequestError(409, result.error);
        return result.catalog;
      }
      case "attachment-preview": {
        const request = { context, action: "open", ref: { kind: "upload", id: body.id } };
        const view = await host.file(request);
        if (view.kind !== "pdf") return attachmentPreview(view);
        const page = await host.pdf(request, body.page ?? 1, 900);
        requireContext(context);
        return { kind: "pdf", page: page.page, pages: page.pages, data: "data:image/png;base64," + Buffer.from(page.image).toString("base64") };
      }
      case "download":
        return host.file({ context, action: "export", ref: body.ref });
      default:
        throw new RequestError(400, "This action is unavailable.");
    }
    return {};
  }

  function broadcast() {
    if (!streams.size) return;
    const frame = "data: " + JSON.stringify(projection(host, corrections)) + "\n\n";
    for (const stream of streams) {
      // A slow client reconnects to the latest snapshot rather than building a queue.
      if (stream.writableLength > 1024 * 1024) stream.destroy();
      else stream.write(frame);
    }
  }
  host.on("change", broadcast);

  const server = createServer(async (req, res) => {
    try {
      const expected = "127.0.0.1:" + server.address().port;
      if (req.headers.host !== expected) throw new RequestError(421, "Open the local address printed by the server.");
      const origin = "http://" + expected;
      const url = new URL(req.url, origin);
      if (req.method === "GET" && url.pathname === "/artifact") {
        const runtime = await readFile(new URL("./artifact-runtime.js", import.meta.url), "utf8");
        res.writeHead(200, { ...headers, "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
        });
        return res.end('<!doctype html><meta charset="utf-8"><script>' + runtime + '</script>');
      }
      if (req.method === "GET" && /^\/vendor\/[a-zA-Z0-9-]+\.mjs$/.test(req.url)) {
        const data = await readFile(new URL("./.build/" + req.url.slice(8), import.meta.url));
        res.writeHead(200, { ...headers, "Content-Type": "text/javascript; charset=utf-8" });
        return res.end(data);
      }
      const asset = assets.get(url.pathname);
      if (req.method === "GET" && asset) {
        const [name, type] = asset;
        const data = await readFile(new URL("./public/" + name, import.meta.url));
        res.writeHead(200, { ...headers, "Content-Type": type });
        return res.end(data);
      }
      if (closing || url.origin !== origin || req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin" ||
          req.headers.origin && req.headers.origin !== origin ||
          req.method === "POST" && req.headers.origin !== origin) {
        throw new RequestError(403, "Use this app from its local browser page.");
      }
      if (req.method === "GET" && req.url === "/api/events") {
        if (streams.size >= 8) throw new RequestError(429, "Too many browser tabs are connected.");
        res.writeHead(200, { ...headers, "Content-Type": "text/event-stream", "Connection": "keep-alive" });
        res.write("data: " + JSON.stringify(projection(host, corrections)) + "\n\n");
        streams.add(res);
        res.on("close", () => streams.delete(res));
        return;
      }
      if (req.method === "POST" && req.url === "/api/action") {
        if (req.headers["content-type"] !== "application/json") throw new RequestError(415, "Use JSON for browser actions.");
        let body;
        try { body = JSON.parse(await readBody(req, 256 * 1024)); }
        catch (error) { if (error.status) throw error; throw new RequestError(400, "Invalid JSON."); }
        const result = await serialized(() => action(body));
        if (body.op === "download") {
          res.writeHead(200, { ...headers, "Content-Type": "application/octet-stream",
            "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(result.name).replaceAll("'", "%27") });
          return res.end(result.bytes);
        }
        return json(res, 200, result);
      }
      if (req.method === "POST" && url.pathname === "/api/attachment") {
        if (req.headers["content-type"] !== "application/octet-stream") throw new RequestError(415, "Choose a file from your device.");
        const context = url.searchParams.get("context"), name = url.searchParams.get("name") || "";
        requireContext(context);
        if (corrections.current()) throw new RequestError(409, 'Corrections use text only. Cancel the correction to attach files to your ordinary draft.');
        const bytes = await readBody(req, attachmentLimit(name));
        const result = await serialized(async () => {
          requireContext(context);
          const saved = await draft();
          if (saved.correction) throw new RequestError(409, 'The composer changed to a correction draft. No attachment was added.');
          if (saved.uploads.length >= uploadLimits.count || saved.uploads.reduce((total, file) => total + file.size, bytes.length) > uploadLimits.total) {
            throw new RequestError(413, "The draft holds up to 12 files and 16 MiB in total.");
          }
          const imported = await host.importFileBytes(name, bytes, context);
          return saveDraft({ ...saved, uploads: [...saved.uploads, imported] });
        });
        return json(res, 200, result);
      }
      throw new RequestError(404, "This page does not exist.");
    } catch (error) {
      if (res.destroyed) return;
      if (res.headersSent) { res.end(); return; }
      json(res, error.status || (error.code ? 503 : 400), { error: error.code ? "The local host could not complete this action." : error.message });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  try {
    await host.start();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
  } catch (error) {
    await host.close().catch(() => {});
    throw error;
  }
  return {
    url: "http://127.0.0.1:" + server.address().port,
    async close() {
      closing = true;
      host.off("change", broadcast);
      const finished = new Promise(resolve => server.close(resolve));
      for (const stream of streams) stream.end();
      await finished;
      await tail;
      await host.close();
    },
  };
}
