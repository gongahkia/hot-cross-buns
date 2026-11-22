import { element } from './text.mjs';
import { icon } from './icons.mjs';

export function scheduledPane({ request, manage, goals, embedded = false, description = '' }) {
  const root = element(embedded ? 'section' : 'aside', undefined, embedded ? 'scheduled-content' : 'task-inspector scheduled-pane'); root.id = 'scheduled-tasks';
  if (!embedded) { root.setAttribute('popover', 'auto'); root.setAttribute('aria-labelledby', 'scheduled-title'); }
  const trigger = element('button', undefined, 'quiet icon-button'); trigger.type = 'button'; trigger.append(icon('clock'));
  if (!embedded) trigger.setAttribute('popovertarget', root.id);
  trigger.setAttribute('aria-label', 'Scheduled tasks'); trigger.title = 'Scheduled tasks';
  const header = element('div', undefined, 'section-head'), title = element('h2', 'Scheduled tasks'); title.id = 'scheduled-title';
  const close = element('button', undefined, 'quiet icon-button'); close.type = 'button'; close.append(icon('close'));
  close.setAttribute('aria-label', 'Close scheduled tasks'); close.setAttribute('popovertarget', root.id); close.setAttribute('popovertargetaction', 'hide'); header.append(title, close);
  const note = element('p', description, 'hint'); note.hidden = !description;
  const error = element('p', undefined, 'issue'); error.setAttribute('role', 'alert'); error.hidden = true;
  const health = element('p', undefined, 'hint'), list = element('div'), actions = element('div', undefined, 'task-links');
  const refresh = button('Refresh', () => void perform({ action: 'refresh' })); actions.append(refresh);
  const dismiss = () => { if (!embedded) root.hidePopover(); };
  if (manage) actions.append(button('Create or manage schedules', async () => { dismiss(); await manage(); }));
  if (goals) actions.append(button('Ongoing responsibilities', async () => { dismiss(); await goals(); }));
  if (!embedded) root.append(header);
  root.append(note, error, health, list, actions);
  let busy = false, fingerprint = '';
  function button(text, action) { const node = element('button', text, 'quiet'); node.type = 'button'; node.addEventListener('click', () => void action()); return node; }
  async function perform(value) {
    if (busy) return;
    busy = true; error.hidden = true; refresh.disabled = true;
    try { update(await request(value)); if (['inspect', 'edit'].includes(value.action)) dismiss(); }
    catch (issue) { error.textContent = issue.message; error.hidden = false; }
    finally { busy = false; refresh.disabled = false; }
  }
  function update(value = {}) {
    const next = JSON.stringify(value); if (next === fingerprint) return; fingerprint = next;
    health.textContent = value.issue || (value.running === false ? 'Local scheduler is stopped.' : ''); health.hidden = !health.textContent;
    list.replaceChildren();
    for (const task of value.entries || []) {
      const row = element('details', undefined, 'task-item'), head = element('summary'), heading = element('span', undefined, 'task-heading');
      let due = '';
      if (task.next_due && task.enabled) {
        try { due = new Date(task.next_due).toLocaleString(undefined, { timeZone: task.timezone || undefined, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { due = task.next_due; }
      }
      heading.append(element('span', task.title, 'task-name'), element('span', task.enabled ? (due ? 'Next · ' + due + ' · ' + task.timezone : task.state || 'Scheduled') : 'Paused', 'task-status'));
      const chevron = icon('chevron-right'); chevron.classList.add('disclosure-icon');
      head.append(heading, chevron); row.append(head);
      if (task.outcome) row.append(element('p', task.outcome, 'hint'));
      row.append(element('p', task.timing || task.schedule + ' · ' + task.timezone, 'hint'));
      if (task.issue) row.append(element('p', task.issue, 'issue'));
      const controls = element('div', undefined, 'task-links');
      for (const [label, action] of [['Details', 'inspect'], [task.enabled ? 'Pause' : 'Resume', task.enabled ? 'pause' : 'resume'], ...(task.editable ? [['Edit timing', 'edit']] : [])]) controls.append(button(label, () => perform({ action, id: task.id, digest: task.digest })));
      row.append(controls); list.append(row);
    }
    if (!value.entries?.length) list.append(element('p', 'No scheduled tasks yet. Ask me to remind you or check on something regularly.', 'task-empty hint'));
  }
  if (!embedded) trigger.addEventListener('click', () => void perform({ action: 'refresh' }));
  function open() { if (!embedded) root.showPopover(); void perform({ action: 'refresh' }); }
  update();
  return { element: root, trigger, update, open };
}
