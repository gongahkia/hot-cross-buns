import { element } from './text.mjs';
import { icon } from './icons.mjs';

export function transcriptFind({ transcript, revealed = () => {} }) {
  const bar = element('section', undefined, 'transcript-find'); bar.hidden = true; bar.setAttribute('aria-label', 'Find in conversation');
  const input = element('input'); input.type = 'search'; input.maxLength = 256; input.placeholder = 'Find in this chat…'; input.setAttribute('aria-label', 'Find in this chat');
  const count = element('span', '', 'hint find-count'); count.setAttribute('role', 'status'); count.setAttribute('aria-live', 'polite');
  const hint = element('span', 'Loaded text only; closed details and previews are excluded.', 'hint find-scope');
  const excerpt = element('span', '', 'sr-only');
  const controls = [];
  for (const [name, glyph, action] of [['Previous match', 'chevron-up', () => move(-1)], ['Next match', 'chevron-down', () => move(1)], ['Close Find', 'close', close]]) {
    const button = element('button', undefined, 'quiet icon-button'); button.type = 'button'; button.title = name; button.setAttribute('aria-label', name); button.append(icon(glyph)); button.addEventListener('click', action); controls.push(button);
  }
  bar.append(icon('search'), input, count, ...controls, hint, excerpt);
  let matches = [], selected = -1, context = '', limited = false;
  function clear() {
    window.CSS?.highlights?.delete('chat-find'); window.CSS?.highlights?.delete('chat-find-current');
    for (const node of transcript.querySelectorAll('mark.chat-find-mark')) node.replaceWith(...node.childNodes);
    transcript.normalize();
  }
  function paint() {
    if (window.CSS?.highlights && window.Highlight) {
      window.CSS.highlights.set('chat-find', new window.Highlight(...matches.map(item => item.range)));
      window.CSS.highlights.set('chat-find-current', new window.Highlight(...(matches[selected] ? [matches[selected].range] : [])));
    } else {
      // wrapping individual text segments preserves code, links, and their handlers.
      for (let i = matches.length - 1; i >= 0; i--) {
        for (const range of [...matches[i].segments].reverse()) {
          const mark = element('mark', undefined, 'chat-find-mark'); mark.dataset.current = String(i === selected);
          range.surroundContents(mark);
        }
      }
    }
    count.textContent = !input.value ? '' : matches.length ? `${selected < 0 ? 0 : selected + 1} of ${matches.length}${limited ? '+' : ''}` : 'No matches';
    for (const button of controls.slice(0, 2)) button.disabled = !matches.length;
    excerpt.textContent = matches[selected]?.excerpt || '';
    hint.textContent = limited ? 'Limited to 500 matches and 8 MiB of loaded text.' : 'Loaded text only; closed details and previews are excluded.';
  }
  function update(reveal = false, forcedIndex) {
    if (bar.hidden) return;
    const old = matches[selected], oldID = old?.node.dataset.messageId, oldOffset = old?.offset;
    clear(); matches = []; limited = false;
    const query = input.value; let bytes = 0;
    if (query) outer: for (const node of transcript.querySelectorAll('.turn')) {
      const walker = document.createTreeWalker(node, window.NodeFilter.SHOW_TEXT);
      const parts = []; let text = '', child;
      while ((child = walker.nextNode())) {
        const parent = child.parentElement;
        if (!parent || parent.closest('button, input, textarea, select, svg, iframe, script, style, [hidden], [aria-hidden="true"], .sr-only, .meta, .code-toolbar, .work-activity')) continue;
        let visible = true;
        for (let p = parent; p && p !== node; p = p.parentElement) if (p.tagName === 'DETAILS' && !p.open && !p.querySelector('summary')?.contains(parent)) visible = false;
        if (!visible) continue;
        parts.push({ node: child, start: text.length }); text += child.textContent;
      }
      bytes += text.length * 2; if (bytes > 8 * 1024 * 1024) { limited = true; break; }
      const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu'); let match;
      while ((match = pattern.exec(text))) {
        const at = match.index;
        if (matches.length >= 500) { limited = true; break outer; }
        const end = at + match[0].length, segments = [];
        for (const part of parts) {
          const from = Math.max(0, at - part.start), to = Math.min(part.node.length, end - part.start);
          if (to <= from) continue;
          const range = document.createRange(); range.setStart(part.node, from); range.setEnd(part.node, to); segments.push(range);
        }
        if (segments.length) {
          const range = document.createRange(); range.setStart(segments[0].startContainer, segments[0].startOffset); range.setEnd(segments.at(-1).endContainer, segments.at(-1).endOffset);
          matches.push({ node, range, segments, offset: at, excerpt: text.slice(Math.max(0, at - 35), end + 60) });
        }
      }
    }
    selected = forcedIndex !== undefined ? forcedIndex : reveal && matches.length ? 0 : matches.findIndex(item => item.node.dataset.messageId === oldID && item.offset === oldOffset);
    paint(); if (reveal && matches.length) show();
  }
  function show() {
    const item = matches[selected]; if (!item) return;
    const rect = item.range.getBoundingClientRect?.() || item.node.getBoundingClientRect();
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (rect.height) window.scrollTo({ top: Math.max(0, window.scrollY + rect.top - window.innerHeight * .35), behavior: reduce ? 'instant' : 'smooth' });
    else item.node.scrollIntoView?.({ block: 'center', behavior: reduce ? 'instant' : 'smooth' });
    revealed();
  }
  function move(delta) {
    if (!matches.length) return;
    const next = selected < 0 ? (delta < 0 ? matches.length - 1 : 0) : (selected + delta + matches.length) % matches.length;
    update(false, next);
    show();
  }
  function close() { bar.hidden = true; clear(); matches = []; selected = -1; input.value = ''; }
  function open() { if (document.querySelector('dialog[open]')) return; bar.hidden = false; update(); input.focus(); input.select(); }
  input.addEventListener('input', () => update(true));
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); move(event.shiftKey ? -1 : 1); }
    else if (event.key === 'Escape') { event.preventDefault(); close(); document.querySelector('#message')?.focus({ preventScroll: true }); }
  });
  transcript.addEventListener('toggle', () => update(), true);
  window.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f' && !event.altKey && !document.querySelector('dialog[open]')) { event.preventDefault(); open(); }
  });
  return { element: bar, open, close, refresh(id) { if (context && context !== id) close(); context = id; update(); } };
}
