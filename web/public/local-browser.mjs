import { element } from './text.mjs';
import { icon } from './icons.mjs';
import { localAppURL } from './local-url.mjs';
import { previewContent } from './attachments.mjs';

export function localBrowser({ inspect } = {}) {
  const root = element('aside', undefined, 'local-browser'); root.hidden = true; root.setAttribute('aria-label', 'Files and apps');
  const tabs = element('div', undefined, 'browser-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Files and apps');
  const toolbar = element('div', undefined, 'browser-toolbar');
  const address = element('input'); address.type = 'url'; address.setAttribute('aria-label', 'Local app address'); address.readOnly = true;
  function tool(label, name, action) { const node = element('button', undefined, 'quiet icon-button'); node.type = 'button'; node.title = label; node.setAttribute('aria-label', label); node.append(icon(name)); node.addEventListener('click', action); return node; }
  const external = element('a', undefined, 'quiet icon-button'); external.target = '_blank'; external.rel = 'noopener noreferrer'; external.title = 'Open in browser'; external.setAttribute('aria-label', 'Open in browser'); external.append(icon('external-link'));
  const frames = element('div', undefined, 'browser-frames');
  const reload = tool('Reload local app', 'refresh-cw', () => { const tab = entries.find(item => item.id === selected); if (tab) void load(tab); });
  const download = tool('Download file', 'download', () => { const tab = entries.find(item => item.id === selected); if (tab?.download) tab.download(); });
  toolbar.append(reload, address, external, download, tool('Close preview', 'x', () => close(true))); root.append(tabs, toolbar, frames);
  let entries = [], selected, counter = 0, origin;
  function select(id) {
    selected = id;
    for (const entry of entries) {
      const active = entry.id === id; entry.button.setAttribute('aria-selected', String(active)); entry.button.tabIndex = active ? 0 : -1; entry.panel.hidden = !active;
      if (active) {
        const file = entry.kind === 'file'; address.value = file ? entry.title : entry.url;
        address.type = file ? 'text' : 'url'; address.setAttribute('aria-label', file ? 'File name' : 'Local app address');
        external.hidden = file; if (!file) external.href = entry.url; else external.removeAttribute('href');
        download.hidden = !entry.download;
        reload.title = file ? 'Reload file' : 'Reload local app'; reload.setAttribute('aria-label', reload.title);
      }
    }
  }
  function remove(id) {
    const index = entries.findIndex(entry => entry.id === id); if (index < 0) return;
    const [entry] = entries.splice(index, 1); entry.row.remove(); entry.panel.remove();
    if (!entries.length) { close(true); return; }
    if (selected === id) select(entries[Math.min(index, entries.length - 1)].id);
    entries.find(item => item.id === selected)?.button.focus();
  }
  function close(restoreFocus = false) {
    for (const entry of entries) entry.panel.remove(); entries = []; tabs.replaceChildren(); root.hidden = true; document.body.classList.remove('local-browser-open');
    if (restoreFocus) {
      const target = origin?.isConnected && !origin.closest('dialog:not([open]), [hidden]') ? origin : document.getElementById('message');
      target?.focus({preventScroll:true});
    }
    origin = undefined;
  }
  function closeFiles() { for (const entry of [...entries]) if (entry.kind === 'file') remove(entry.id); }
  function add(title, key, kind) {
    if (entries.length === 4) remove(entries[0].id);
    const id = 'preview-' + ++counter, row = element('div', undefined, 'browser-tab');
    const button = element('button', title, 'quiet'); button.type = 'button'; button.id = id + '-tab'; button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', id); button.title = title;
    const panel = element('section', undefined, 'browser-panel'); panel.id = id; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', button.id);
    button.addEventListener('click', () => select(id));
    button.addEventListener('keydown', event => { if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) { event.preventDefault(); const at = entries.findIndex(item => item.id === id); const next = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : (at + (event.key === 'ArrowLeft' ? -1 : 1) + entries.length) % entries.length; select(entries[next].id); entries[next].button.focus(); } });
    row.append(button, tool('Close ' + title, 'x', () => remove(id))); tabs.append(row); frames.append(panel);
    const entry = { id, title, key, kind, row, button, panel, page: 1 }; entries.push(entry); return entry;
  }
  function reveal(entry, trigger, focus = true) {
    origin = trigger;
    root.hidden = false; document.body.classList.add('local-browser-open'); select(entry.id);
    if (focus) entry.button.focus({preventScroll:true});
  }
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
    if (entry.kind === 'file') {
      entry.panel.setAttribute('aria-busy', 'true');
      entry.panel.replaceChildren(element('p', 'Loading preview…', 'hint'));
      try {
        const view = await entry.load(entry.page);
        if (!entries.includes(entry) || entry.generation !== generation) return;
        const tools = element('div', undefined, 'preview-actions');
        if (view.kind === 'pdf') {
          entry.page = view.page;
          const previous = tool('Previous page', 'chevron-left', () => { entry.page--; void load(entry); });
          const next = tool('Next page', 'chevron-right', () => { entry.page++; void load(entry); });
          previous.disabled = entry.page <= 1; next.disabled = entry.page >= view.pages;
          tools.append(previous, element('span', 'Page ' + entry.page + ' of ' + view.pages, 'hint'), next);
        }
        if (entry.edit && view.kind === 'text' && !view.truncated) {
          const edit = element('button', 'Open in Canvas', 'quiet'); edit.type = 'button'; edit.onclick = () => entry.edit(view); tools.append(edit);
        }
        entry.panel.replaceChildren(tools, previewContent(view));
      } catch (error) {
        if (!entries.includes(entry) || entry.generation !== generation) return;
        const message = element('p', error.message || 'The file could not be loaded. Reload to try again.', 'issue'); message.setAttribute('role', 'alert'); entry.panel.replaceChildren(message);
      } finally { if (entry.generation === generation) entry.panel.removeAttribute('aria-busy'); }
      return;
    }
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
    document.dispatchEvent(new window.Event('local-app-preview-open'));
    let entry = entries.find(item => item.kind === 'app' && item.url === url);
    if (!entry) {
      entry = add(new URL(url).host, url, 'app'); entry.url = url; entry.button.title = url; void load(entry);
    }
    reveal(entry, trigger); return true;
  }
  function openFile({ key, name, load: read, download, edit, trigger, focus = true }) {
    document.dispatchEvent(new window.Event('local-file-preview-open'));
    let entry = entries.find(item => item.kind === 'file' && item.key === key);
    if (!entry) entry = add(name, key, 'file');
    Object.assign(entry, { load: read, download, edit }); entry.panel.classList.add('browser-file');
    void load(entry); reveal(entry, trigger, focus);
  }
  root.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); close(true); } });
  return {element:root, open, openFile, closeFiles, close};
}
