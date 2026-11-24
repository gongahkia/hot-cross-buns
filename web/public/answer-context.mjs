import { element } from './text.mjs';

export function answerContextRun(message) {
  const result = message.result;
  // Older transcripts retained the host-generated link as a command footer.
  const legacy = result?.title === 'Context and sources' ? /^\/context ([a-zA-Z0-9][a-zA-Z0-9_-]{0,95})(?:\s|$)/.exec(result.footer || '')?.[1] : undefined;
  return result?.context_run_id || message.bundle?.RunID || message.run_id || legacy;
}

export function answerContextView({ request, current = () => true }) {
  const root = element('div', undefined, 'answer-context');
  function render(value) {
    root.replaceChildren();
    const context = value.context;
    if (context?.Outcome) root.append(element('p', context.Outcome));
    const facts = element('dl', undefined, 'context-facts');
    for (const [label, text] of [['Permission', context?.Permission], ['Recall', context?.Recall], ['Usage', context?.Usage]]) {
      if (text) facts.append(element('dt', label), element('dd', text));
    }
    if (facts.children.length) root.append(facts);
    root.append(element('h3', 'Saved context'));
    if (value.context_error) root.append(element('p', value.context_error, 'issue'));
    else if (!context?.Items?.length) root.append(element('p', 'No saved context was recorded for this answer.', 'hint'));
    for (const item of context?.Items || []) {
      const section = element('section', undefined, 'context-entry');
      section.append(element('h4', item.Title || item.Kind || 'Saved context'));
      const metadata = [item.Scope, item.Source, item.Updated].filter(Boolean).join(' · ');
      if (metadata) section.append(element('p', metadata, 'hint'));
      section.append(element('p', item.Text || 'No excerpt was retained.', 'context-excerpt'));
      if (item.UnavailableReason) section.append(element('p', item.UnavailableReason, 'hint'));
      root.append(section);
    }
    root.append(element('h3', 'Sources'));
    if (value.sources_error) root.append(element('p', value.sources_error, 'issue'));
    else if (!value.references?.length) root.append(element('p', 'No source excerpts were retained for this answer.', 'hint'));
    for (const reference of value.references || []) {
      const section = element('section', undefined, 'context-entry');
      section.append(element('h4', reference.label || 'Retained source'), element('p', reference.locator, 'hint'));
      const preview = reference.preview;
      if (preview) {
        if (preview.notice) section.append(element('p', preview.notice, 'hint'));
        section.append(element('pre', preview.observed_preview || preview.text, 'source-excerpt'));
        if (preview.truncated) section.append(element('p', `Excerpt shown · starting at line ${preview.firstLine} of ${preview.totalLines}.`, 'hint'));
      } else section.append(element('p', reference.error || 'No text excerpt was retained.', 'hint'));
      root.append(section);
    }
    if (value.truncated) root.append(element('p', 'This answer exceeds the retained source list limit; additional references are omitted.', 'hint'));
  }
  async function load() {
    root.setAttribute('aria-busy', 'true');
    const status = element('p', 'Loading context and sources…', 'hint'); status.setAttribute('role', 'status');
    root.replaceChildren(status);
    try {
      const value = await request();
      if (current()) render(value);
    } catch (error) {
      if (!current()) return;
      const note = element('p', error.message, 'issue'); note.setAttribute('role', 'alert');
      const retry = element('button', 'Retry', 'quiet'); retry.type = 'button'; retry.onclick = () => void load();
      root.replaceChildren(note, retry);
    } finally { root.removeAttribute('aria-busy'); }
  }
  return { element: root, load };
}
