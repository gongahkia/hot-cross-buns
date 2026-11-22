import { element } from './text.mjs';
import { icon } from './icons.mjs';

export function readingPosition({ transcript, streaming, storage }) {
  const key = 'hot-cross-buns.web.reading.v1';
  let positions = [], current = '', following = true, restoring = false, frame, settled, scheduled = false, observer;
  try {
    storage ??= window.sessionStorage;
    const saved = JSON.parse(storage.getItem(key));
    if (Array.isArray(saved)) positions = saved.filter(item => typeof item.id === 'string' && typeof item.anchor === 'string' && Number.isFinite(item.offset) && typeof item.following === 'boolean').slice(-32);
  } catch { /* reading still works when browser storage is unavailable. */ }
  const jump = element('button', undefined, 'quiet jump-latest'); jump.type = 'button'; jump.hidden = true;
  jump.append(icon('arrow-down'), element('span', 'Jump to latest'));
  const anchors = () => [...transcript.querySelectorAll('[data-message-id]')];
  function save() {
    if (!current || restoring || scheduled) return;
    const edge = document.querySelector('.top')?.getBoundingClientRect().bottom || 60;
    const anchor = anchors().find(node => node.getBoundingClientRect().bottom > edge);
    positions = positions.filter(item => item.id !== current);
    positions.push({ id: current, following, anchor: following ? '' : anchor?.dataset.messageId || '', offset: following ? 0 : (anchor?.getBoundingClientRect().top || 0) - edge });
    positions = positions.slice(-32);
    try { storage?.setItem(key, JSON.stringify(positions)); } catch { /* retain positions for this page even if storage is full. */ }
  }
  function latest() {
    following = true; jump.hidden = true;
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }); save();
  }
  function restore() {
    cancelAnimationFrame(frame);
    scheduled = true;
    frame = requestAnimationFrame(() => {
      scheduled = false;
      restoring = true;
      if (following) window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
      else {
        const position = positions.find(item => item.id === current), available = anchors();
        const anchor = available.find(node => node.dataset.messageId === position?.anchor) || available.find(node => node.dataset.messageId === position?.anchor?.replace(/:response$/, ':user')) || available[0];
        if (anchor) {
          const edge = document.querySelector('.top')?.getBoundingClientRect().bottom || 60;
          window.scrollTo({ top: window.scrollY + anchor.getBoundingClientRect().top - edge - (anchor.dataset.messageId === position?.anchor ? position.offset : 0), behavior: 'instant' });
        }
      }
      jump.hidden = following || !anchors().length;
      settled = requestAnimationFrame(() => { restoring = false; });
    });
  }
  jump.addEventListener('click', latest);
  const onScroll = () => {
    if (restoring) return;
    following = document.documentElement.scrollHeight - window.innerHeight - window.scrollY < 170;
    jump.hidden = following || !anchors().length; save();
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('pagehide', save);
  if (globalThis.ResizeObserver) {
    observer = new ResizeObserver(() => { if (current) restore(); });
    observer.observe(transcript); if (streaming) observer.observe(streaming);
  }
  return {
    element: jump, latest,
    before(id) {
      save();
      if (id !== current) { current = id; following = positions.find(item => item.id === id)?.following ?? true; }
    },
    after: restore,
    moved() { restoring = false; following = false; jump.hidden = false; save(); },
    dispose() { save(); cancelAnimationFrame(frame); cancelAnimationFrame(settled); observer?.disconnect(); window.removeEventListener('scroll', onScroll); window.removeEventListener('pagehide', save); },
  };
}
