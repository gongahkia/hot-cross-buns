import { element } from './text.mjs';
import { icon } from './icons.mjs';
import { animateSurfaceHeight } from './surface-motion.mjs';

const kinds = { goal: 'Ongoing responsibility', schedule: 'Scheduled task', plan: 'Plan update', note: 'Saved note', skill: 'Skill or routine', conflict: 'Conflict review' };
const names = { body: 'Proposed content', goal_outcome: 'Intended outcome', goal_steps: 'Steps', goal_source_path: 'Workspace', goal_id: 'Goal', timing: 'Schedule', timezone: 'Time zone', task: 'Scheduled instruction', change_only: 'Notify only on changes', plan_change: 'Plan changes', source_refs: 'Source references', dependencies: 'Source dependencies', routine: 'Routine settings', conflict_sources: 'Conflicting sources', skill_id: 'Skill', description: 'Description', note_id: 'Existing note', expected_note_revision: 'Expected note revision', ends_at: 'Stops after', source_path: 'Workspace', work_id: 'Originating task' };
function structured(value) {
  if (Array.isArray(value)) { const list = element('ul'); for (const item of value) { const row = element('li'); row.append(structured(item)); list.append(row); } return list; }
  if (value && typeof value === 'object') {
    const fields = element('dl', undefined, 'view-facts');
    for (const [key, item] of Object.entries(value)) {
      if (item === null || item === '' || Array.isArray(item) && !item.length) continue;
      const body = element('dd'); body.append(structured(item)); fields.append(element('dt', names[key] || key.replaceAll('_', ' ')), body);
    }
    return fields;
  }
  return element('span', typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value ?? ''));
}

export function reviewQueue({ request }) {
  const root = element('aside', undefined, 'task-inspector review-queue'); root.id = 'review-queue';
  root.setAttribute('popover', 'auto'); root.setAttribute('aria-labelledby', 'review-queue-title');
  const trigger = element('button', undefined, 'quiet icon-button'); trigger.type = 'button'; trigger.hidden=true;
  trigger.append(icon('list-checks')); trigger.title = 'Review queue'; trigger.setAttribute('aria-label', 'Review queue'); trigger.setAttribute('popovertarget', root.id);
  const head = element('div', undefined, 'section-head');
  const close = element('button', undefined, 'quiet icon-button'); close.type = 'button'; close.append(icon('close')); close.setAttribute('aria-label', 'Close review queue'); close.setAttribute('popovertarget', root.id); close.setAttribute('popovertargetaction', 'hide');
  const title = element('h2', 'Review queue'); title.id = 'review-queue-title'; head.append(title, close);
  const issue = element('p', '', 'issue'); issue.hidden = true; issue.setAttribute('role', 'alert');
  const notice = element('p', '', 'hint'); notice.hidden = true; notice.setAttribute('role', 'status');
  let entries, review, busy = false, generation = 0, signature, timer;
  const content = element('div'), tools = element('div', undefined, 'task-links');
  tools.append(button('Refresh', () => { review = undefined; return perform({ action: 'list' }); }));
  root.append(head, element('p', 'Proposed lasting changes. Open a proposal to review what accepting it will do.', 'hint'), issue, notice, content, tools);
  function button(label, run) { const node = element('button', label, 'quiet'); node.type = 'button'; node.disabled = busy; node.addEventListener('click', () => void run()); return node; }
  function render() {
    content.replaceChildren();
    if (review) {
      content.append(button('Back to queue', () => { review = undefined; render(); }), element('h3', review.title || kinds[review.kind] || 'Proposal'), element('p', kinds[review.kind] || review.kind, 'hint'));
      const fields = {};
      for (const key of Object.keys(names)) if (review[key] !== undefined && (key !== 'plan_change' || review.kind === 'plan')) fields[key] = review[key];
      content.append(structured(fields));
      if (review.current_note) content.append(element('h3', 'Current note'), structured(review.current_note));
      if (review.conflict_check) content.append(element('p', review.conflict_check, 'hint'));
      if (review.reference_integrity) {
        const check = review.reference_integrity;
        const labels = { no_references: 'No source references supplied', work_unavailable: 'Original task evidence unavailable', verified: 'References matched retained evidence', unverified: 'Some references could not be verified' };
        content.append(element('h3', 'Source checks'), structured({ ...check, status: labels[check.status] || check.status }));
      }
      content.append(element('p', review.kind === 'conflict' ? 'Accept acknowledges this conflict. It does not correct the sources.' : (review.cron || review.run_at) ? 'Accept creates this responsibility or schedule and enables its scheduled checks. Inspect the timing and instructions above.' : 'Accept applies this exact proposal to your saved knowledge or plan.', 'hint'));
      if (review.status === 'pending') {
        const controls = element('div', undefined, 'review-actions');
        for (const [label, action] of [['Reject proposal', 'reject'], ['Accept proposal', 'accept']]) controls.append(button(label, () => perform({ action, id: review.id, revision: review.revision })));
        content.append(controls);
      } else content.append(element('p', 'This proposal is already ' + review.status + '.', 'hint'));
    } else {
      for (const entry of entries || []) {
        const row = element('div', undefined, 'task-item');
        row.append(button(entry.title || kinds[entry.kind] || 'Proposal', () => perform({ action: 'inspect', id: entry.id })), element('p', kinds[entry.kind] || entry.kind, 'task-status'));
        content.append(row);
      }
      if (!entries?.length) content.append(element('p', entries ? 'Nothing awaiting review.' : 'Loading proposals…', 'hint'));
    }
  }
  async function perform(action) {
    if (busy) return;
    const owned = generation;
    busy = true; issue.hidden = true; notice.hidden = true; root.setAttribute('aria-busy', 'true');
    for (const node of root.querySelectorAll('button:not([popovertarget])')) node.disabled = true;
    try {
      const value = await request(action);
      if (owned !== generation) return;
      entries = value.entries || [];
      review = value.review;
      trigger.hidden = !entries.length;
      trigger.setAttribute('aria-label', 'Review queue · ' + entries.length + ' pending');
      notice.textContent = value.notice || ''; notice.hidden = !notice.textContent;
    } catch (error) {
      if (owned !== generation) return;
      issue.textContent = error.message + (['accept', 'reject'].includes(action.action) ? ' Refresh to confirm the saved status before deciding again.' : ''); issue.hidden = false;
      if (!entries) { content.replaceChildren(element('p', 'Proposals could not be loaded. Refresh to try again.', 'hint')); }
    } finally {
      busy = false; root.removeAttribute('aria-busy');
      for (const node of root.querySelectorAll('button')) node.disabled = false;
      if (owned === generation && (entries || review)) render();
      else if (owned !== generation) void perform({ action: 'list' });
    }
  }
  root.addEventListener('toggle', event => { if (event.newState === 'open') { review = undefined; void perform({ action: 'list' }); } });
  function observe(value) {
    if (value === signature) return;
    signature = value; generation++; review = undefined; entries = undefined;
    trigger.hidden = true; trigger.setAttribute('aria-label', 'Review queue');
    clearTimeout(timer); timer = setTimeout(() => void perform({ action: 'list' }), 180);
  }
  render(); animateSurfaceHeight(root);
  return { element: root, trigger, observe, refresh: () => perform({ action: 'list' }), open() { root.showPopover(); } };
}
