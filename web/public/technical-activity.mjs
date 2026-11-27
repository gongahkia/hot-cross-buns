import { taskInspector } from './task-inspector.mjs';
import { element } from './text.mjs';
import { icon } from './icons.mjs';
import { localAppURL } from './local-url.mjs';

export function technicalActivity({ request, openChat, openServer }) {
  const pane = taskInspector({ id: 'technical-activity', title: 'Terminals and servers', iconName: 'terminal', openChat,
    visibleWhen: () => true, showEmpty: true });
  const servers = element('section', undefined, 'technical-servers');
  servers.setAttribute('aria-label', 'Local servers');
  const heading = element('h3', 'Servers'), list = element('div');
  const issue = element('p', undefined, 'hint'); issue.setAttribute('role', 'status'); issue.hidden = true;
  servers.append(heading, issue, list);
  pane.element.querySelector('.task-list').before(servers, element('h3', 'Agent output'));
  const actions = element('div', undefined, 'task-links'), refresh = element('button', 'Refresh', 'quiet');
  refresh.type = 'button'; refresh.addEventListener('click', () => void load()); actions.append(refresh); pane.element.append(actions);
  let agents = [], connected = false, context, generation = 0, busy = false, timer, observed = [], checkedContext;
  function visibility() {
    pane.trigger.hidden = !connected || !(agents.some(agent => agent.active) || observed.some(server => !server.internal && !server.application));
  }
  function render() {
    list.replaceChildren();
    for (const server of observed) {
      const url = !server.internal && !server.application && localAppURL(server.url);
      const row = element(url ? 'button' : 'div', undefined, 'quiet technical-server');
      row.append(icon('globe'));
      const copy = element('span'), name = element('span', 'localhost:' + server.port);
      const detail = element('small', [server.application || server.process, server.internal ? 'HCB internal service' : 'PID ' + server.pid].join(' · '), 'hint');
      copy.append(name, detail); row.append(copy);
      if (url) {
        row.type = 'button'; row.setAttribute('aria-label', 'Preview localhost:' + server.port);
        row.append(icon('external-link'));
        row.addEventListener('click', () => { pane.element.hidePopover(); openServer(url, pane.trigger); });
      }
      list.append(row);
    }
    if (!observed.length) list.append(element('p', 'No local listeners found.', 'hint'));
    visibility();
  }
  async function load() {
    if (busy || !connected) return;
    const current = generation;
    busy = true; refresh.disabled = true;
    try {
      const value = await request();
      if (current !== generation) return;
      observed = value.servers || []; checkedContext = context;
      issue.textContent = value.issue || ''; issue.hidden = !value.issue;
      render();
    } catch (error) {
      if (current === generation) { issue.textContent = error.message; issue.hidden = false; }
    } finally {
      busy = false; refresh.disabled = false;
      if (current !== generation && connected) void load();
    }
  }
  pane.element.addEventListener('toggle', event => {
    clearInterval(timer);
    if (event.newState === 'open') { void load(); timer = setInterval(() => void load(), 5000); }
  });
  function update(values = [], options = {}) {
    const changed = context !== options.context;
    if (changed) { context = options.context; generation++; observed = []; checkedContext = undefined; }
    agents = values || []; connected = options.connected !== false;
    pane.update(agents, { connected }); visibility();
    // Discover once per connection/context, then refresh while inspected. New
    // agent activity also gives a newly launched server a fresh observation.
    const signature = JSON.stringify(agents.map(agent => [agent.id, agent.active, agent.state]));
    if (connected && (checkedContext !== context || signature !== update.signature)) void load();
    update.signature = signature;
  }
  return { ...pane, update };
}
