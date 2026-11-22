import { element } from './text.mjs';
import { icon as libraryIcon, setIcon, activityIcon } from './icons.mjs';

const toolNames = {
  read_file: 'Reading a file', code_read_file: 'Reading code', list_files: 'Browsing files',
  search_files: 'Searching files', web_search: 'Searching the web', web_fetch: 'Reading a page',
  search_evidence: 'Searching references', read_evidence: 'Reading a reference',
  code_run_command: 'Running a command', run_command: 'Running a command',
  code_apply_patch: 'Editing code', apply_patch: 'Editing files',
  write_artifact: 'Writing an artifact', write_table_artifact: 'Writing a table',
  work_write_document: 'Writing a document', work_write_workbook: 'Writing a workbook',
  work_write_presentation: 'Creating a presentation', artifact_status: 'Checking outputs',
  start_agent: 'Starting a specialist', await_agent: 'Waiting for a specialist',
  delegate_agents: 'Consulting specialists', code_git_diff: 'Reviewing changes',
};
export function toolLabel(name) { return toolNames[name] || String(name || 'Step').replaceAll('_', ' '); }
function disclosureIcon() { const node = libraryIcon('chevron-right'); node.classList.add('disclosure-icon'); return node; }
export function elapsed(start, finish) {
  const from = Date.parse(start), to = Date.parse(finish);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return '';
  const seconds = Math.floor((to - from) / 1000);
  if (seconds < 60) return seconds + 's';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ' + seconds % 60 + 's';
  return Math.floor(seconds / 3600) + 'h ' + Math.floor(seconds % 3600 / 60) + 'm';
}
function detailLabel(value) {
  if (value.path) return value.path;
  if (value.domain) return value.domain;
  if (value.kind === 'command') return value.timed_out ? 'Command timed out' : 'Exit code ' + value.exit_code;
  if (value.candidate_id) return value.candidate_id + ' · ' + value.status;
  return value.kind.replaceAll('_', ' ');
}
const expanded = new Map();
export function activityView(key = '', { remember = true, autoExpand = true } = {}) {
  const root = element('details', undefined, 'activity-group');
  const summary = element('summary');
  const icon = element('span', undefined, 'activity-indicator');
  icon.setAttribute('aria-hidden', 'true');
  const label = element('span', 'Thinking', 'activity-label');
  label.setAttribute('aria-live', 'polite');
  label.setAttribute('aria-atomic', 'true');
  const duration = element('span', undefined, 'activity-duration');
  summary.append(icon, label, duration, disclosureIcon());
  const list = element('div', undefined, 'activity-list');
  root.append(summary, list);
  root.open = remember && expanded.get(key) || false;
  root.addEventListener('toggle', () => {
    if (!remember) return;
    expanded.set(key, root.open);
    if (expanded.size > 128) expanded.delete(expanded.keys().next().value);
  });
  const rows = new Map();
  let wasActive = false, latest, options;
  function clock() {
    if (!options) return;
    const { active, waiting, stopping, disconnected } = options;
    const current = latest.entries?.findLast(entry => entry.kind === 'tool' && ['running', 'waiting'].includes(entry.state));
    let text = 'Thinking';
    if (disconnected) text = 'Connection lost';
    else if (stopping) text = 'Stopping';
    else if (waiting || current?.state === 'waiting') text = 'Waiting for approval';
    else if (current) text = toolLabel(current.tool);
    else if (latest.entries?.at(-1)?.kind === 'text') text = 'Writing response';
    const paused = waiting || current?.state === "waiting";
    const time = elapsed(latest.started_at, active ? new Date().toISOString() : latest.finished_at);
    const outcome = latest.state === 'failed' ? 'Work failed' : latest.state === 'stopped' ? 'Stopped' : 'Worked';
    const nextLabel = active ? text : outcome + (time ? (outcome === 'Worked' ? ' for ' : ' after ') + time : '');
    if (label.textContent !== nextLabel) label.textContent = nextLabel;
    duration.textContent = active ? time : '';
    root.dataset.state = disconnected ? 'disconnected' : stopping ? 'stopping' : paused ? 'waiting' : active ? 'running' : latest.state || 'completed';
    icon.dataset.active = String(active && !paused && !stopping && !disconnected);
    setIcon(icon, disconnected ? 'wifi-off' : stopping ? 'square' : paused ? 'pause' : active ? current ? activityIcon(current.tool, current.icon) : 'brain' : latest.state === 'failed' ? 'circle-alert' : latest.state === 'stopped' ? 'square' : 'check');
  }
  function update(activity = {}, state = {}) {
    latest = activity;
    options = { active: activity.state === 'running', ...state };
    if (wasActive && !options.active) root.open = false;
    if (options.active && !wasActive && autoExpand) root.open = true;
    wasActive = options.active;
    const entries = activity.entries || [];
    const shown = entries.filter((entry, index) => !(options.active && index === entries.length - 1 && entry.kind === 'text'));
    const ids = new Set();
    for (const entry of shown) {
      ids.add(entry.id);
      let row = rows.get(entry.id);
      if (!row) {
        const node = element(entry.kind === 'tool' ? 'details' : 'div', undefined, 'activity-entry');
        const head = element(entry.kind === 'tool' ? 'summary' : 'div', undefined, 'activity-entry-head');
        const mark = element('span', undefined, 'activity-tool-icon');
        mark.setAttribute('aria-hidden', 'true');
        const title = element('span', undefined, 'activity-entry-label');
        const status = element('span', undefined, 'activity-entry-status');
        head.append(mark, title, status);
        if (entry.kind === 'tool') head.append(disclosureIcon());
        const body = element('div', undefined, 'activity-entry-body');
        node.append(head, body);
        row = { node, title, status, mark, body, bodyKey: '' };
        rows.set(entry.id, row);
        list.append(node);
      }
      row.title.textContent = entry.kind === 'tool' ? toolLabel(entry.tool) : entry.text || 'Working';
      row.status.textContent = entry.kind === 'tool' ? entry.state : '';
      row.node.dataset.state = options.active ? entry.state : entry.state === 'running' ? 'stopped' : entry.state;
      row.mark.dataset.active = String(options.active && entry.state === 'running' && !options.disconnected);
      setIcon(row.mark, activityIcon(entry.tool, entry.icon));
      const bodyKey = JSON.stringify([entry.tool, entry.details, entry.partial]);
      if (bodyKey !== row.bodyKey) {
        row.bodyKey = bodyKey;
        const nodes = entry.tool ? [element('code', entry.tool)] : [];
        for (const detail of entry.details || []) nodes.push(element('div', detailLabel(detail), 'activity-fact'));
        if (entry.partial) nodes.push(element('p', 'Some activity details were omitted.', 'hint'));
        row.body.replaceChildren(...nodes);
      }
    }
    for (const [id, row] of rows) if (!ids.has(id)) { row.node.remove(); rows.delete(id); }
    list.querySelector('.activity-empty')?.remove();
    if (!shown.length) list.append(element('p', options.active ? 'Waiting for the model to respond…' : 'No tool activity recorded.', 'activity-empty hint'));
    list.querySelector('.activity-truncated')?.remove();
    if (activity.truncated) list.append(element('p', 'Earlier activity was truncated.', 'activity-truncated hint'));
    clock();
  }
  return { element: root, update, clock, retain(nextKey) { key = nextKey; remember = true; } };
}
