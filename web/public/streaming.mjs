import { element, prose, responseCopy } from './text.mjs';

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const words = new Intl.Segmenter(undefined, { granularity: 'word' });
export class StreamingReveal {
  source = ''; identity = ''; visible = 0; characters = [];
  receive(source, identity, animate = true) {
    const append = identity === this.identity && source.startsWith(this.source);
    this.identity = identity; this.source = source;
    if (!animate || source.length > 32768) { this.characters = []; this.visible = 0; return source; }
    this.characters = [...graphemes.segment(source)].map(item => item.segment);
    if (!append || this.characters.length > 8192 || this.characters.length - this.visible > 2048) this.visible = this.characters.length;
    else this.visible = Math.min(this.visible, this.characters.length);
    return this.text;
  }
  get pending() { return this.characters.length - this.visible; }
  get text() { return this.characters.length ? this.characters.slice(0, this.visible).join('') : this.source; }
  tick() {
    let budget = Math.max(2, Math.ceil(this.pending / 5));
    const tail = this.characters.slice(this.visible, this.visible + budget + 16).join('');
    for (const item of words.segment(tail)) {
      const length = [...graphemes.segment(tail.slice(0, item.index + item.segment.length))].length;
      if (item.isWordLike && length >= budget && length <= budget + 16) { budget = length; break; }
    }
    this.visible = Math.min(this.characters.length, this.visible + budget); return this.text;
  }
}

export function streamingResponse() {
  const root = element('article', undefined, 'turn live-response'); root.setAttribute('aria-label', 'Live response');
  const body = element('div'), copy = responseCopy(() => source); root.append(body, copy);
  const cursor = new StreamingReveal(); let source = '', identity = '', timer, prefix = '', tail, visible = false;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  function cancel() { clearTimeout(timer); timer = undefined; }
  function paint() {
    if (!tail) return;
    const old = cursor.text; cursor.tick();
    tail.replaceChildren(document.createTextNode(old), element('span', cursor.text.slice(old.length), 'stream-entering'));
    if (cursor.pending) timer = setTimeout(paint, 66); else timer = undefined;
  }
  function update(text, id, { active = true, animate = true } = {}) {
    source = text; visible = !!text; root.hidden = !visible;
    if (identity !== id) { cancel(); identity = id; prefix = ''; tail = undefined; }
    const split = text.lastIndexOf('\n\n') + 2, before = split > 1 ? text.slice(0, split) : '', last = split > 1 ? text.slice(split) : text;
    const plain = last && !/^[\s]*([#>|]|[-*+]\s|\d+[.)]\s|```|~~~)/m.test(last) && !/[*_`$<>]|\\[([]/.test(last);
    const motion = active && animate && !reduced?.matches && document.visibilityState !== 'hidden' && plain;
    if (!motion) { cancel(); tail = undefined; prefix = before; body.replaceChildren(prose(text, { previews: false })); cursor.receive(last, id, false); return; }
    if (!tail || prefix !== before) {
      cancel(); prefix = before; body.replaceChildren(...(before ? [prose(before, { previews: false })] : [])); tail = element('p'); body.append(tail);
      cursor.receive(last, id + ':' + before.length, false); cursor.identity = '';
    }
    const shown = cursor.receive(last, id + ':' + before.length, true); tail.textContent = shown;
    if (cursor.pending && !timer) timer = setTimeout(paint, 66);
  }
  function settle() { if (visible) update(source, identity, { animate: false }); }
  reduced?.addEventListener?.('change', settle);
  document.addEventListener('visibilitychange', settle);
  return { element: root, update, clear() { cancel(); source = ''; prefix = ''; identity = ''; tail = undefined; visible = false; root.hidden = true; body.replaceChildren(); }, dispose() { cancel(); reduced?.removeEventListener?.('change', settle); document.removeEventListener('visibilitychange', settle); } };
}
