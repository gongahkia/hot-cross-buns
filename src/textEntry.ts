import { createMovingCaret } from './movingCaret';

export const textEntrySelector = `textarea, input:not([type]), input:is([type='text'], [type='search'], [type='email'], [type='url'], [type='tel'], [type='password'], [type='number'], [type='date'], [type='time'], [type='datetime-local'], [type='month'], [type='week'])`;

export function installCaretMotion(): () => void {
  if (!CSS.supports('caret-animation', 'manual') && !('showPopover' in HTMLElement.prototype)) return () => {};
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const forcedColors = matchMedia('(forced-colors: active)');
  const moving = createMovingCaret();
  let active: HTMLInputElement | HTMLTextAreaElement | null = null;
  let timer: number | undefined;
  let composing = false;
  let selecting = false;
  let touchSelection = false;
  const release = () => {
    window.clearTimeout(timer);
    active?.removeAttribute('data-caret-typing');
    moving.clear();
    active = null; timer = undefined; composing = false;
  };
  const reset = () => { release(); selecting = false; touchSelection = false; };
  const sync = (animate = false, snap = false) => {
    if (active && (!active.isConnected || active !== document.activeElement)) { release(); return; }
    if (!active || composing || selecting || touchSelection || motion.matches || forcedColors.matches
      || active.readOnly || active.disabled || document.hidden || (visualViewport?.scale ?? 1) !== 1) { moving.clear(); return; }
    moving.follow(active, animate, snap);
  };
  const hold = (target: EventTarget | null, animate = true) => {
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
      || !target.matches(textEntrySelector) || target.readOnly || target.disabled
      || target !== document.activeElement || motion.matches) return;
    if (active !== target) { release(); active = target; }
    window.clearTimeout(timer);
    target.setAttribute('data-caret-typing', 'true');
    sync(animate);
    if (!composing) timer = window.setTimeout(() => {
      active?.removeAttribute('data-caret-typing');
      timer = undefined;
      sync();
    }, 650);
  };
  const activity = (event: Event) => {
    if (event.type === 'input' || event.type === 'keydown') touchSelection = false;
    hold(event.target, event.type !== 'focusin');
  };
  const blur = (event: FocusEvent) => { if (event.target === active) release(); };
  const compositionStart = (event: CompositionEvent) => {
    hold(event.target);
    if (active === event.target) { composing = true; window.clearTimeout(timer); timer = undefined; moving.clear(); }
  };
  const compositionEnd = (event: CompositionEvent) => { composing = false; hold(event.target); };
  const visibility = () => { if (document.hidden) reset(); };
  const motionChange = () => { if (motion.matches || forcedColors.matches) reset(); else hold(document.activeElement, false); };
  const selection = () => sync(true);
  const layout = () => sync(false, true);
  const pointerDown = (event: PointerEvent) => {
    selecting = true; touchSelection = event.pointerType === 'touch'; moving.clear();
  };
  const pointerUp = () => { selecting = false; sync(true); };
  for (const name of ['focusin', 'input', 'keydown']) document.addEventListener(name, activity, true);
  document.addEventListener('focusout', blur, true);
  document.addEventListener('compositionstart', compositionStart, true);
  document.addEventListener('compositionend', compositionEnd, true);
  document.addEventListener('visibilitychange', visibility);
  document.addEventListener('selectionchange', selection);
  document.addEventListener('pointerdown', pointerDown, true);
  document.addEventListener('pointerup', pointerUp, true);
  document.addEventListener('pointercancel', pointerUp, true);
  document.addEventListener('scroll', layout, true);
  window.addEventListener('resize', layout);
  window.addEventListener('blur', reset);
  visualViewport?.addEventListener('resize', layout);
  visualViewport?.addEventListener('scroll', layout);
  document.fonts.addEventListener('loadingdone', layout);
  motion.addEventListener('change', motionChange);
  forcedColors.addEventListener('change', motionChange);
  return () => {
    reset();
    for (const name of ['focusin', 'input', 'keydown']) document.removeEventListener(name, activity, true);
    document.removeEventListener('focusout', blur, true);
    document.removeEventListener('compositionstart', compositionStart, true);
    document.removeEventListener('compositionend', compositionEnd, true);
    document.removeEventListener('visibilitychange', visibility);
    document.removeEventListener('selectionchange', selection);
    document.removeEventListener('pointerdown', pointerDown, true);
    document.removeEventListener('pointerup', pointerUp, true);
    document.removeEventListener('pointercancel', pointerUp, true);
    document.removeEventListener('scroll', layout, true);
    window.removeEventListener('resize', layout);
    window.removeEventListener('blur', reset);
    visualViewport?.removeEventListener('resize', layout);
    visualViewport?.removeEventListener('scroll', layout);
    document.fonts.removeEventListener('loadingdone', layout);
    motion.removeEventListener('change', motionChange);
    forcedColors.removeEventListener('change', motionChange);
    moving.destroy();
  };
}
