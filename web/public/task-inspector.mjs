import { taskBread } from './task-identity.mjs';
import { brandIcon } from './brands.mjs';
import { animateSurfaceHeight } from './surface-motion.mjs';
import { element } from './text.mjs';
import { elapsed, toolLabel, activityFacts } from './activity.mjs';
import { icon, setIcon, activityIcon } from './icons.mjs';

const labels = { running: 'In progress', waiting: 'Needs you', stopping: 'Stopping', completed: 'Ready', failed: 'Needs attention', stopped: 'Stopped', disconnected: 'Connection lost', queued: 'Queued', idle: 'Waiting' };
const marks = { completed: 'check', failed: 'circle-alert', waiting: 'pause', stopping: 'square', stopped: 'square', disconnected: 'wifi-off', queued: 'clock', idle: 'clock' };
function stepIcon(step, state) { return marks[state] || activityIcon(step?.tool, step?.icon); }

function observedStep(step, state, rows, owner) {
  const key = owner + ':' + step.id;
  let row = rows.get(key);
  if (!row) {
    const item = element('li', undefined, 'observed-step');
    const disclosure = element('details', undefined, 'step-disclosure');
    const summary = element('summary');
    const mark = element('span', undefined, 'task-check'); mark.setAttribute('aria-hidden', 'true');
    const name = element('span', undefined, 'step-name'), status = element('span', undefined, 'sr-only');
    summary.append(mark, name, status, disclosureIcon());
    const body = element('div', undefined, 'step-body'); disclosure.append(summary, body); item.append(disclosure);
    row = { item, summary, mark, name, status, body }; rows.set(key, row);
    if (rows.size > 320) rows.delete(rows.keys().next().value);
  }
  row.item.dataset.state = state;
  row.name.textContent = step.text || toolLabel(step.tool, step.state);
  row.status.textContent = labels[state] || state;
  setIcon(row.mark, stepIcon(step, state));
  row.summary.querySelector('.brand-mark')?.remove();
  if (step.brand) row.name.before(brandIcon(step.brand, 'workflow'));
  const contentKey = JSON.stringify([step, state]);
  if (row.key !== contentKey) { row.key = contentKey; row.body.replaceChildren(activityFacts({ ...step, state })); }
  return row.item;
}

export function taskInspector({ openChat, description = '', title: headingText = 'Delegated work', iconName, showEmpty = false, id = 'task-inspector', visibleWhen = () => true }) {
  const root = element('aside', undefined, 'task-inspector');
  root.id = id; root.setAttribute('popover', 'auto'); root.setAttribute('aria-labelledby', id + '-title');
  const trigger = element('button', undefined, 'quiet task-trigger'); trigger.type = 'button'; trigger.hidden = true;
  trigger.setAttribute('popovertarget', root.id); trigger.setAttribute('aria-label', 'Activity');
  const pulse = element('span', undefined, 'task-pulse'); pulse.setAttribute('aria-hidden', 'true');
  const triggerLabel = element('span', 'Activity'); trigger.append(pulse, triggerLabel);
  if (iconName) { triggerLabel.remove(); pulse.remove(); trigger.prepend(icon(iconName)); trigger.classList.add('icon-button'); }
  trigger.title = headingText;
  const header = element('div', undefined, 'section-head');
  const title = element('h2', headingText); title.id = id + '-title';
  const close = element('button', undefined, 'quiet icon-button'); close.type = 'button'; close.append(icon('close'));
  close.setAttribute('aria-label', 'Close ' + headingText.toLowerCase()); close.setAttribute('popovertarget', root.id); close.setAttribute('popovertargetaction', 'hide');
  header.append(title, close);
  const notice = element('p', description, 'hint'); notice.hidden = !description;
  const connection = element('p', undefined, 'hint'); connection.setAttribute('role', 'status'); connection.hidden = true;
  const list = element('div', undefined, 'task-list');
  root.append(header, notice, connection, list);
  const rows = new Map(), stepRows = new Map();
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
    trigger.hidden = !connected || !visibleWhen(tasks) || !showEmpty && !tasks.length;
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
      if (task.parent && !task.engine) { const bread = element('span', taskBread(task.id, task.task_emoji), 'task-bread'); bread.setAttribute('aria-hidden', 'true'); row.name.prepend(bread, document.createTextNode(' ')); }
      if (task.brand) row.name.prepend(brandIcon(task.brand, 'workflow'));
      row.status.textContent = (!connected ? 'Updates paused' : labels[task.state] || 'Waiting') + (task.current ? ' · This task' : ' · In the background');
      row.node.dataset.state = !connected ? 'disconnected' : task.state;
      const key = JSON.stringify([task, connected]);
      if (row.key !== key) {
        row.key = key;
        const nodes = [], steps = element('ol', undefined, 'task-steps');
        for (const step of task.steps || []) {
          const state = ['running', 'waiting'].includes(step.state) && (!connected || task.state === 'disconnected') ? 'disconnected'
            : ['running', 'waiting'].includes(step.state) && !task.active ? 'stopped' : step.state;
          steps.append(observedStep(step, state, stepRows, task.id));
        }
        if (steps.childNodes.length) nodes.push(steps);
        if (task.engine) nodes.push(element('p', task.assignment || 'Working independently on your request.', 'hint'));
        else if (task.active && connected && task.state === 'running' && !(task.steps || []).some(step => step.state === 'running')) nodes.push(element('p', 'Thinking it through…', 'task-thinking hint'));
        else if (!steps.childNodes.length) nodes.push(element('p', 'No steps recorded yet.', 'hint'));
        if (task.model) nodes.push(element('p', task.model, 'hint'));
        if (task.output) {
          let output = row.body.querySelector('.agent-output');
          if (!output) { output = element('details', undefined, 'agent-output'); output.append(element('summary', 'Output'), element('pre')); }
          const log = output.querySelector('pre'); if (log.textContent !== task.output) log.textContent = task.output;
          nodes.push(output);
        }
        if (task.error) nodes.push(element('p', task.error, 'issue'));
        if (task.started_at) nodes.push(element('p', 'Started ' + task.started_at + (task.finished_at && !task.finished_at.startsWith('0001-') ? ' · Finished ' + task.finished_at : ''), 'hint'));
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
        if (task.canOpen && !task.current) links.append(link('Open conversation', task.conversation || task.id));
        if (task.current && task.state === 'waiting') links.append(link('Review task', task.id));
        if (task.parent) links.append(link('Your request', task.parent));
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
  animateSurfaceHeight(root);
  return { element: root, trigger, update, tick, open };
}

function disclosureIcon() { const node = icon('chevron-right'); node.classList.add('disclosure-icon'); return node; }

export function composerProgress() {
  const root = element('details', undefined, 'composer-progress'); root.hidden = true;
  const summary = element('summary');
  const mark = element('span', undefined, 'task-check'); mark.setAttribute('aria-hidden', 'true');
  const label = element('span', undefined, 'progress-label');
  const time = element('span', undefined, 'task-time'); summary.append(mark, label, time, disclosureIcon());
  const body = element('div', undefined, 'progress-body'); root.append(summary, body);
  const stepRows = new Map();
  let latest, key = '', connected = true, rendering = '', wasActive = false;
  function tick() {
    if (latest) time.textContent = elapsed(latest.started_at, latest.active && connected ? new Date().toISOString() : latest.finished_at);
  }
  function update(task, options = {}) {
    connected = options.connected !== false; latest = task;
    root.hidden = !task;
    if (!task) { stepRows.clear(); key = ''; rendering = ''; wasActive = false; body.replaceChildren(); return; }
    const next = task.id + ':' + (task.started_at || 'pending');
    if (next !== key) { stepRows.clear(); key = next; root.open = !!task.active; }
    if (wasActive && !task.active) root.open = false;
    wasActive = !!task.active;
    const state = !connected ? 'disconnected' : task.state;
    root.dataset.state = state;
    const current = task.steps?.findLast(step => step.state === 'running');
    label.textContent = state === 'running' ? current?.text || (current?.tool && toolLabel(current.tool)) || 'Working on it' : labels[state] || 'Working on it';
    setIcon(mark, stepIcon(current, state));
    summary.querySelector(".brand-mark")?.remove();
    if (current?.brand) label.before(brandIcon(current.brand, "workflow"));
    const contentKey = JSON.stringify([task.steps, task.plans, state, task.active]);
    if (contentKey !== rendering) {
      rendering = contentKey;
      const focused = body.contains(document.activeElement) ? document.activeElement : null;
      const list = element('ol', undefined, 'task-steps');
      for (const step of task.steps || []) {
        const status = ['running', 'waiting'].includes(step.state) && (!connected || task.state === 'disconnected') ? 'disconnected' : ['running', 'waiting'].includes(step.state) && !task.active ? 'stopped' : step.state;
        list.append(observedStep(step, status, stepRows, task.id));
      }
      const proposed = (task.plans || []).filter(plan => ['review', 'approved', 'preparing', 'revising'].includes(plan.phase));
      for (const plan of proposed) for (const text of plan.steps || []) {
        const item = element('li'); item.dataset.state = 'planned';
        const dot = element('span', undefined, 'task-check'); dot.append(icon('circle-dashed')); dot.setAttribute('aria-hidden', 'true');
        item.append(dot, element('span', text), element('span', 'Proposed', 'sr-only')); list.append(item);
      }
      body.replaceChildren(list);
      if (!list.childNodes.length) body.append(element('p', state === 'waiting' ? 'Your review is needed in the conversation.' : 'I’ll keep the steps here as I work.', 'hint'));
      if (focused?.isConnected) focused.focus({ preventScroll: true });

    }
    tick();
  }
  return { element: root, update, tick };
}
