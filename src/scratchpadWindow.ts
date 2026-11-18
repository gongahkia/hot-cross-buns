const name = 'hot-cross-buns-scratchpad';
const features = 'popup=yes,width=600,height=780';
let capture: Window | null = null;

/** an empty URL focuses a named window without navigating away from its draft. */
export function openScratchpadWindow(): boolean {
  if (window.matchMedia('(max-width: 600px), (pointer: coarse) and (max-width: 900px)').matches) return false;
  try {
    if (capture && !capture.closed) { capture.focus(); return true; }
    capture = window.open('', name, features);
    if (!capture) return false;
    const url = new URL(window.location.pathname, window.location.origin);
    url.searchParams.set('popout', 'scratchpad');
    if (capture.location.href === 'about:blank') capture.location.replace(url.href);
    else if (capture.location.origin !== url.origin || new URL(capture.location.href).searchParams.get('popout') !== 'scratchpad') capture.location.replace(url.href);
    capture.focus();
    return true;
  } catch {
    capture = null;
    return false;
  }
}
