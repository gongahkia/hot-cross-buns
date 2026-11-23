// Measure an unconstrained inner box so the scrollable surface can ease between sizes.
export function animateSurfaceHeight(root) {
  const view = root.ownerDocument.defaultView;
  if (!view?.ResizeObserver) return;
  const content = root.ownerDocument.createElement('div');
  content.className = 'surface-content';
  content.append(...root.childNodes); root.append(content);
  let open = false, frame = 0;
  function measure() {
    frame = 0;
    if (!open || !root.isConnected) return;
    const style = view.getComputedStyle(root);
    const edges = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']
      .reduce((size, name) => size + (parseFloat(style[name]) || 0), 0);
    const natural = Math.ceil(content.getBoundingClientRect().height + edges);
    const limit = parseFloat(style.maxHeight);
    const height = Math.min(natural, Number.isFinite(limit) ? limit : natural) + 'px';
    if (root.style.height !== height) root.style.height = height;
  }
  function schedule() { if (open && !frame) frame = view.requestAnimationFrame(measure); }
  const observer = new view.ResizeObserver(schedule);
  root.addEventListener('beforetoggle', event => {
    if (event.target !== root) return;
    root.inert = event.newState !== 'open';
    open = false; observer.disconnect();
    view.cancelAnimationFrame(frame); frame = 0;
    if (event.newState === 'open') root.style.removeProperty('height');
  });
  root.addEventListener('toggle', event => {
    if (event.target !== root || event.newState !== 'open') return;
    open = true;
    measure(); observer.observe(content);
  });
  view.addEventListener('resize', schedule);
}

// Only animate incoming content; actions, focus release and state changes stay immediate.
export function viewTransition(content) {
  const reduced = content.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)');
  let animation;
  function cancel() { animation?.cancel(); animation = undefined; }
  function reveal() {
    cancel();
    if (reduced?.matches || !content.animate) return;
    animation = content.animate([{ opacity: .65, translate: '0 3px' }, { opacity: 1, translate: '0 0' }],
      { duration: 160, easing: 'cubic-bezier(.2,0,0,1)' });
  }
  reduced?.addEventListener('change', cancel);
  return { reveal, cancel };
}
