export type TextControl = HTMLInputElement | HTMLTextAreaElement;
export type CaretPosition = { x: number; y: number; height: number; originX: number; originY: number };

const typography = ['font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'font-variant',
  'font-feature-settings', 'font-variation-settings', 'letter-spacing', 'word-spacing', 'line-height',
  'text-align', 'text-indent', 'text-transform', 'tab-size', 'word-break', 'overflow-wrap',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left'];
const clips = /^(auto|scroll|hidden|clip)$/;

export function createCaretMeasurer() {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.inert = true;
  host.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;';
  const mirror = document.createElement('div');
  mirror.style.cssText = 'box-sizing:border-box;border:0;margin:0;height:auto;min-height:0;';
  const text = document.createTextNode('');
  mirror.append(text);
  host.attachShadow({ mode: 'closed' }).append(mirror);
  document.body.append(host);
  const range = document.createRange();
  let previousValue: string | null = null;
  return {
    measure(field: TextControl): CaretPosition | null {
      const index = field.selectionStart;
      // segmented controls, secrets, bidirectional text and large files keep the native caret.
      if (index === null || index !== field.selectionEnd || field.type === 'password'
        || field.value.length > 32_768 || /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/u.test(field.value)) return null;
      const style = getComputedStyle(field);
      const box = field.getBoundingClientRect();
      if (!field.clientWidth || !field.clientHeight || style.direction !== 'ltr'
        || style.writingMode !== 'horizontal-tb' || Math.abs(box.width - field.offsetWidth) > 1) return null;
      for (const property of typography) {
        const value = style.getPropertyValue(property);
        if (mirror.style.getPropertyValue(property) !== value) mirror.style.setProperty(property, value);
      }
      mirror.style.width = field.clientWidth + 'px';
      mirror.style.whiteSpace = field instanceof HTMLTextAreaElement && field.wrap !== 'off' ? 'pre-wrap' : 'pre';
      if (field instanceof HTMLInputElement) {
        mirror.style.lineHeight = Math.max(1, field.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) + 'px';
      }
      if (previousValue !== field.value) { previousValue = field.value; text.data = field.value + '\u200b'; }
      range.setStart(text, index); range.collapse(true);
      const caret = range.getBoundingClientRect();
      const origin = mirror.getBoundingClientRect();
      if (!caret.height) return null;
      const x = box.left + field.clientLeft + caret.left - origin.left - field.scrollLeft;
      const y = box.top + field.clientTop + caret.top - origin.top - field.scrollTop;
      let left = box.left + field.clientLeft;
      let right = left + field.clientWidth;
      let top = box.top + field.clientTop;
      let bottom = top + field.clientHeight;
      for (let parent = field.parentElement; parent; parent = parent.parentElement) {
        const css = getComputedStyle(parent);
        if (css.transform !== 'none') {
          const matrix = new DOMMatrixReadOnly(css.transform);
          if (matrix.a !== 1 || matrix.b !== 0 || matrix.c !== 0 || matrix.d !== 1) return null;
        }
        if (!clips.test(css.overflowX) && !clips.test(css.overflowY)) continue;
        const rect = parent.getBoundingClientRect();
        if (clips.test(css.overflowX)) {
          left = Math.max(left, rect.left + parent.clientLeft);
          right = Math.min(right, rect.left + parent.clientLeft + parent.clientWidth);
        }
        if (clips.test(css.overflowY)) {
          top = Math.max(top, rect.top + parent.clientTop);
          bottom = Math.min(bottom, rect.top + parent.clientTop + parent.clientHeight);
        }
      }
      top = Math.max(0, top); bottom = Math.min(innerHeight, bottom);
      left = Math.max(0, left); right = Math.min(innerWidth, right);
      const visibleTop = Math.max(y, top);
      const height = Math.min(y + caret.height, bottom) - visibleTop;
      if (x < left || x + 2 > right || height <= 0) return null;
      return { x, y: visibleTop, height, originX: box.left, originY: box.top };
    },
    clear() { text.data = ''; previousValue = null; },
    destroy() { range.detach(); host.remove(); },
  };
}
