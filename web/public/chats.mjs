import { element } from './text.mjs';
import { icon } from './icons.mjs';

export function chatMenu({ request, open, rename }) {
  const container = element('div', undefined, 'chat-menu');
  const search = element('input'); search.type = 'search'; search.placeholder = 'Search chats…'; search.maxLength = 512; search.setAttribute('aria-label', 'Search retained chats');
  const searchHelp = element('p', 'Titles, folders, and indexed work messages. Other dialogue is not indexed.', 'hint chat-search-help'); searchHelp.hidden = true;
  const root = element('div', undefined, 'chat-scroll');
  const list = element('nav'); list.id = 'chat-list'; list.setAttribute('aria-label', 'All chats');
  const issue = element('p', undefined, 'hint chat-list-issue'); issue.setAttribute('role', 'status'); issue.hidden = true;
  const editor = element('form', undefined, 'chat-rename'); editor.hidden = true;
  root.append(list); container.append(search, searchHelp, root, issue, editor);
  let context, current, next = '', busy = false, generation = 0, items = new Map(), query = '', timer;
  const more = element('button', 'Load more chats', 'quiet'); more.type = 'button';
  more.addEventListener('click', () => void load(context, false));
  function edges() {
    root.dataset.top = String(list.scrollTop > 2);
    root.dataset.bottom = String(list.scrollHeight - list.clientHeight - list.scrollTop > 2);
    // also expose edge state on the component for consumers inspecting it.
    container.dataset.top = root.dataset.top; container.dataset.bottom = root.dataset.bottom;
  }
  function edit(item, ownerContext) {
    const title = element('input'); title.value = item.title || ''; title.maxLength = 256; title.required = true; title.setAttribute('aria-label', 'Chat title');
    const save = element('button', 'Save', 'quiet'); save.type = 'submit';
    const cancel = element('button', 'Cancel', 'quiet'); cancel.type = 'button';
    const close = () => { editor.hidden = true; editor.replaceChildren(); };
    cancel.addEventListener('click', close);
    editor.replaceChildren(element('label', 'Rename chat'), title, save, cancel); editor.hidden = false; title.focus(); title.select();
    editor.onsubmit = async event => {
      event.preventDefault(); if (!title.reportValidity()) return;
      save.disabled = true; cancel.disabled = true; issue.hidden = true;
      try {
        await rename({ context: ownerContext, selection: item.selection, title: title.value });
        close(); await load(ownerContext);
      } catch (error) { issue.textContent = error.message; issue.hidden = false; }
      finally { save.disabled = false; cancel.disabled = false; }
    };
    editor.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } };
  }
  function render() {
    const position = list.scrollTop, ownerContext = context;
    list.replaceChildren(...[...items.values()].map(item => {
      const wrapper = element('div', undefined, 'chat-item');
      const row = element('button', undefined, 'quiet chat-row'); row.type = 'button';
      if (item.pinned) row.append(icon('bookmark'));
      const text = element('span'); text.append(element('span', item.title || 'New chat', 'chat-title'));
      if (query && item.snippet) text.append(element('small', item.snippet, 'chat-snippet hint'));
      row.append(text);
      if (item.archived) row.append(element('small', 'Archived', 'hint'));
      if (item.id === current) { row.classList.add('picked'); row.setAttribute('aria-current', 'page'); }
      row.addEventListener('click', async () => {
        row.disabled = true;
        try { await open({ context: ownerContext, selection: item.selection }); }
        catch (error) { issue.textContent = error.message; issue.hidden = false; }
        finally { row.disabled = false; }
      });
      wrapper.append(row);
      if (rename) {
        const change = element('button', undefined, 'quiet icon-button rename-chat'); change.type = 'button'; change.append(icon('pencil'));
        change.setAttribute('aria-label', 'Rename ' + (item.title || 'New chat')); change.title = 'Rename chat';
        change.addEventListener('click', () => edit(item, ownerContext)); wrapper.append(change);
      }
      return wrapper;
    }));
    if (!items.size) list.append(element('p', query ? 'No matching chats.' : 'No chats yet.', 'hint'));
    if (next) list.append(more);
    list.scrollTop = position; edges();
  }
  async function load(value, reset = true) {
    if (!value || busy && value === context && !reset) return;
    if (value !== context) { context = value; generation++; reset = true; editor.hidden = true; }
    if (reset) { items = new Map(); next = ''; list.scrollTop = 0; render(); }
    const owned = ++generation, text = query;
    busy = true; list.setAttribute('aria-busy', 'true'); more.disabled = true; issue.hidden = true;
    try {
      const page = await request({ context: value, after: next, query: text });
      if (owned !== generation) return;
      for (const item of page.items) items.set(item.id, item);
      next = page.next || ''; render();
      if (page.incomplete || page.skipped) { issue.textContent = 'Some retained chats could not be read. Refresh to retry.'; issue.hidden = false; }
    } catch (error) {
      if (owned === generation) { issue.textContent = error.message; issue.hidden = false; }
    } finally {
      if (owned === generation) { busy = false; list.removeAttribute('aria-busy'); more.disabled = false; edges(); }
    }
  }
  search.addEventListener('input', () => {
    clearTimeout(timer); generation++; query = search.value.trim(); editor.hidden = true; searchHelp.hidden = !query;
    // immediately retire old selections while the debounced query is pending.
    items.clear(); next = ''; render();
    timer = setTimeout(() => void load(context), 180);
  });
  list.addEventListener('scroll', () => {
    edges();
    if (next && list.scrollHeight - list.clientHeight - list.scrollTop < 70) void load(context, false);
  }, { passive: true });
  if (globalThis.ResizeObserver) new ResizeObserver(edges).observe(list);
  return { element: container, load, updateCurrent(id) { if (current !== id) { current = id; render(); } } };
}
