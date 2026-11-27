import { element } from './text.mjs';
import { taskBread } from './task-identity.mjs';
import { icon } from './icons.mjs';

export function chatMenu({ request, open, rename, tasksOnly = false, inactiveOnly = false, onSearch = () => {} }) {
  const container = element('div', undefined, 'chat-menu');
  const search = element('input'); search.type = 'search'; search.placeholder = tasksOnly ? 'Search tasks…' : 'Search history…'; search.maxLength = 512; search.setAttribute('aria-label', tasksOnly ? 'Search task conversations' : 'Search retained work');
  const searchHelp = element('p', 'Titles, folders, and indexed work messages. Other dialogue is not indexed.', 'hint chat-search-help'); searchHelp.hidden = true;
  const activitySummary = element('p', '', 'hint chat-activity-summary'); activitySummary.hidden = true; activitySummary.setAttribute('role', 'status');
  const root = element('div', undefined, 'chat-scroll');
  const list = element('nav'); list.id = 'chat-list'; list.setAttribute('aria-label', tasksOnly ? 'Task conversations' : 'Work history');
  const issue = element('p', undefined, 'hint chat-list-issue'); issue.setAttribute('role', 'status'); issue.hidden = true;
  const editor = element('form', undefined, 'chat-rename'); editor.hidden = true;
  root.append(list); container.append(search, searchHelp, activitySummary, root, issue, editor);
  let context, current, primary, next = '', busy = false, generation = 0, items = new Map(), query = '', timer;
  let activity = new Map(), activeIDs = new Set();
  function activityState() {
    let working = 0, waiting = 0;
    for (const [id, value] of activity) if (id !== current) {
      if (['Working', 'In progress', 'Stopping'].includes(value)) working++;
      if (['Needs review', 'Needs attention', 'Needs you', 'New update'].includes(value) || /updates$/.test(value)) waiting++;
    }
    activitySummary.textContent = [working ? `${working} working` : '', waiting ? `${waiting} needs you` : ''].filter(Boolean).join(' · '); activitySummary.hidden = !activitySummary.textContent;
    for (const wrapper of list.querySelectorAll('.chat-item')) {
      const value = activity.get(wrapper.dataset.chat), row = wrapper.querySelector('.chat-row');
      let badge = wrapper.querySelector('.chat-state');
      if (!value) { badge?.remove(); row.removeAttribute('aria-label'); continue; }
      if (!badge) { badge = element('span', '', 'chat-state'); row.prepend(badge); }
      const working = ['Working', 'In progress', 'Stopping'].includes(value);
      badge.replaceChildren(icon(working ? 'loader-circle' : ['Needs review', 'Needs attention', 'Needs you', 'Disconnected'].includes(value) ? 'circle-alert' : 'check'));
      badge.dataset.active = String(working); badge.title = value; badge.setAttribute('aria-hidden', 'true');
      row.setAttribute('aria-label', (items.get(wrapper.dataset.chat)?.title || 'Retained work') + ' · ' + value);
    }
  }
  const more = element('button', tasksOnly ? 'Load more tasks' : 'Load more history', 'quiet'); more.type = 'button';
  more.addEventListener('click', () => void load(context, false));
  function edges() {
    root.dataset.top = String(list.scrollTop > 2);
    root.dataset.bottom = String(list.scrollHeight - list.clientHeight - list.scrollTop > 2);
    // also expose edge state on the component for consumers inspecting it.
    container.dataset.top = root.dataset.top; container.dataset.bottom = root.dataset.bottom;
  }
  function edit(item, ownerContext) {
    const title = element('input'); title.value = item.title || ''; title.maxLength = 256; title.required = true; title.setAttribute('aria-label', 'Title');
    const save = element('button', 'Save', 'quiet'); save.type = 'submit';
    const cancel = element('button', 'Cancel', 'quiet'); cancel.type = 'button';
    const close = () => { editor.hidden = true; editor.replaceChildren(); };
    cancel.addEventListener('click', close);
    editor.replaceChildren(element('label', 'Rename record'), title, save, cancel); editor.hidden = false; title.focus(); title.select();
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
    const visible=[...items.values()].filter(item=>item.id!==primary && (!inactiveOnly || !activeIDs.has(item.id)));
    list.replaceChildren(...visible.map(item => {
      const wrapper = element('div', undefined, 'chat-item');
      wrapper.dataset.chat = item.id;
      const row = element('button', undefined, 'quiet chat-row'); row.type = 'button';
      if (tasksOnly) { const bread = element('span', taskBread(item.id, item.task_emoji), 'task-bread'); bread.setAttribute('aria-hidden', 'true'); row.append(bread); }
      if (item.pinned) row.append(icon('bookmark'));
      const text = element('span'); text.append(element('span', item.title || 'Retained work', 'chat-title'));
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
        change.setAttribute('aria-label', 'Rename ' + (item.title || 'Retained work')); change.title = 'Rename record';
        change.addEventListener('click', () => edit(item, ownerContext)); wrapper.append(change);
      }
      return wrapper;
    }));
    if (!visible.length) list.append(element('p', inactiveOnly ? (query ? 'No matching past tasks.' : 'No past tasks.') : query ? (tasksOnly ? 'No matching tasks.' : 'No matching history.') : (tasksOnly ? 'Tasks I work on for you will appear here.' : 'No earlier work yet.'), 'hint'));
    if (next) list.append(more);
    list.scrollTop = position; edges(); activityState();
  }
  async function load(value, reset = true) {
    if (!value || busy && value === context && !reset) return;
    if (value !== context) { context = value; generation++; reset = true; editor.hidden = true; }
    if (reset) { items = new Map(); next = ''; list.scrollTop = 0; render(); }
    const owned = ++generation, text = query;
    busy = true; list.setAttribute('aria-busy', 'true'); more.disabled = true; issue.hidden = true;
    try {
      const page = await request({ context: value, after: next, query: text, ...(tasksOnly ? { tasksOnly: true } : {}) });
      if (owned !== generation) return;
      for (const item of page.items) items.set(item.id, item);
      next = page.next || ''; render();
      if (page.incomplete || page.skipped) { issue.textContent = 'Some history could not be read. Refresh to retry.'; issue.hidden = false; }
    } catch (error) {
      if (owned === generation) { issue.textContent = error.message; issue.hidden = false; }
    } finally {
      if (owned === generation) { busy = false; list.removeAttribute('aria-busy'); more.disabled = false; edges(); }
    }
  }
  search.addEventListener('input', () => {
    clearTimeout(timer); generation++; query = search.value.trim(); editor.hidden = true; searchHelp.hidden = !query;
    // immediately retire old selections while the debounced query is pending.
    items.clear(); next = ''; render(); onSearch(query);
    timer = setTimeout(() => void load(context), 180);
  });
  list.addEventListener('scroll', () => {
    edges();
    if (next && list.scrollHeight - list.clientHeight - list.scrollTop < 70) void load(context, false);
  }, { passive: true });
  if (globalThis.ResizeObserver) new ResizeObserver(edges).observe(list);
  return { element: container, search, get query() { return query; }, load, updateActivity(values = [], tasks = []) {
    const nextActive = new Set(tasks.filter(task => task.active).map(task => task.id));
    const changed = nextActive.size !== activeIDs.size || [...nextActive].some(id => !activeIDs.has(id));
    activeIDs = nextActive;
    activity = new Map(values.map(value => [value.id, value.status]));
    const labels = { running: 'In progress', waiting: 'Needs you', stopping: 'Stopping', failed: 'Needs attention', disconnected: 'Disconnected', queued: 'Queued' };
    for (const task of tasks) if (labels[task.state] && !activity.has(task.id)) activity.set(task.id, labels[task.state]);
    if (inactiveOnly && changed) render(); else activityState();
  }, updateCurrent(id, main) { if (current !== id || primary !== main) { current = id; primary = main; render(); } } };
}
