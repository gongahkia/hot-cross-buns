import { element } from './text.mjs';
import { icon } from './icons.mjs';

const categories = ['Preferences', 'About you', 'Personal context', 'Saved context', 'Projects and goals', 'Guidance'];
const topicIcons = { Preferences: 'lightbulb', 'About you': 'brain', 'Personal context': 'book-open', 'Saved context': 'notebook-pen', 'Projects and goals': 'workflow', Guidance: 'list-checks' };
const topicDescriptions = {
  Preferences: 'How you like things: your style, habits, and preferences.',
  'About you': 'Facts you have shared about yourself.',
  'Personal context': 'Decisions and useful context you have chosen to keep.',
  'Saved context': 'Saved notes and reference material. These are separate from personal facts.',
  'Projects and goals': 'Context scoped to a project or responsibility. Manage it with that goal.',
  Guidance: 'Learned instructions. Suggestions awaiting review are not active guidance.',
};
function button(label, action, className = 'quiet') {
  const node = element('button', label, className);
  node.type = 'button'; node.addEventListener('click', action); return node;
}
function date(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
export function memoryPane({ request, manage, description = 'Facts and preferences saved for future chats. Notes, project context, and guidance are kept in their own sections.', initialCategory = 'Preferences', sections = categories, canAdd = true }) {
  const root = element('section', undefined, 'memory-pane-content');
  root.append(element('p', description, 'hint'));
  const form = element('form', undefined, 'memory-search');
  const search = element('input');
  search.type = 'search'; search.placeholder = 'Search this section…'; search.setAttribute('aria-label', 'Search memory');
  const submit = element('button', 'Search', 'quiet'); submit.type = 'submit';
  form.append(search, submit);
  const tools = element('div', undefined, 'memory-tools');
  const add = button('Add memory', () => { creation.hidden = !creation.hidden; if (!creation.hidden) creation.querySelector('textarea').focus(); }); add.prepend(icon('plus'));
  tools.append(add, button('Memory & privacy', () => manage('/memory')), button('Refresh', () => void load()));
  const creation = element('form', undefined, 'memory-create'); creation.hidden = true;
  const type = element('select'); type.setAttribute('aria-label', 'Memory type');
  for (const [value, label] of [['fact', 'About you'], ['preference', 'Preference'], ['note', 'Personal context']]) {
    const option = element('option', label); option.value = value; type.append(option);
  }
  const newText = element('textarea'); newText.rows = 3; newText.maxLength = 4096; newText.required = true; newText.placeholder = 'What would you like me to remember?'; newText.setAttribute('aria-label', 'New memory');
  const save = element('button', 'Save memory', 'send'); save.type = 'submit';
  creation.append(element('h3', 'Add a memory'), type, newText, save, button('Cancel', () => { creation.hidden = true; }));
  add.hidden = !canAdd;
  const warning = element('div', undefined, 'memory-warnings'); warning.setAttribute('role', 'status');
  const error = element('p', undefined, 'issue'); error.setAttribute('role', 'alert'); error.hidden = true;
  const layout = element('div', undefined, 'memory-layout');
  const nav = element('nav', undefined, 'memory-topics'); nav.setAttribute('aria-label', 'Memory topics');
  const content = element('div', undefined, 'memory-content');
  const list = element('div');
  const pages = element('div', undefined, 'memory-pagination');
  content.append(list, pages); layout.append(nav, content);
  root.append(form, tools, creation, warning, error, layout);
  let catalog, category = initialCategory, page = 0, busy = false, initialized = false;
  async function perform(operation) {
    if (busy) return;
    busy = true; error.hidden = true;
    root.setAttribute('aria-busy', 'true');
    for (const node of root.querySelectorAll('button, input, textarea')) node.disabled = true;
    try { await operation(); }
    catch (issue) { error.textContent = issue.message; error.hidden = false; }
    finally {
      busy = false; root.removeAttribute('aria-busy');
      for (const node of root.querySelectorAll('button, input, textarea')) node.disabled = node.dataset.unavailable === 'true';
    }
  }
  const params = () => ({ query: search.value.trim(), category, page });
  async function load() {
    await perform(async () => {
      catalog = await request({ action: 'list', ...params() });
      if (!initialized && catalog.total && !catalog.categories[category]) {
        category = sections.find(name => catalog.categories[name]) || category;
        catalog = await request({ action: 'list', ...params() });
      }
      initialized = true; render();
    });
  }
  function render() {
    page = catalog.page;
    nav.replaceChildren(...sections.map(name => {
      const choice = button(name === 'Saved context' ? 'Saved notes' : name === 'Projects and goals' ? 'Project context' : name, () => { category = name; page = 0; void load(); });
      choice.setAttribute('aria-current', String(name === category));
      choice.prepend(icon(topicIcons[name]));
      choice.append(element('span', String(catalog.categories[name] || 0), 'memory-count'));
      choice.title = topicDescriptions[name];
      return choice;
    }));
    if (sections.length > 3) nav.children[3].before(element('p', 'Related context', 'hint memory-nav-label'));
    nav.hidden = sections.length === 1;
    layout.classList.toggle('single-section', sections.length === 1);
    warning.replaceChildren(...(catalog.warnings || []).map(text => element('p', text, 'hint')));
    list.replaceChildren();
    const categoryTitle = category === 'Saved context' ? 'Saved notes' : category === 'Projects and goals' ? 'Project context' : category;
    list.append(element('h3', categoryTitle), element('p', topicDescriptions[category], 'hint memory-category-description'));
    if (!catalog.entries.length) list.append(element('p', search.value ? 'No matching items in this section.' : canAdd ? 'Nothing here yet. Use Add memory to save a fact, preference, or personal note.' : 'No saved notes yet. Ask me to save useful reference material from a conversation.', 'memory-empty hint'));
    for (const name of categories) {
      const entries = catalog.entries.filter(topic => topic.category === name);
      if (!entries.length) continue;
      const section = element('section', undefined, 'memory-section');
      for (const topic of entries) section.append(topicView(topic));
      list.append(section);
    }
    pages.replaceChildren();
    if (catalog.pages > 1) {
      const previous = button('Previous', () => { page--; void load(); });
      const next = button('Next', () => { page++; void load(); });
      previous.dataset.unavailable = String(page === 0); next.dataset.unavailable = String(page + 1 >= catalog.pages);
      pages.append(previous, element('span', `${page + 1} / ${catalog.pages} · ${catalog.matched} topics`, 'hint'), next);
    }
  }
  function topicView(topic) {
    const node = element('details', undefined, 'memory-topic');
    const summary = element('summary');
    const heading = element('span', undefined, 'memory-topic-heading');
    const derivedTitle = /^(Fact|Preference|Note|Decision)$/i.test(topic.title);
    const title = derivedTitle ? topic.text.split('\n')[0].slice(0, 90) : topic.title;
    heading.append(element('span', title, 'memory-topic-title'));
    if (!derivedTitle && title !== topic.text) heading.append(element('span', topic.text.slice(0, 100), 'memory-excerpt'));
    if (!['Active', 'Saved'].includes(topic.status)) heading.append(element('small', topic.status, 'memory-status'));
    const chevron = icon('chevron-right'); chevron.classList.add('disclosure-icon');
    summary.append(icon(topic.icon || topicIcons[topic.category]), heading, chevron);
    const body = element('div', undefined, 'memory-topic-body');
    const text = element('p', topic.text, 'memory-text');
    text.hidden = title === topic.text;
    const source = element('details', undefined, 'memory-source');
    source.append(element('summary', 'Source details'));
    for (const [label, value] of [['Source', topic.source], ['Updated', date(topic.updated_at)], ['Source chat', topic.conversation_id], ['Record', topic.id]]) if (value) source.append(element('p', label + ' · ' + value));
    const actions = element('div', undefined, 'memory-controls');
    if (topic.editable) {
      const editButton = button('Edit', edit), forgetButton = button('Forget', forget);
      editButton.prepend(icon('pencil')); forgetButton.prepend(icon('trash-2'));
      actions.append(editButton, forgetButton);
    } else if (topic.kind === 'guidance') actions.append(button('Manage guidance', () => manage('/learnings')));
    else actions.append(button('Manage goal', () => manage('/goals')));
    body.append(text, source, actions); node.append(summary, body);
    function edit() {
      const label = element('label', 'Saved memory');
      const input = element('textarea'); input.value = topic.text; input.rows = 5; input.maxLength = topic.kind === 'note' ? 65536 : 4096; label.append(input);
      const controls = element('div', undefined, 'memory-controls');
      controls.append(button('Save', () => void change('correct', input.value)), button('Cancel', () => { label.replaceWith(text); controls.replaceWith(actions); }));
      text.replaceWith(label); actions.replaceWith(controls); input.focus();
    }
    function forget() {
      const confirm = element('div', undefined, 'memory-forget');
      confirm.append(element('p', 'Remove this item from future recall? Original chat messages remain.', 'hint'), button('Forget memory', () => void change('forget')), button('Cancel', () => confirm.replaceWith(actions)));
      actions.replaceWith(confirm);
    }
    async function change(action, text = '') {
      await perform(async () => {
        catalog = await request({ action, id: topic.id, revision: topic.revision, text, ...params() });
        render();
      });
    }
    return node;
  }
  form.addEventListener('submit', event => { event.preventDefault(); page = 0; void load(); });
  creation.addEventListener('submit', event => {
    event.preventDefault();
    void perform(async () => {
      const nextCategory = { fact: 'About you', preference: 'Preferences', note: 'Personal context' }[type.value];
      const result = await request({ action: 'add', memory_kind: type.value, text: newText.value, query: '', category: nextCategory, page: 0 });
      category = nextCategory; search.value = ''; page = 0; catalog = result;
      creation.hidden = true; newText.value = ''; render();
    });
  });
  return { element: root, load };
}
