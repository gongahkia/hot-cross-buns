import { createCaretMeasurer, type CaretPosition, type TextControl } from './caretPosition';

export function createMovingCaret() {
  if (!('showPopover' in HTMLElement.prototype)) return { follow: (_field: TextControl, _animate = false, _snap = false) => {}, clear: () => {}, destroy: () => {} };
  const measure = createCaretMeasurer();
  const caret = document.createElement('div');
  caret.setAttribute('popover', 'manual');
  caret.setAttribute('data-moving-caret', '');
  caret.setAttribute('aria-hidden', 'true');
  caret.inert = true;
  document.body.append(caret);
  let active: TextControl | null = null;
  let last: CaretPosition | null = null;
  let frame = 0;
  let until = 0;
  let animate = false;
  let snap = false;
  const layout = () => { until = performance.now() + 220; schedule(); };
  const observer = new ResizeObserver(layout);
  const attributes = new MutationObserver(layout);
  const hide = () => {
    active?.removeAttribute('data-smooth-caret');
    if (caret.matches(':popover-open')) caret.hidePopover();
    last = null;
  };
  const clear = () => {
    cancelAnimationFrame(frame); frame = 0;
    hide(); observer.disconnect(); attributes.disconnect(); measure.clear();
    active = null; animate = false; snap = false;
  };
  function schedule() { if (!frame) frame = requestAnimationFrame(draw); }
  function draw(now: number) {
    frame = 0;
    if (!active || active !== document.activeElement || !active.isConnected || active.readOnly || active.disabled) { clear(); return; }
    let next: CaretPosition | null;
    try { next = measure.measure(active); } catch { hide(); return; }
    if (!next) { hide(); if (now < until) schedule(); return; }
    if (!caret.matches(':popover-open')) {
      try { caret.showPopover(); } catch { hide(); return; }
    }
    const changed = !last || Math.abs(last.x - next.x) > .05 || Math.abs(last.y - next.y) > .05;
    if (changed) {
      const sameOrigin = last && Math.abs(last.originX - next.originX) < .5 && Math.abs(last.originY - next.originY) < .5;
      caret.style.transition = last && animate && !snap && sameOrigin ? 'transform 110ms cubic-bezier(.16,1,.3,1)' : 'none';
      caret.style.transform = `translate3d(${next.x}px,${next.y}px,0)`;
    }
    caret.style.height = next.height + 'px';
    caret.toggleAttribute('data-caret-typing', active.hasAttribute('data-caret-typing'));
    if (!active.hasAttribute('data-smooth-caret')) active.setAttribute('data-smooth-caret', 'true');
    last = next; animate = false; snap = false;
    if (now < until) schedule();
  }
  return {
    follow(field: TextControl, shouldAnimate = false, shouldSnap = false) {
      if (active !== field) {
        clear(); active = field; observer.observe(field);
        attributes.observe(field, { attributes: true, attributeFilter: ['readonly', 'disabled', 'dir', 'class', 'style'] });
      }
      animate ||= shouldAnimate; snap ||= shouldSnap;
      until = performance.now() + 220;
      schedule();
    },
    clear,
    destroy() { clear(); measure.destroy(); caret.remove(); },
  };
}
