import { element } from './text.mjs';
import { icon } from './icons.mjs';
import { brandIcon } from './brands.mjs';

export function answerContextRun(message) {
  const result = message.result;
  // Older transcripts retained the host-generated link as a command footer.
  const legacy = result?.title === 'Context and sources' ? /^\/context ([a-zA-Z0-9][a-zA-Z0-9_-]{0,95})(?:\s|$)/.exec(result.footer || '')?.[1] : undefined;
  return result?.context_run_id || message.bundle?.RunID || message.run_id || legacy;
}
function sourceURL(reference) {
  try {
    const url = new URL(reference.original_url || reference.locator);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url : null;
  } catch { return null; }
}
function sourceMark(reference) {
  const url = sourceURL(reference);
  if (!url) return icon(reference.kind === 'knowledge' ? 'brain' : reference.kind === 'connected' ? 'link' : 'file-text');
  const host = url.hostname.toLowerCase();
  const brand = [['github.com','github'],['gitlab.com','gitlab'],['notion.so','notion'],['notion.site','notion'],['slack.com','slack']].find(([domain]) => host === domain || host.endsWith('.' + domain));
  if (brand) return brandIcon(brand[1], 'globe');
  const mark = element('span', undefined, 'source-site-icon'), fallback = icon('globe'); mark.append(fallback);
  // Never send private/local source hosts to a favicon service. Anonymous
  // requests go directly to public sites, with a local Lucide fallback.
  if (host.includes('.') && !/^[\d.]+$/.test(host) && !host.endsWith('.local') && !host.endsWith('.internal') && !host.endsWith('.localhost')) {
    const image = element('img'); image.hidden = true; image.alt = ''; image.width = 16; image.height = 16;
    image.crossOrigin = 'anonymous'; image.setAttribute('referrerpolicy', 'no-referrer'); image.loading = 'lazy'; image.decoding = 'async';
    image.addEventListener('load', () => { fallback.setAttribute('hidden', ''); image.hidden = false; });
    image.addEventListener('error', () => image.remove(), { once: true });
    image.src = url.origin + '/favicon.ico'; mark.append(image);
  }
  return mark;
}
function contextKind(item) {
  if (['memory','fact','preference','personal'].includes(item.Kind)) return ['Memory','brain'];
  if (item.Kind === 'note') return ['Saved notes','bookmark'];
  if (['learning','guidance','guide'].includes(item.Kind)) return ['Guidance','lightbulb'];
  if (['goal','project'].includes(item.Kind)) return ['Project context','workflow'];
  if (item.Kind === 'update') return ['Updates','clock'];
  return ['Saved context','book-open'];
}
export function sourceChip({ request, open, current = () => true }) {
  const button = element('button', undefined, 'source-chip'); button.type = 'button';
  button.setAttribute('aria-label', 'View sources'); button.append(icon('book-open'), element('span', 'Sources'));
  button.addEventListener('click', open);
  let loaded = false, disposed = false, observer;
  async function load() {
    if (loaded || disposed) return;
    loaded = true;
    try {
      const value = await request();
      if (disposed || !current()) return;
      const marks = element('span', undefined, 'source-chip-marks'), seen = new Set();
      const references = value.references || [], items = value.context?.Items || [];
      for (const reference of references) {
        const url = sourceURL(reference), key = url?.hostname || reference.kind || 'file';
        if (seen.has(key)) continue;
        seen.add(key); if (marks.children.length < 3) marks.append(sourceMark(reference));
      }
      const kinds = new Set(items.map(item => contextKind(item)[0]));
      if (kinds.has('Memory') && !seen.has('knowledge') && marks.children.length < 3) marks.append(icon('brain'));
      if (!marks.children.length && kinds.size) marks.append(icon(contextKind(items[0])[1]));
      const label = !references.length && kinds.size === 1 ? [...kinds][0] : 'Sources';
      button.hidden = !references.length && !items.length && !value.context_error && !value.sources_error;
      button.replaceChildren(marks.children.length ? marks : icon('book-open'), element('span', label));
      button.setAttribute('aria-label', 'View ' + label.toLowerCase());
    } catch { /* the button still opens the fresh source view and its retry state */ }
  }
  if (globalThis.IntersectionObserver) {
    observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); void load(); } }, { rootMargin: '200px' });
    observer.observe(button);
  } else void load();
  return { element: button, load, dispose() { disposed = true; observer?.disconnect(); } };
}
function readableCapture(preview) {
  const text = preview.observed_preview || preview.text || '';
  if (/^\s*[\[{]/.test(text)) {
    try {
      const data = JSON.parse(text), record = data.metadata || data;
      const plain = value => typeof value === 'string' ? value : Array.isArray(value) ? value.filter(item => typeof item === 'string').join(', ') : typeof value?.value === 'string' ? value.value : '';
      const title = plain(record.title || record.name);
      const parts = ['title','name','creator','author','description','abstract','summary','excerpt','text'].map(key => plain(record[key])).filter(Boolean);
      return { title, text: [...new Set(parts)].join(' · ') || 'Structured source data was retained. Expand Capture details to inspect it.', raw: text, format: 'JSON' };
    } catch { /* ordinary text beginning with a bracket is kept verbatim */ }
  }
  if (!/^\s*(?:<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>])/i.test(text)) return { text };
  // template content is inert: captured markup never joins the live document.
  const capture = document.createElement('template'); capture.innerHTML = text;
  const title = capture.content.querySelector('title')?.textContent?.trim();
  for (const node of capture.content.querySelectorAll('head,script,style,noscript,template,svg,iframe,nav,header,footer,form')) node.remove();
  const body = capture.content.querySelector('main,article') || capture.content;
  for (const node of body.querySelectorAll('p,div,li,h1,h2,h3,h4,br,tr,section')) node.append(document.createTextNode(' '));
  return { title, text: body.textContent.replace(/\s+/g, ' ').trim() || 'No readable text was retained in this capture.', raw: text, format: 'HTML' };
}
function excerpt(section, text) {
  const value = String(text || 'No excerpt was retained.');
  const chars = Array.from(value);
  section.append(element('p', chars.length > 360 ? chars.slice(0, 320).join('') + '…' : value, 'context-excerpt'));
  if (chars.length > 360) {
    const full = element('details', undefined, 'source-full-excerpt');
    full.append(element('summary', 'Full excerpt'), element('pre', value, 'source-excerpt')); section.append(full);
  }
}
export function answerContextView({ request, current = () => true, openFile }) {
  const root = element('div', undefined, 'answer-context');
  function render(value) {
    root.replaceChildren();
    const context = value.context, groups = new Map();
    function group(name, mark) {
      if (!groups.has(name)) {
        const section = element('section', undefined, 'context-source-group'), heading = element('h3');
        heading.append(icon(mark), document.createTextNode(name)); section.append(heading); groups.set(name, section); root.append(section);
      }
      return groups.get(name);
    }
    for (const item of context?.Items || []) {
      const [name, mark] = contextKind(item), section = element('section', undefined, 'context-entry');
      const title = item.Title === 'fact' ? 'About you' : item.Title === 'preference' ? 'Preference' : (item.Title || item.Kind || 'Saved context').replace(/^(fact|preference|memory)\s*·\s*/i, '').replaceAll('_', ' ');
      section.append(element('h4', title)); excerpt(section, item.Text);
      if (item.UnavailableReason) section.append(element('p', item.UnavailableReason, 'hint'));
      group(name, mark).append(section);
    }
    if (value.context_error) root.append(element('p', value.context_error, 'issue'));
    if (!context?.Items?.length && !value.context_error && !value.references?.length) root.append(element('p', 'No saved context was recorded for this answer.', 'hint'));
    for (const reference of value.references || []) {
      const url = sourceURL(reference), section = element('section', undefined, 'context-entry');
      const preview = reference.preview, capture = preview && readableCapture(preview);
      const head = element('div', undefined, 'context-source-heading');
      const file = openFile && ['file','attachment'].includes(reference.kind);
      const title = url ? element('a', capture?.title || reference.label || url.hostname) : element(file ? 'button' : 'span', reference.label || 'Retained source', file ? 'file-reference' : undefined);
      if (url) { title.href = url.href; title.target = '_blank'; title.rel = 'noopener noreferrer'; }
      if (file) { title.type = 'button'; title.setAttribute('aria-label', 'Preview ' + reference.label); title.onclick = () => openFile(reference); }
      head.append(sourceMark(reference), title); section.append(head);
      if (url) section.append(element('p', url.hostname.replace(/^www\./,''), 'hint'));
      else if (reference.locator) {
        const path = element(file ? 'button' : 'p', reference.locator, file ? 'file-reference hint' : 'hint');
        if (file) { path.type = 'button'; path.onclick = () => openFile(reference); }
        section.append(path);
      }
      if (preview) {
        excerpt(section, capture.text);
        if (capture.raw || preview.notice || preview.truncated) {
          const details = element('details', undefined, 'source-record-details'); details.append(element('summary', 'Capture details'));
          if (capture.raw) {
            const raw = element('details'); raw.append(element('summary', 'Original ' + capture.format), element('pre', capture.raw, 'source-excerpt')); details.append(raw);
          }
          if (preview.notice) details.append(element('p', preview.notice, 'hint'));
          if (preview.truncated) details.append(element('p', `Excerpt shown · starting at line ${preview.firstLine} of ${preview.totalLines}.`, 'hint'));
          section.append(details);
        }
      } else section.append(element('p', reference.error || 'No text excerpt was retained.', 'hint'));
      const kind = url ? ['Web sources','globe'] : reference.kind === 'connected' ? ['Connected apps','link'] : reference.kind === 'knowledge' ? ['Saved knowledge','brain'] : ['Files and references','file-text'];
      group(...kind).append(section);
    }
    if (value.sources_error) root.append(element('p', value.sources_error, 'issue'));
    else if (!value.references?.length && !context?.Items?.length) root.append(element('p', 'No source excerpts were retained for this answer.', 'hint'));
    if (value.truncated) root.append(element('p', 'This answer exceeds the retained source list limit; additional references are omitted.', 'hint'));
    const technical = element('details', undefined, 'source-technical-details'); technical.append(element('summary', 'Technical details'));
    const facts = element('dl', undefined, 'context-facts');
    for (const [label, text] of [['Original request',context?.Outcome],['Permission',context?.Permission],['Recall',context?.Recall],['Usage',context?.Usage]]) if (text) facts.append(element('dt',label),element('dd',text));
    technical.append(facts);
    for (const item of context?.Items || []) {
      const details = element('section', undefined, 'context-entry');
      details.append(element('h4', item.Title || item.Kind || 'Saved context'));
      for (const text of [item.Scope, item.Source, item.Updated, item.SelectionReason && 'Why supplied · ' + item.SelectionReason]) if (text) details.append(element('p', text, 'hint'));
      technical.append(details);
    }
    if (context?.RecallTrace?.length) {
      const trace = element('details'); trace.append(element('summary','Why context was selected or omitted'),element('p','Selection records describe supplied inputs, not the model’s hidden reasoning. Token ceilings use conservative UTF-8 byte counts.','hint'));
      for (const item of context.RecallTrace) trace.append(element('p',`${item.Selected ?? item.selected ? 'Supplied' : 'Omitted'} · ${item.ID ?? item.id} · ${item.Reason ?? item.reason}${item.selected ? ' · ceiling ' + item.token_upper_bound + ' tokens' : ''}`));
      technical.append(trace);
    }
    if (facts.children.length || context?.Items?.length || context?.RecallTrace?.length) root.append(technical);
  }
  async function load() {
    root.setAttribute('aria-busy', 'true');
    const status = element('p', 'Loading sources…', 'hint'); status.setAttribute('role', 'status'); root.replaceChildren(status);
    try { const value = await request(); if (current()) render(value); }
    catch (error) {
      if (!current()) return;
      const note = element('p', error.message, 'issue'); note.setAttribute('role', 'alert');
      const retry = element('button', 'Retry', 'quiet'); retry.type = 'button'; retry.onclick = () => void load(); root.replaceChildren(note, retry);
    } finally { root.removeAttribute('aria-busy'); }
  }
  return { element: root, load };
}
