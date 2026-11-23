import { createHash, randomUUID } from 'node:crypto';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = message => { const error = new Error(message); error.status = 409; throw error; };

// Presentation drafts are separate from the normal draft and cannot authorize an action.
export function correctionDrafts(host, reviewFor) {
  const active = new WeakMap(), tickets = new Map();
  function target(owner, kind, planID) {
    const state = owner.state;
    if (kind === 'action') {
      if (!state.can_correct_action) return '';
      const action = state.pending_approval, result = state.messages?.[action?.message_index]?.result;
      return action?.token && result?.kind === 'approval' ? digest([state.conversation_id, action, result]) : '';
    }
    const plan = state.task_plans?.find(plan => plan.id === planID);
    if (!state.can_revise_plans?.includes(planID)) return '';
    return plan?.phase === 'review' ? digest([plan.id, plan.revision, plan.digest, plan.phase]) : '';
  }
  function fresh(value) {
    return !value.submitted && !value.owner.closed && !value.requester.closed && host.sessions.workers.has(value.owner) && host.sessions.workers.has(value.requester) && value.owner.state?.dialogue_active && target(value.owner, value.kind, value.plan?.id) === value.signature;
  }
  function current() { return active.get(host.backend); }
  async function begin(body, context) {
    host.mutable(); const owner = host.backend;
    if (!['action', 'plan'].includes(body.kind)) fail('Choose a reviewed action or plan.');
    let plan;
    if (body.kind === 'action') {
      if (reviewFor(owner.state, context)?.id !== body.review) fail('The action changed. Open its current review.');
    } else {
      plan = owner.state.task_plans?.find(plan => plan.id === body.id && plan.revision === body.revision && plan.digest === body.digest && plan.phase === 'review');
      if (!plan) fail('The plan changed. Inspect its current revision.');
    }
    const parent = owner.state.dialogue_task?.parent_id;
    const requester = parent ? [...host.sessions.workers].find(worker => !worker.closed && worker.state?.conversation_id === parent) : owner;
    if (!requester || active.has(requester)) fail('The requesting chat is unavailable or already has a correction draft.');
    const value = { id: randomUUID(), owner, requester, kind: body.kind, plan: plan && { id: plan.id, revision: plan.revision }, signature: target(owner, body.kind, plan?.id), text: '', submitted: false };
    if (!value.signature || !fresh(value)) fail('The original owner is not ready for a correction. Your normal draft is kept.');
    if (requester !== owner) await host.sessions.open({ conversation_id: requester.state.conversation_id });
    if (!fresh(value) || host.backend !== requester) fail('The proposal changed while opening its requesting chat. Nothing was submitted.');
    tickets.set(value.id, value); active.set(requester, value);
    while (tickets.size > 64) {
      const old = [...tickets].find(([, value]) => active.get(value.requester) !== value);
      if (!old) break;
      tickets.delete(old[0]);
    }
    return value.id;
  }
  function overlay(draft) {
    const value = current(); if (!value) return draft;
    return { ...draft, response_quote: undefined, text: value.text, uploads: [], correction: { id: value.id, kind: value.kind, owner: value.owner.state.conversation_id, label: value.kind === 'action' ? 'Request an action correction' : 'Request a plan revision', issue: fresh(value) ? '' : 'This proposal changed or disconnected. Your text is kept. Cancel this correction and inspect the current proposal.', noExecution: true } };
  }
  function edit(id, text) {
    const value = current(); if (!value || value.id !== id) fail('This correction draft is no longer selected.');
    value.text = text;
  }
  function cancel(id) {
    const value = current(); if (!value || value.id !== id) fail('This correction draft changed.');
    active.delete(host.backend);
  }
  function prepare(id, text) {
    const value = current();
    if (!value || value.id !== id || !fresh(value)) fail('The correction target changed. Inspect its current review before sending.');
    const subject = value.kind === 'action' ? 'the pending action' : `plan task ${value.plan.id} revision ${value.plan.revision}`;
    return `Regarding ${subject} in conversation ${value.owner.state.conversation_id}:\n${text}\nThis is a correction request for review, not approval or permission to start or send anything.`;
  }
  function complete(id) {
    const value = tickets.get(id); if (!value) return;
    value.submitted = true; if (active.get(value.requester) === value) active.delete(value.requester);
  }
  return { begin, overlay, edit, cancel, prepare, complete, current };
}
