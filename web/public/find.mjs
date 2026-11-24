export function transcriptFind({ transcript, revealed = () => {} }) {
  let matches = [], selected = -1, context = '', limited = false, query = '';
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
          const mark = document.createElement('mark'); mark.className = 'chat-find-mark'; mark.dataset.current = String(i === selected);
          range.surroundContents(mark);
        }
      }
    }
  }
  function update(forcedIndex) {
    const old = matches[selected], oldID = old?.node.dataset.messageId, oldOffset = old?.offset;
    clear(); matches = []; limited = false;
    let bytes = 0;
    if (query) outer: for (const node of transcript.querySelectorAll('.turn')) {
      const walker = document.createTreeWalker(node, window.NodeFilter.SHOW_TEXT);
      const parts = []; let text = '', child;
      while ((child = walker.nextNode())) {
        const parent = child.parentElement;
        if (!parent || parent.closest('button:not(.file-reference), input, textarea, select, svg, iframe, script, style, [hidden], [aria-hidden="true"], .sr-only, .meta, .code-toolbar, .work-activity')) continue;
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
    selected = forcedIndex !== undefined ? forcedIndex : matches.findIndex(item => item.node.dataset.messageId === oldID && item.offset === oldOffset);
    paint();
  }
  function show() {
    const item = matches[selected]; if (!item) return;
    const rect = item.range.getBoundingClientRect?.() || item.node.getBoundingClientRect();
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (rect.height) window.scrollTo({ top: Math.max(0, window.scrollY + rect.top - window.innerHeight * .35), behavior: reduce ? 'instant' : 'smooth' });
    else item.node.scrollIntoView?.({ block: 'center', behavior: reduce ? 'instant' : 'smooth' });
    revealed();
  }
  function close() { clear(); matches = []; selected = -1; query = ''; }
  function search(text) {
    query = text.slice(0, 256);
    update();
    return {
      items: matches.slice(0, 30).map((item, index) => ({
        label: item.excerpt, group: `Match ${index + 1}`,
        action() { update(index); show(); },
      })),
      notice: limited || matches.length > 30 ? 'Showing the first 30 matches. Refine your search.' : '',
    };
  }
  transcript.addEventListener('toggle', () => update(), true);
  return {
    search, close,
    open() { document.dispatchEvent(new window.Event('open-chat-find')); },
    refresh(id) {
      if (context && context !== id) {
        close();
        document.dispatchEvent(new window.Event('chat-find-context-changed'));
      }
      context = id;
      update();
    },
  };
}
