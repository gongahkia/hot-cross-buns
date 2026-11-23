// Measure an unconstrained inner box so the scrollable popover can ease between sizes.
export function animatePopoverHeight(root) {
  const view = root.ownerDocument.defaultView;
  if (!view?.ResizeObserver) return;
  const content = root.ownerDocument.createElement('div');
  content.className = 'task-popover-content';
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
