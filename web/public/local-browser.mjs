import { element } from './text.mjs';
import { icon } from './icons.mjs';
import { localAppURL } from './local-url.mjs';

export function localBrowser({ inspect } = {}) {
  const root = element('aside', undefined, 'local-browser'); root.hidden = true; root.setAttribute('aria-label', 'Local app preview');
  const tabs = element('div', undefined, 'browser-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Local apps');
  const toolbar = element('div', undefined, 'browser-toolbar');
  const address = element('input'); address.type = 'url'; address.setAttribute('aria-label', 'Local app address'); address.readOnly = true;
  function tool(label, name, action) { const node = element('button', undefined, 'quiet icon-button'); node.type = 'button'; node.title = label; node.setAttribute('aria-label', label); node.append(icon(name)); node.addEventListener('click', action); return node; }
  const external = element('a', undefined, 'quiet icon-button'); external.target = '_blank'; external.rel = 'noopener noreferrer'; external.title = 'Open in browser'; external.setAttribute('aria-label', 'Open in browser'); external.append(icon('external-link'));
  const frames = element('div', undefined, 'browser-frames');
  const reload = tool('Reload local app', 'refresh-cw', () => { const tab = entries.find(item => item.id === selected); if (tab) void load(tab); });
  toolbar.append(reload, address, external, tool('Close app preview', 'x', () => close(true))); root.append(tabs, toolbar, frames);
  let entries = [], selected, counter = 0, origin;
  function select(id) {
    selected = id;
    for (const entry of entries) { const active = entry.id === id; entry.button.setAttribute('aria-selected', String(active)); entry.button.tabIndex = active ? 0 : -1; entry.panel.hidden = !active; if (active) { address.value = entry.url; external.href = entry.url; } }
  }
  function remove(id) {
    const index = entries.findIndex(entry => entry.id === id); if (index < 0) return;
    const [entry] = entries.splice(index, 1); entry.row.remove(); entry.panel.remove();
    if (!entries.length) { close(true); return; }
    if (selected === id) select(entries[Math.min(index, entries.length - 1)].id);
    entries.find(item => item.id === selected)?.button.focus();
  }
  function close(restoreFocus = false) { for (const entry of entries) entry.panel.remove(); entries = []; tabs.replaceChildren(); root.hidden = true; document.body.classList.remove('local-browser-open'); if (restoreFocus && origin?.isConnected) origin.focus({preventScroll:true}); origin = undefined; }
  function notice(entry, message, loading = false) {
    const status = element('div', undefined, 'browser-notice'); status.setAttribute('role', loading ? 'status' : 'alert');
    status.append(icon(loading ? 'loader-circle' : 'globe'), element('p', message));
    if (!loading) {
      const link = element('a', 'Open in browser'); link.href = entry.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; status.append(link);
    }
    entry.panel.replaceChildren(status);
  }
  function mount(entry) {
    const frame = element('iframe'); frame.title = 'Local app · ' + new URL(entry.url).host;
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-downloads'); frame.referrerPolicy = 'no-referrer';
    frame.addEventListener('error', () => { if (entry.panel.contains(frame)) notice(entry, 'This app could not load in the preview. Try reloading, or open it in your browser.'); });
    frame.src = entry.url; entry.panel.replaceChildren(frame);
  }
  async function load(entry) {
    const generation = entry.generation = (entry.generation || 0) + 1;
    if (!inspect) { mount(entry); return; }
    notice(entry, 'Checking local app…', true);
    try {
      const result = await inspect(entry.url);
      if (!entries.includes(entry) || entry.generation !== generation) return;
      if (result.state === 'ready') mount(entry);
      else notice(entry, result.message || 'This app cannot be previewed. Open it in your browser to continue.');
    } catch (error) {
      if (entries.includes(entry) && entry.generation === generation) notice(entry, error.message || 'The app preview could not be checked. Try reloading.');
    }
  }
  function open(value, trigger) {
    const url = localAppURL(value); if (!url) return false;
    origin = trigger;
    document.dispatchEvent(new window.Event('local-app-preview-open'));
    let entry = entries.find(item => item.url === url);
    if (!entry) {
      if (entries.length === 4) remove(entries[0].id);
      const id = 'local-app-' + ++counter, row = element('div', undefined, 'browser-tab');
      const button = element('button', new URL(url).host, 'quiet'); button.type = 'button'; button.id = id + '-tab'; button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', id); button.title = url;
      const panel = element('section', undefined, 'browser-panel'); panel.id = id; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', button.id);
      button.addEventListener('click', () => select(id));
      button.addEventListener('keydown', event => { if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) { event.preventDefault(); const at = entries.findIndex(item => item.id === id); const next = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : (at + (event.key === 'ArrowLeft' ? -1 : 1) + entries.length) % entries.length; select(entries[next].id); entries[next].button.focus(); } });
      row.append(button, tool('Close ' + new URL(url).host, 'x', () => remove(id))); tabs.append(row); frames.append(panel);
      entry = {id, url, row, button, panel}; entries.push(entry); void load(entry);
    }
    root.hidden = false; document.body.classList.add('local-browser-open'); select(entry.id); entry.button.focus({preventScroll:true}); return true;
  }
  root.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); close(true); } });
  return {element:root, open, close};
}
