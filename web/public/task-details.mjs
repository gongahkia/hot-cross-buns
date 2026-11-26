import { activityView } from './activity.mjs';
import { element, prose } from './text.mjs';
import { icon } from './icons.mjs';

function disclosure(title, values) {
  const details = element('details', undefined, 'task-evidence'); details.append(element('summary', title));
  const list = element('dl', undefined, 'view-facts');
  for (const field of values || []) list.append(element('dt', field.name.replaceAll('_', ' ')), element('dd', field.value));
  details.append(list); return details;
}
function button(label, glyph, run) {
  const node = element('button', undefined, 'quiet'); node.type = 'button'; node.append(icon(glyph), element('span', label)); node.addEventListener('click', run); return node;
}
export function taskDetailView({ request, id, openChat, reply, decorateFiles, reviewPlans, profileRecovery }) {
  const root = element('section', undefined, 'task-detail-view');
  const body = element('div'), tools = element('div', undefined, 'view-tools');
  const issue = element('p', '', 'hint'); issue.hidden = true; issue.setAttribute('role', 'status');
  let pending = false, generation = 0;
  const refresh = button('Refresh', 'refresh-cw', () => void load()); tools.append(refresh);
  root.append(tools, issue, body);
  if (profileRecovery) {
    const more = element('details', undefined, 'task-evidence');
    more.append(element('summary', 'More recovery options'), button('Setup & data recovery', 'settings', profileRecovery)); root.append(more);
  }
  async function action(selection, verb, connections, target) {
    if (pending) return;
    pending = true; issue.hidden = true;
    const buttons = [...root.querySelectorAll('button, select')].map(node => [node, node.disabled]); for (const [node] of buttons) node.disabled = true;
    try {
      const result = await request({ op: 'task-control', selection, action: verb, ...(connections !== undefined ? { connections } : {}) });
      if (result.access) return result.access;
      const text = result.accepted ? 'Preparing a recovery plan for fresh review. Nothing has been approved or repeated.' : ({ found: 'Matching Sent record found. Delivery or reading is not established.', ambiguous: 'Multiple possible matches. The outcome remains uncertain; do not resend.', unconfirmed: 'No matching outcome confirmed. This does not prove the action did not happen; do not resend.', not_checked: 'No saved check. No external lookup was made.' }[result.check?.status] || 'Check finished. Inspect retained evidence before choosing a next step.');
      target.replaceChildren(element('p', text, 'hint'));
      if (result.check?.provider_id) target.append(element('p', 'Matching record: ' + result.check.provider_id, 'hint'));
      if (result.check?.checked_at) target.append(element('p', 'Checked: ' + result.check.checked_at, 'hint'));
      if (result.accepted) target.append(button('Review prepared plan', 'list-checks', reviewPlans));
    } catch (error) {
      issue.textContent = error.message + (['check_sent', 'prepare_retry', 'prepare_access'].includes(verb) ? ' No action was replayed. Refresh and inspect the original task before proceeding.' : ''); issue.hidden = false;
      if (['check_sent', 'prepare_retry', 'prepare_access'].includes(verb)) target.replaceChildren(element('p', 'Refresh to inspect the confirmed state before another action.', 'hint'));
    } finally { pending = false; for (const [node, disabled] of buttons) node.disabled = disabled; }
  }
  function confirmation(target, selection, verb, connections, text, label) {
    const review = element('div', undefined, 'recovery-confirmation');
    review.append(element('p', text, 'hint'), button(label, 'check', () => { void action(selection, verb, connections, target); }), button('Cancel', 'close', () => review.remove()));
    target.querySelector('.recovery-confirmation')?.remove(); target.append(review);
  }
  function recoveryControls(record, container) {
    if (!record.selection) return;
    const controls = element('div', undefined, 'task-recovery-controls');
    let connections, ready = !record.needs?.length;
    const accessBody = element('div');
    const prepare = button('Prepare recovery plan', 'list-checks', () => confirmation(controls, record.selection, record.needs?.length ? 'prepare_access' : 'prepare_retry', connections,
      'Use the original model and remaining budget to prepare a revised plan for your review. This may consume model usage. It does not approve the plan, grant permissions, or repeat external actions.', 'Confirm preparation'));
    prepare.disabled = !ready || !record.retrySafe;
    async function reviewAccess() {
      const review = await action(record.selection, 'review_access', connections, accessBody); if (!review) return;
      ready = !!review.ready; connections = review.connections || (review.requirements || []).map(item => item.selected || '');
      accessBody.replaceChildren(element('p', review.summary || (ready ? 'Configured access is ready.' : 'Access needs repair.'), 'hint'));
      for (const [index, requirement] of (review.requirements || []).entries()) {
        const label = element('label', requirement.need?.operation || 'Configured account'), select = element('select'); select.setAttribute('aria-label', 'Configured account ' + (index + 1));
        if (!(requirement.choices || []).some(choice => choice.id === connections[index])) {
          const missing = element('option', connections[index] || 'Choose an account'); missing.value = connections[index]; missing.disabled = true; select.append(missing);
        }
        for (const choice of requirement.choices || []) { const option = element('option', choice.label + (choice.issue ? ' · ' + choice.issue : '')); option.value = choice.id; option.disabled = !!choice.issue; select.append(option); }
        select.value = connections[index]; label.append(select); accessBody.append(label);
        for (const choice of requirement.choices || []) accessBody.append(disclosure(choice.label, [{ name: 'destination', value: choice.destination || '' }, { name: 'operation', value: choice.operation || '' }, { name: 'permission', value: choice.permission || '' }, { name: 'issue', value: choice.issue || '' }]));
        select.addEventListener('change', () => { ready = false; prepare.disabled = true; connections[index] = select.value; void reviewAccess(); });
      }
      accessBody.append(element('p', 'Readiness reflects local configuration, not a provider connectivity test.', 'hint'));
      prepare.disabled = !ready || !record.retrySafe;
    }
    if (record.needs?.length) controls.append(button('Review configured account access', 'link', () => void reviewAccess()), accessBody);
    controls.append(prepare);
    if (!record.retrySafe) controls.append(element('p', 'The backend has not established safe recovery preparation for this request.', 'hint'));
    container.append(controls);
  }
  function render(value) {
    const nodes = [element('h3', value.title), element('p', value.state, 'hint')];
    if (!value.connected) nodes.push(element('p', 'The owner is disconnected. This retained snapshot may be out of date.', 'hint'));
    if (!value.current) nodes.push(button('Open task', 'chevron-right', () => openChat(value.id)));
    if (value.summary) { const summary = element('details'); summary.append(element('summary', 'Summary'), element('p', value.summary)); nodes.push(summary); }
    if(value.canReply && reply)nodes.push(button('Reply in HCB','reply',()=>reply(value.id)));
    if(value.history?.length){const history=element('details',undefined,'task-history');history.append(element('summary','Work history'));for(const message of value.history){const row=element('section');row.append(element('h3',message.role==='You'?'Your request':'Hot Cross Buns'),prose(message.text));decorateFiles?.(row,message.run);history.append(row)}nodes.push(history)}
    if(value.artifacts?.length){const files=element('section');files.append(element('h3','Files'));for(const file of value.artifacts){const row=element('p',file.name);decorateFiles?.(row,file.run);files.append(row)}nodes.push(files)}
    if (value.activity?.entries?.length) {
      const view = activityView('task-inspection:' + value.id, { remember: false, autoExpand: false });
      view.update({ ...value.activity, entries: value.activity.entries.map(step => ({ ...step, kind: step.tool ? 'tool' : 'status' })) }, { active: value.activity.active, waiting: value.activity.state === 'waiting', disconnected: !value.connected });
      nodes.push(view.element);
    }
    nodes.push(disclosure('Task identity & ownership', value.identity));
    for (const notice of value.notices || []) nodes.push(element('p', notice, 'hint'));
    for (const record of value.records || []) {
      const row = element('section', undefined, 'recovery-record'); row.append(element('h3', record.title), element('p', record.state, 'hint'), element('p', record.detail, 'hint'));
      if (record.repair) row.append(element('p', record.repair, 'hint'));
      row.append(disclosure('Retained evidence', record.fields)); recoveryControls(record, row); nodes.push(row);
    }
    for (const receipt of value.receipts || []) {
      const row = element('section', undefined, 'recovery-record'); row.append(element('h3', receipt.title), element('p', receipt.state, 'hint'));
      if (receipt.live) row.append(element('p', 'The backend reports this attempt as live. A lost connection does not establish failure.', 'hint'));
      if (receipt.uncertain) row.append(element('p', 'The external outcome is uncertain. Inspect the evidence before taking another step. No resend is available here.', 'hint'));
      row.append(disclosure('Exact receipt evidence', receipt.fields));
      if (receipt.selection) {
        const controls = element('div', undefined, 'task-recovery-controls');
        controls.append(button('Inspect saved check', 'history', () => void action(receipt.selection, 'inspect', undefined, controls)), button('Check Sent · read-only', 'mail', () => confirmation(controls, receipt.selection, 'check_sent', undefined, 'Query Sent for this exact unconfirmed Gmail send. This never sends or resends a message.', 'Check Sent')));
        row.append(controls);
      } else row.append(element('p', 'This evidence has no eligible exact identity for an external check.', 'hint'));
      nodes.push(row);
    }
    if (value.plans?.length) nodes.push(button('Review task plan', 'list-checks', reviewPlans));
    const capabilities = Object.entries(value.controls || {}).filter(([, allowed]) => allowed).map(([name]) => name);
    if (capabilities.length) nodes.push(element('p', 'Available in this task: ' + capabilities.join(', ') + '.', 'hint'));
    if (!value.history?.length && !value.activity?.entries?.length && !value.records?.length && !value.receipts?.length) nodes.push(element('p', 'No interrupted work or uncertain external actions are reported for this task.', 'hint'));
    body.replaceChildren(...nodes);
  }
  async function load() {
    if (pending) return;
    const owned = ++generation; refresh.disabled = true; issue.hidden = true;
    try { const value = await request({ op: 'task-inspect', id }); if (owned === generation) render(value); }
    catch (error) { if (owned === generation) { issue.textContent = error.message; issue.hidden = false; } }
    finally { if (owned === generation) refresh.disabled = false; }
  }
  return { element: root, load };
}
