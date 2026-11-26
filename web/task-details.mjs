import { createHash, randomUUID } from 'node:crypto';
import { taskSummaries } from './task-summaries.mjs';

const fingerprint = value => createHash('sha256').update(JSON.stringify(value) ?? 'null').digest('hex');
const statuses = { idle: 'No active work', running: 'In progress', waiting: 'Needs you', queued: 'Queued', stopping: 'Stopping', unknown: 'Outcome uncertain', unconfirmed: 'Outcome uncertain', interrupted: 'Interrupted · not resumed', failed: 'Failed', stopped: 'Stopped', cancelled: 'Stopped', review: 'Needs review', pending_approval: 'Needs review', completed: 'Completed', success: 'Completed', executed: 'Provider accepted · delivery not established', pending: 'Pending · execution not confirmed' };
const status = value => statuses[value] || value || 'State unavailable';
const fields = (value, names) => names.filter(name => value?.[name] !== undefined && value[name] !== '' && value[name] !== null).map(name => ({ name, value: typeof value[name] === 'string' ? value[name] : JSON.stringify(value[name]) }));
const error = message => { const e = new Error(message); e.status = 409; return e; };

export function taskDetails(host) {
  const selections = new Map();
  function ownerFor(id) {
    return [...host.sessions.workers].find(owner => owner.state?.conversation_id === id && (owner === host.backend || host.sessions.canOpen(id)));
  }
  function bind(owner, kind, value, frame) {
    const selection = randomUUID();
    selections.set(selection, { owner, context: host.context, kind, signature: fingerprint(value), frame });
    while (selections.size > 512) selections.delete(selections.keys().next().value);
    return selection;
  }
  function bundles(state) { return [...(state.messages || []).map(message => message.bundle), state.work_details?.latest_bundle].filter(Boolean); }
  function inspect(id) {
    const owner = ownerFor(id); if (!owner) throw error('This task owner is unavailable. No replacement was started.');
    const state = owner.state, current = owner === host.backend;
    const summary = taskSummaries(host).find(task => task.id === id);
    const result = { id, current, connected: !owner.closed, title: state.title || 'Your request', state: owner.closed ? 'Disconnected · retained snapshot' : status(summary?.state || state.dialogue_task?.state || 'idle'),
      summary: summary?.summary || state.dialogue_task?.summary || '',
      identity: fields({ conversation: id, requesting_chat: state.dialogue_task?.parent_id, original_turn: state.dialogue_task?.turn_id, connection: owner.closed ? 'Disconnected' : 'Connected' }, ['conversation', 'requesting_chat', 'original_turn', 'connection']),
      history:(state.messages||[]).filter(message=>message.text && message.result?.kind!=="approval").slice(-24).map(message=>({role:message.role,text:String(message.text).slice(0,4096),run:message.run_id||message.bundle?.RunID})),
      activity: summary ? { state: summary.state, active: summary.active, started_at: summary.started_at, finished_at: summary.finished_at, entries: summary.steps, truncated: summary.truncated } : undefined,
      artifacts:bundles(state).flatMap(bundle=>(bundle.Artifacts||[]).filter(file=>file.Valid).map(file=>({name:file.Path,run:bundle.RunID}))).slice(-32),
      canReply: !owner.closed && !!state.dialogue_task?.parent_id && state.dialogue_task.parent_id === host.backend.state?.primary_conversation_id,
      records: [], receipts: [], notices: [], plans: (state.task_plans || []).map(plan => ({ id: plan.id, task: plan.task, phase: plan.phase, issue: plan.issue })),
      controls: { guide: !!state.dialogue_task?.can_guide, stop: !!state.dialogue_task?.can_stop, correct: !!state.dialogue_task?.can_correct_action, revise: !!state.dialogue_task?.can_revise_plan },
    };
    for (const value of state.request_recoveries || []) {
      const recovery = value.recovery || {};
      const selection = current && !owner.closed ? bind(owner, 'request', value, { conversation_id: id, task_id: value.task_id, token: value.token }) : undefined;
      result.records.push({ id: 'request:' + value.task_id, title: value.text || 'Interrupted request', state: status(value.state), detail: recovery.summary || 'Inspect the original outcome before preparing more work.', repair: recovery.repair,
        needs: recovery.needs || [], retrySafe: recovery.retry_safe === true, selection,
        fields: [...fields(value, ['task_id', 'provider', 'model', 'state', 'plan_phase']), ...fields(recovery, ['kind', 'scope_digest', 'processing_digest', 'preparation'])] });
    }
    for (const item of state.queue || []) result.records.push({ id: 'queue:' + item.id, title: item.text, state: item.interrupted ? 'Interrupted · not resumed' : 'Queued · not executing', detail: 'Inspecting does not run or resume this message.', fields: fields(item, ['id', 'inputs']) });
    for (const plan of state.task_plans || []) if (['interrupted', 'failed', 'stopped', 'cancelled'].includes(plan.state) || plan.phase === 'interrupted') result.records.push({ id: 'plan:' + plan.id, title: plan.task, state: status(plan.phase === 'interrupted' ? 'interrupted' : plan.state), detail: 'Proposed steps are not evidence of completed work.', fields: fields(plan, ['id', 'work_id', 'phase', 'revision', 'digest', 'issue', 'outcome']) });
    for (const [index, message] of (state.messages || []).entries()) if (['interrupted', 'failed', 'stopped', 'review'].includes(message.activity?.state)) result.records.push({ id: 'message:' + index, title: 'Retained work activity', state: status(message.activity.state), detail: 'Retained text may be partial.', fields: [...fields(message, ['run_id', 'revision_id', 'text']), ...fields(message.activity, ['state', 'started_at', 'finished_at', 'error'])] });
    const seen = new Set(), all = bundles(state);
    for (const bundle of all) {
      const key = bundle.RunID + ':' + bundle.ManifestSHA256;
      if (!bundle.RunID || seen.has(key)) continue; seen.add(key);
      const consistent = all.filter(item => item.RunID === bundle.RunID && item.ManifestSHA256 === bundle.ManifestSHA256).every(item => fingerprint(item.Actions) === fingerprint(bundle.Actions));
      if (!consistent) result.notices.push('Conflicting receipt snapshots. Exact checks are unavailable; refresh the owning chat.');
      if (bundle.ActionsTruncated) result.notices.push('Some bundle receipts are omitted. Evidence is incomplete.');
      for (const receipt of bundle.Actions || []) {
        const identity = { conversation_id: id, run_id: bundle.RunID, action_id: receipt.ID, correlation_id: receipt.CorrelationID, manifest_sha256: bundle.ManifestSHA256 };
        const unique = bundle.Actions.filter(item => item.ID === receipt.ID && item.CorrelationID === receipt.CorrelationID).length === 1;
        const valid = /^[a-zA-Z0-9_-]{1,96}$/.test(identity.run_id) && /^action-[a-f0-9]{16}$/.test(identity.action_id) && /^[a-f0-9]{32}$/.test(identity.correlation_id) && /^[a-f0-9]{64}$/.test(identity.manifest_sha256);
        const selection = current && !owner.closed && unique && consistent && valid && receipt.Status === 'unknown' && receipt.Operation === 'gmail_send' ? bind(owner, 'receipt', { identity, receipt }, identity) : undefined;
        result.receipts.push({ title: receipt.Operation || 'External action', state: status(receipt.Status), uncertain: ['unknown', 'pending'].includes(receipt.Status), selection,
          fields: [...fields(receipt, ['ConnectorID', 'Recipient', 'Subject', 'Status', 'ReceiptID', 'ProviderResourceID', 'Error', 'Steps']), ...fields(identity, ['run_id', 'action_id', 'correlation_id', 'manifest_sha256'])] });
      }
    }
    for (const entry of state.action_recoveries || []) result.receipts.push({ title: entry.receipt?.Operation || 'External action', state: status(entry.receipt?.Status), uncertain: ['unknown', 'pending'].includes(entry.receipt?.Status), live: !!entry.live, fields: [...fields(entry, ['id', 'run_id', 'at']), ...fields(entry.receipt, ['ConnectorID', 'Recipient', 'Subject', 'Status', 'ReceiptID', 'ProviderResourceID', 'Error', 'Steps'])] });
    if (state.action_recovery_truncated) result.notices.push('Older action evidence is outside the retained projection.');
    for (const key of ['action_recovery_issue', 'requests_issue', 'dialogue_issue']) if (state[key]) result.notices.push(state[key]);
    return result;
  }
  function fresh(chosen) {
    const state = chosen.owner.state;
    if (chosen.kind === 'request') return (state.request_recoveries || []).some(value => fingerprint(value) === chosen.signature);
    const identity = chosen.frame, all = bundles(state);
    const matching = all.filter(bundle => bundle.RunID === identity.run_id && bundle.ManifestSHA256 === identity.manifest_sha256);
    return matching.length > 0 && matching.every(bundle => fingerprint(bundle.Actions) === fingerprint(matching[0].Actions)) && matching.every(bundle => {
      const receipts = (bundle.Actions || []).filter(receipt => receipt.ID === identity.action_id && receipt.CorrelationID === identity.correlation_id);
      return receipts.length === 1 && fingerprint({ identity, receipt: receipts[0] }) === chosen.signature;
    });
  }
  async function control({ selection, action, connections }) {
    const chosen = selections.get(selection);
    if (!chosen || chosen.owner !== host.backend || chosen.context !== host.context || chosen.owner.closed || !fresh(chosen)) throw error('The task or receipt changed. Refresh its original owner before choosing an action.');
    if (chosen.kind === 'receipt' ? !['inspect', 'check_sent'].includes(action) : !['review_access', 'prepare_retry', 'prepare_access'].includes(action)) throw error('This recovery action is unavailable.');
    const access = action === 'review_access' || action === 'prepare_access';
    if (connections !== undefined && (!access || !Array.isArray(connections) || connections.length > 16 || connections.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{0,64}$/.test(id)))) throw error('Choose the configured accounts again.');
    if (action === 'prepare_access' && (!chosen.access?.ready || fingerprint(connections) !== fingerprint(chosen.connections))) throw error('Review the exact configured accounts before preparing.');
    const type = chosen.kind === 'receipt' ? 'receipt' : 'request_recovery';
    const frame = { type, [type]: { ...chosen.frame, action, request_id: randomUUID(), ...(access && connections !== undefined ? { connections } : {}), ...(action === 'prepare_access' ? { access_token: chosen.access.token } : {}) } };
    host.mutable(); host.sessions.assertSend(frame);
    // retire mutating selections before transport: a missing acknowledgement never authorizes replay.
    if (['check_sent', 'prepare_retry', 'prepare_access'].includes(action)) selections.delete(selection);
    const result = await chosen.owner.recovery(frame);
    if (chosen.owner !== host.backend) throw error('The conversation changed. Inspect the original task for its result.');
    if (result.error) throw error(result.error);
    if (action === 'review_access') {
      chosen.access = result.access_review; chosen.connections = result.access_review?.connections;
      const { token, ...review } = result.access_review || {}; return { access: review };
    }
    return chosen.kind === 'receipt' ? { check: result.check } : { accepted: result.accepted };
  }
  return { inspect, control };
}
