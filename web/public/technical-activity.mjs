import { taskInspector } from './task-inspector.mjs';
import { element } from './text.mjs';
import { icon } from './icons.mjs';
import { localAppURL } from './local-url.mjs';

export async function checkLocalServer(value, signal, fetcher = fetch) {
  let url;
  try { url = new URL(value); } catch { return false; }
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || signal?.aborted) return false;
  const controller = new AbortController(), cancel = () => controller.abort();
  const timer = setTimeout(cancel, 1500);
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    // no-cors requires following redirects; the host CSP restricts the entire
    // connection chain to loopback origins.
    await fetcher(url.href, { method: 'HEAD', mode: 'no-cors', credentials: 'omit', redirect: 'follow', referrerPolicy: 'no-referrer', cache: 'no-store', signal: controller.signal });
    return !controller.signal.aborted;
  } catch { return false; }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}

export function technicalActivity({ request, openChat, openServer, checkServer = checkLocalServer }) {
  const pane = taskInspector({ id: 'technical-activity', title: 'Terminals and servers', iconName: 'terminal', openChat,
    visibleWhen: () => true, showEmpty: true });
  const servers = element('section', undefined, 'technical-servers');
  servers.setAttribute('aria-label', 'Local servers');
  const heading = element('h3', 'Servers'), list = element('div');
  const issue = element('p', undefined, 'hint'); issue.setAttribute('role', 'status'); issue.hidden = true;
  servers.append(heading, issue, list);
  pane.element.querySelector('.task-list').before(servers, element('h3', 'Agent output'));
  const actions = element('div', undefined, 'task-links'), refresh = element('button', 'Refresh', 'quiet');
  refresh.type = 'button'; refresh.addEventListener('click', () => void load(true)); actions.append(refresh); pane.element.append(actions);
  let agents = [], connected = false, context, generation = 0, busy = false, timer, observed = [], checkedContext, controller, serverKey = '';
  function visibility() {
    pane.trigger.hidden = !connected || !(agents.some(agent => agent.active) || observed.some(server => !server.internal && !server.application));
  }
  function render() {
    const next = JSON.stringify([observed, busy && !observed.length]);
    if (serverKey === next) { visibility(); return; }
    serverKey = next;
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
    if (!observed.length) list.append(element('p', busy ? 'Checking local apps…' : 'No live local apps.', 'hint'));
    visibility();
  }
  async function load(reset = false) {
    if (busy || !connected) return;
    const current = generation, check = new AbortController(); controller = check;
    busy = true; refresh.disabled = true;
    if (reset) { observed = []; render(); }
    try {
      const value = await request();
      if (current !== generation) return;
      checkedContext = context;
      const candidates = [...new Map((value.servers || []).filter(server => !server.internal).map(server => [server.url, server])).values()];
      const urls = new Set(candidates.map(server => server.url));
      const verified = new Map(observed.filter(server => urls.has(server.url)).map(server => [server.url, server]));
      observed = [...verified.values()];
      issue.textContent = value.issue || ''; issue.hidden = !value.issue; render();
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, async () => {
        while (cursor < candidates.length && !check.signal.aborted) {
          const server = candidates[cursor++];
          const alive = await checkServer(server.url, check.signal);
          if (current !== generation || check.signal.aborted) return;
          if (alive) verified.set(server.url, server); else verified.delete(server.url);
          observed = candidates.filter(server => verified.has(server.url)); render();
        }
      }));
    } catch (error) {
      if (current === generation) { observed = []; issue.textContent = error.message; issue.hidden = false; render(); }
    } finally {
      busy = false; refresh.disabled = false;
      if (current === generation) render();
      if (current !== generation && connected) void load(true);
    }
  }
  pane.element.addEventListener('toggle', event => {
    if (event.target !== pane.element) return;
    clearInterval(timer);
    if (event.newState === 'open') { void load(true); timer = setInterval(() => void load(), 5000); }
  });
  function update(values = [], options = {}) {
    const changed = context !== options.context;
    if (changed || connected && options.connected === false) { controller?.abort(); context = options.context; generation++; observed = []; checkedContext = undefined; render(); }
    agents = values || []; connected = options.connected !== false;
    pane.update(agents, { connected }); render();
    // Discover once per connection/context, then refresh while inspected. New
    // agent activity also gives a newly launched server a fresh observation.
    const signature = JSON.stringify(agents.map(agent => [agent.id, agent.active, agent.state]));
    if (connected && (checkedContext !== context || signature !== update.signature)) void load();
    update.signature = signature;
  }
  return { ...pane, update };
}
