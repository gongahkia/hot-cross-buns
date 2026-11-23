import { animatePopoverHeight } from './popover-height.mjs';
import { element } from './text.mjs';
import { elapsed, toolLabel } from './activity.mjs';
import { icon, setIcon, activityIcon } from './icons.mjs';

const labels = { running: 'In progress', waiting: 'Needs you', stopping: 'Stopping', completed: 'Ready', failed: 'Needs attention', stopped: 'Stopped', disconnected: 'Connection lost', queued: 'Queued', idle: 'Waiting' };
const marks = { completed: 'check', failed: 'circle-alert', waiting: 'pause', stopping: 'square', stopped: 'square', disconnected: 'wifi-off', queued: 'clock', idle: 'clock' };
function stepIcon(step, state) { return marks[state] || activityIcon(step?.tool, step?.icon); }

export function taskInspector({ openChat, inspect, description = '', title: headingText = 'Delegated work', iconName, showEmpty = false }) {
  const root = element('aside', undefined, 'task-inspector');
  root.id = 'task-inspector'; root.setAttribute('popover', 'auto'); root.setAttribute('aria-labelledby', 'task-inspector-title');
  const trigger = element('button', undefined, 'quiet task-trigger'); trigger.type = 'button'; trigger.hidden = true;
  trigger.setAttribute('popovertarget', root.id); trigger.setAttribute('aria-label', 'Activity');
  const pulse = element('span', undefined, 'task-pulse'); pulse.setAttribute('aria-hidden', 'true');
  const triggerLabel = element('span', 'Activity'); trigger.append(pulse, triggerLabel);
  if (iconName) { triggerLabel.classList.add('sr-only'); pulse.hidden = true; trigger.prepend(icon(iconName)); trigger.classList.add('icon-button'); }
  trigger.title = headingText;
  const header = element('div', undefined, 'section-head');
  const title = element('h2', headingText); title.id = 'task-inspector-title';
  const close = element('button', undefined, 'quiet icon-button'); close.type = 'button'; close.append(icon('close'));
  close.setAttribute('aria-label', 'Close ' + headingText.toLowerCase()); close.setAttribute('popovertarget', root.id); close.setAttribute('popovertargetaction', 'hide');
  header.append(title, close);
  const notice = element('p', description, 'hint'); notice.hidden = !description;
  const connection = element('p', undefined, 'hint'); connection.setAttribute('role', 'status'); connection.hidden = true;
  const list = element('div', undefined, 'task-list');
  root.append(header, notice, connection, list);
  const rows = new Map();
  let tasks = [], available = true;
  function open() { root.showPopover(); }
  async function visit(id, button) {
    button.disabled = true;
    try { await openChat(id); root.hidePopover(); }
    catch (error) { connection.textContent = error.message; connection.hidden = false; }
    finally { button.disabled = false; }
  }
  function link(label, id) {
    const button = element('button', label, 'quiet'); button.type = 'button';
    button.addEventListener('click', () => void visit(id, button));
    return button;
  }
  function tick() {
    for (const task of tasks) {
      const row = rows.get(task.id);
      if (row) row.time.textContent = elapsed(task.started_at, task.active && available ? new Date().toISOString() : task.finished_at);
    }
  }
  function update(values = [], { connected = true } = {}) {
    tasks = values; available = connected;
    const active = tasks.filter(task => task.active).length;
    const waiting = tasks.filter(task => task.state === 'waiting').length;
    trigger.hidden = !showEmpty && !tasks.length;
    triggerLabel.textContent = !connected ? 'Activity' : waiting ? `Needs you · ${waiting}` : active ? `In progress · ${active}` : 'Activity';
    trigger.dataset.active = String(connected && active > 0 && !waiting);
    trigger.setAttribute('aria-label', headingText + (active ? ' · ' + active + ' active' : ''));
    connection.textContent = 'Live updates paused. Showing the last received activity.'; connection.hidden = connected;
    const keep = new Set();
    for (const [index, task] of tasks.entries()) {
      keep.add(task.id);
      let row = rows.get(task.id);
      if (!row) {
        const node = element('details', undefined, 'task-item');
        const head = element('summary');
        const heading = element('span', undefined, 'task-heading');
        const name = element('span', undefined, 'task-name');
        const status = element('span', undefined, 'task-status');
        const time = element('span', undefined, 'task-time');
        heading.append(name, status); head.append(heading, time, disclosureIcon());
        const body = element('div', undefined, 'task-body'); node.append(head, body);
        node.open = !!task.active;
        row = { node, name, status, time, body, key: '' }; rows.set(task.id, row); list.append(node);
      }
      row.name.textContent = task.engine ? task.engine + ' · ' + task.title : task.title;
      row.status.textContent = (!connected ? 'Updates paused' : labels[task.state] || 'Waiting') + (task.current ? ' · This chat' : ' · In the background');
      row.node.dataset.state = !connected ? 'disconnected' : task.state;
      const key = JSON.stringify([task, connected]);
      if (row.key !== key) {
        row.key = key;
        const nodes = [], steps = element('ol', undefined, 'task-steps');
        for (const step of task.steps || []) {
          const state = ['running', 'waiting'].includes(step.state) && (!connected || task.state === 'disconnected') ? 'disconnected'
            : ['running', 'waiting'].includes(step.state) && !task.active ? 'stopped' : step.state;
          const item = element('li'); item.dataset.state = state;
          const mark = element('span', undefined, 'task-check'); mark.append(icon(stepIcon(step, state))); mark.setAttribute('aria-hidden', 'true');
          const text = element('span', step.text || toolLabel(step.tool));
          const status = element('span', state === 'completed' ? 'Done' : labels[state] || 'Waiting', 'sr-only');
          item.append(mark, text, status); steps.append(item);
        }
        if (steps.childNodes.length) nodes.push(steps);
        if (task.engine) nodes.push(element('p', task.assignment || 'Working independently on your request.', 'hint'));
        else if (task.active && connected && task.state === 'running' && !(task.steps || []).some(step => step.state === 'running')) nodes.push(element('p', 'Thinking it through…', 'task-thinking hint'));
        else if (!steps.childNodes.length) nodes.push(element('p', 'No steps recorded yet.', 'hint'));
        if (task.truncated) nodes.push(element('p', 'Some earlier activity is no longer shown.', 'hint'));
        for (const plan of task.plans || []) if (plan.steps?.length) {
          const proposed = element('details', undefined, 'task-proposal');
          proposed.append(element('summary', 'Proposed steps'), element('p', 'These are the proposed steps. Individual completion is not reported.', 'hint'));
          const items = element('ol'); for (const step of plan.steps) items.append(element('li', step));
          proposed.append(items); nodes.push(proposed);
        }
        if (task.summary) {
          const summary = element('details', undefined, 'task-result'); summary.append(element('summary', 'Summary'), element('p', task.summary)); nodes.push(summary);
        }
        const links = element('div', undefined, 'task-links');
        if (inspect) { const details = element('button', 'Details', 'quiet'); details.type = 'button'; details.prepend(icon('eye')); details.addEventListener('click', () => { root.hidePopover(); inspect(task.conversation || task.id); }); links.append(details); }
        if (task.canOpen && !task.current) links.append(link('Open chat', task.conversation || task.id));
        if (task.current && task.state === 'waiting') links.append(link('Return to chat', task.id));
        if (task.parent) links.append(link('Back to your request', task.parent));
        if (links.childNodes.length) nodes.push(links);
        row.body.replaceChildren(...nodes);
      }
      if (list.children[index] !== row.node) list.insertBefore(row.node, list.children[index] || null);
    }
    for (const [id, row] of rows) if (!keep.has(id)) { row.node.remove(); rows.delete(id); }
    list.querySelector('.task-empty')?.remove();
    if (!tasks.length) list.append(element('p', 'Nothing delegated right now. Work I hand off will appear here.', 'task-empty hint'));
    tick();
  }
  animatePopoverHeight(root);
  return { element: root, trigger, update, tick, open };
}

function disclosureIcon() { const node = icon('chevron-right'); node.classList.add('disclosure-icon'); return node; }

export function composerProgress({ inspect } = {}) {
  const root = element('details', undefined, 'composer-progress'); root.hidden = true;
  const summary = element('summary');
  const mark = element('span', undefined, 'task-check'); mark.setAttribute('aria-hidden', 'true');
  const label = element('span', undefined, 'progress-label');
  const time = element('span', undefined, 'task-time'); summary.append(mark, label, time, disclosureIcon());
  const body = element('div', undefined, 'progress-body'); root.append(summary, body);
  const details = element('button', 'Details', 'quiet progress-details'); details.type = 'button'; details.prepend(icon('eye'));
  if (inspect) details.addEventListener('click', inspect);
  let latest, key = '', connected = true, rendering = '', wasActive = false;
  function tick() {
    if (latest) time.textContent = elapsed(latest.started_at, latest.active && connected ? new Date().toISOString() : latest.finished_at);
  }
  function update(task, options = {}) {
    connected = options.connected !== false; latest = task;
    root.hidden = !task;
    if (!task) { key = ''; rendering = ''; wasActive = false; body.replaceChildren(); return; }
    const next = task.id + ':' + (task.started_at || 'pending');
    if (next !== key) { key = next; root.open = !!task.active; }
    if (wasActive && !task.active) root.open = false;
    wasActive = !!task.active;
    const state = !connected ? 'disconnected' : task.state;
    root.dataset.state = state;
    const current = task.steps?.findLast(step => step.state === 'running');
    label.textContent = state === 'running' ? current?.text || (current?.tool && toolLabel(current.tool)) || 'Working on it' : labels[state] || 'Working on it';
    setIcon(mark, stepIcon(current, state));
    const contentKey = JSON.stringify([task.steps, task.plans, state, task.active]);
    if (contentKey !== rendering) {
      rendering = contentKey;
      const list = element('ol', undefined, 'task-steps');
      for (const step of task.steps || []) {
        const status = ['running', 'waiting'].includes(step.state) && (!connected || task.state === 'disconnected') ? 'disconnected' : ['running', 'waiting'].includes(step.state) && !task.active ? 'stopped' : step.state;
        const item = element('li'); item.dataset.state = status;
        const dot = element('span', undefined, 'task-check'); dot.append(icon(stepIcon(step, status))); dot.setAttribute('aria-hidden', 'true');
        item.append(dot, element('span', step.text || toolLabel(step.tool)), element('span', labels[status] || status, 'sr-only')); list.append(item);
      }
      const proposed = (task.plans || []).filter(plan => ['review', 'approved', 'preparing', 'revising'].includes(plan.phase));
      for (const plan of proposed) for (const text of plan.steps || []) {
        const item = element('li'); item.dataset.state = 'planned';
        const dot = element('span', undefined, 'task-check'); dot.append(icon('circle-dashed')); dot.setAttribute('aria-hidden', 'true');
        item.append(dot, element('span', text), element('span', 'Proposed', 'sr-only')); list.append(item);
      }
      body.replaceChildren(list);
      if (!list.childNodes.length) body.append(element('p', state === 'waiting' ? 'Your review is needed in the conversation.' : 'I’ll keep the steps here as I work.', 'hint'));
      if (inspect) body.append(details);
    }
    tick();
  }
  return { element: root, update, tick };
}
