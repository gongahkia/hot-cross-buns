export const textEntrySelector = `textarea, input:not([type]), input:is([type='text'], [type='search'], [type='email'], [type='url'], [type='tel'], [type='password'], [type='number'], [type='date'], [type='time'], [type='datetime-local'], [type='month'], [type='week'])`;

export function installCaretMotion(): () => void {
  if (!CSS.supports('caret-animation', 'manual')) return () => {};
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let active: HTMLInputElement | HTMLTextAreaElement | null = null;
  let timer: number | undefined;
  let composing = false;
  const reset = () => {
    window.clearTimeout(timer);
    active?.removeAttribute('data-caret-typing');
    active = null; timer = undefined; composing = false;
  };
  const hold = (target: EventTarget | null) => {
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
      || !target.matches(textEntrySelector) || target.readOnly || target.disabled
      || target !== document.activeElement || motion.matches) return;
    if (active !== target) { reset(); active = target; }
    window.clearTimeout(timer);
    target.setAttribute('data-caret-typing', 'true');
    if (!composing) timer = window.setTimeout(() => {
      active?.removeAttribute('data-caret-typing');
      timer = undefined;
    }, 650);
  };
  const activity = (event: Event) => hold(event.target);
  const blur = (event: FocusEvent) => { if (event.target === active) reset(); };
  const compositionStart = (event: CompositionEvent) => {
    hold(event.target);
    if (active === event.target) { composing = true; window.clearTimeout(timer); timer = undefined; }
  };
  const compositionEnd = (event: CompositionEvent) => { composing = false; hold(event.target); };
  const visibility = () => { if (document.hidden) reset(); };
  const motionChange = () => { if (motion.matches) reset(); else hold(document.activeElement); };
  for (const name of ['focusin', 'input', 'keydown']) document.addEventListener(name, activity, true);
  document.addEventListener('focusout', blur, true);
  document.addEventListener('compositionstart', compositionStart, true);
  document.addEventListener('compositionend', compositionEnd, true);
  document.addEventListener('visibilitychange', visibility);
  motion.addEventListener('change', motionChange);
  return () => {
    reset();
    for (const name of ['focusin', 'input', 'keydown']) document.removeEventListener(name, activity, true);
    document.removeEventListener('focusout', blur, true);
    document.removeEventListener('compositionstart', compositionStart, true);
    document.removeEventListener('compositionend', compositionEnd, true);
    document.removeEventListener('visibilitychange', visibility);
    motion.removeEventListener('change', motionChange);
  };
}
