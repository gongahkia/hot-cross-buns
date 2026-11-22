const examples = [
  ['Preferences', 'Response style', 'Keep answers concise, explain technical tradeoffs, and use a small example when it helps.', 'Active'],
  ['Preferences', 'Visual language', 'I like calm interfaces, warm neutrals, generous whitespace, and restrained animation.', 'Active'],
  ['Preferences', 'An older preference', 'For this week’s planning, keep suggestions within walking distance.', 'Needs review'],
  ['About you', 'What I do', 'I’m a software engineer working on small tools for everyday thinking.', 'Active'],
  ['About you', 'How I learn', 'I understand a new system best by tracing one concrete request from start to finish.', 'Active'],
  ['Personal context', 'A slower weekend', 'I’m trying to leave Sunday afternoons open for reading and cooking.', 'Active'],
  ['Personal context', 'A decision to remember', 'Start with a local web app. Revisit desktop packaging after the core workflow feels right.', 'Active'],
  ['Saved context', 'Writing checklist', 'Start with the main point.\nUse concrete verbs.\nKeep examples short.\nCall out uncertainty explicitly.', 'Saved'],
  ['Saved context', 'A note for later', 'Ideas for a quiet workspace\n\nA wide desk, a good reading lamp, and somewhere to leave an open notebook.', 'Saved'],
  ['Projects and goals', 'Local-first chat', 'Keep most of the engineering in the backend. The browser should stay a simple, readable interface.', 'Active'],
  ['Projects and goals', 'Prototype review notes', 'Review the composer, tool activity, rich output rendering, and memory controls before adding more navigation.', 'Saved'],
  ['Guidance', 'Explain before expanding', 'When a task has multiple possible approaches, recommend one and explain the material tradeoff.', 'Active'],
  ['Guidance', 'Possible response preference', 'The user may prefer a brief implementation summary after coding work. Await confirmation before applying this broadly.', 'Awaiting review'],
  ['Guidance', 'A paused convention', 'Always include a detailed checklist at the end of a response.', 'Disabled'],
  ['Guidance', 'A rejected suggestion', 'Use a playful tone in every technical explanation.', 'Rejected'],
];

export function createMemorySamples() {
  let entries, revision = 0;
  function reset() {
    const now = Date.now();
    entries = examples.map(([category, title, text, status], index) => ({
      id: `sample-${index + 1}`, kind: category === 'Guidance' ? 'guidance' : status === 'Saved' ? 'note' : 'memory',
      category, title, text, status,
      icon: { Preferences: 'lightbulb', 'About you': 'brain', 'Personal context': 'book-open', 'Saved context': 'notebook-pen', 'Projects and goals': 'workflow', Guidance: 'list-checks' }[category],
      scope: category === 'Projects and goals' ? 'Goal · Local-first chat' : 'Across chats',
      source: category === 'Guidance' ? 'Sample conversation feedback' : category === 'Saved context' ? 'Sample saved note' : 'From a sample chat · explicit user statement',
      conversation_id: category === 'Saved context' ? '' : 'sample-chat-01',
      updated_at: new Date(now - index * 86400000).toISOString(), revision: `sample-revision-${++revision}`,
      editable: category !== 'Guidance' && category !== 'Projects and goals',
    }));
  }
  reset();
  async function request({ action = 'list', id, revision: expected, text, memory_kind, query = '', category = '', page = 0 } = {}) {
    if (action === 'add') {
      if (!['fact', 'preference', 'note'].includes(memory_kind) || typeof text !== 'string' || !text.trim() || new TextEncoder().encode(text).length > 4096) throw new Error('Choose a type and enter up to 4096 bytes.');
      entries.unshift({ id: 'sample-new-' + ++revision, kind: 'memory', category: { fact: 'About you', preference: 'Preferences', note: 'Personal context' }[memory_kind],
        icon: { fact: 'brain', preference: 'lightbulb', note: 'notebook-pen' }[memory_kind], title: text.trim().split('\n')[0].slice(0, 90), text: text.trim(), status: 'Active',
        scope: 'Across chats', source: 'Added by you · Sample', updated_at: new Date().toISOString(), revision: 'sample-revision-' + revision, editable: true });
    } else if (action !== 'list') {
      if (!['correct', 'forget'].includes(action)) throw new Error('Choose a supported preview action.');
      const item = entries.find(entry => entry.id === id);
      if (!item || item.revision !== expected) throw new Error('This memory changed. Refresh and reopen it before trying again.');
      if (!item.editable) throw new Error('This sample uses its goal or guidance management controls.');
      if (action === 'forget') entries = entries.filter(entry => entry.id !== id);
      else {
        if (typeof text !== 'string' || !text.trim()) throw new Error('Enter some text for this memory.');
        item.text = text.trim(); item.revision = `sample-revision-${++revision}`; item.updated_at = new Date().toISOString();
        if (item.id.startsWith('sample-new-')) item.title = item.text.split('\n')[0].slice(0, 90);
      }
    }
    const categories = {};
    for (const entry of entries) categories[entry.category] = (categories[entry.category] || 0) + 1;
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const matches = entries.filter(entry => (!category || entry.category === category) && terms.every(term =>
      [entry.title, entry.text, entry.category, entry.scope, entry.source, entry.status].join(' ').toLowerCase().includes(term)));
    const pages = Math.max(1, Math.ceil(matches.length / 40));
    page = Math.min(Math.max(0, page), pages - 1);
    return { entries: structuredClone(matches.slice(page * 40, (page + 1) * 40)), categories, total: entries.length, matched: matches.length, page, pages };
  }
  return { request, reset };
}
