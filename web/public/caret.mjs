const textInputs = 'textarea, input:not([type]), input[type="text"], input[type="search"], input[type="url"], input[type="email"], input[type="tel"]';
const mirrorProperties = [
  'boxSizing', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant',
  'lineHeight', 'letterSpacing', 'wordSpacing', 'textIndent', 'textAlign',
  'textTransform', 'direction', 'tabSize', 'paddingTop', 'paddingRight',
  'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth',
  'borderBottomWidth', 'borderLeftWidth', 'borderStyle', 'wordBreak', 'overflowWrap',
];

export function installSmoothCaret() {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const caret = document.createElement('span');
  caret.className = 'smooth-caret';
  caret.setAttribute('aria-hidden', 'true');
  caret.hidden = true;
  const mirror = document.createElement('div');
  mirror.className = 'caret-mirror';
  mirror.setAttribute('aria-hidden', 'true');
  document.body.append(caret, mirror);
  let field, composing = false, scheduled = false, previousRoot, readUntil = 0, hideTimer;
  let pointerText = false, lastRect, lastScrollY = window.scrollY;

  function hide() {
    field?.classList.remove('smooth-caret-field');
    field = undefined;
    caret.hidden = true;
  }
  function inputRect(input) {
    if (input.disabled || input.readOnly || input.selectionStart === null || input.selectionStart !== input.selectionEnd) return;
    const box = input.getBoundingClientRect();
    const style = getComputedStyle(input);
    for (const property of mirrorProperties) mirror.style[property] = style[property];
    mirror.style.width = input.clientWidth + (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.borderRightWidth) || 0) + 'px';
    mirror.style.whiteSpace = input.tagName === 'TEXTAREA' ? 'pre-wrap' : 'pre';
    mirror.style.overflowWrap = input.tagName === 'TEXTAREA' ? style.overflowWrap : 'normal';
    mirror.style.height = 'auto';
    mirror.style.borderColor = 'transparent';
    const marker = document.createElement('span');
    marker.textContent = '\u200b';
    mirror.replaceChildren(document.createTextNode(input.value.slice(0, input.selectionStart)), marker,
      document.createTextNode(input.value.slice(input.selectionStart) || '\u200b'));
    const position = marker.getBoundingClientRect(), origin = mirror.getBoundingClientRect();
    const height = parseFloat(style.fontSize) || 16;
    const left = box.left + position.left - origin.left - input.scrollLeft;
    const top = box.top + position.top - origin.top - input.scrollTop;
    const innerLeft = box.left + input.clientLeft, innerTop = box.top + input.clientTop;
    if (left < innerLeft - 1 || left > innerLeft + input.clientWidth || top + height < innerTop || top > innerTop + input.clientHeight) return;
    return { left, top, height, root: input.closest('dialog[open]') || document.body, input };
  }
  function selectionRect() {
    const selection = document.getSelection();
    if (!selection?.isCollapsed || !selection.rangeCount || Date.now() > readUntil) return;
    const node = selection.focusNode;
    const parent = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    if (!parent?.closest('#transcript, #detail-body, [data-caret-preview]') || parent.closest('button, a, summary, select')) return;
    const range = selection.getRangeAt(0).cloneRange();
    let box = range.getClientRects()[0];
    if (!box?.height && node?.nodeType === Node.TEXT_NODE && node.length) {
      const offset = Math.min(selection.focusOffset, node.length - 1);
      range.setStart(node, offset); range.setEnd(node, offset + 1);
      const character = range.getBoundingClientRect();
      box = { left: selection.focusOffset === node.length ? character.right : character.left, top: character.top, height: character.height };
    }
    if (!box?.height) return;
    return { left: box.left, top: box.top, height: box.height, root: parent.closest('dialog[open]') || document.body };
  }
  function update() {
    scheduled = false;
    if (media.matches || window.matchMedia('(forced-colors: active)').matches || composing || document.hidden) { hide(); return; }
    const active = document.activeElement;
    let target;
    try { target = active?.matches(textInputs) ? inputRect(active) : selectionRect(); }
    catch { hide(); return; }
    if (!target) { hide(); return; }
    const { root } = target;
    const rootBox = root === document.body ? { left: 0, top: 0 } : root.getBoundingClientRect();
    const x = target.left - rootBox.left - (root === document.body ? 0 : root.clientLeft);
    const y = target.top - rootBox.top - (root === document.body ? 0 : root.clientTop) + (root === document.body ? 0 : root.scrollTop);
    const wasHidden = caret.hidden;
    const previous = wasHidden ? lastRect : caret.getBoundingClientRect();
    const snap = !previous || wasHidden && window.scrollY !== lastScrollY;
    if (field !== target.input) field?.classList.remove('smooth-caret-field');
    field = target.input;
    field?.classList.add('smooth-caret-field');
    const rootChanged = previousRoot !== root;
    if (rootChanged) {
      root.append(caret);
      caret.style.position = root === document.body ? 'fixed' : 'absolute';
      if (previous) caret.style.transform = `translate3d(${previous.left - rootBox.left}px,${previous.top - rootBox.top}px,0)`;
      previousRoot = root;
    }
    caret.classList.toggle('caret-snap', snap);
    caret.hidden = false;
    if ((wasHidden || rootChanged) && previous && !snap) {
      caret.classList.add('caret-snap');
      caret.style.transform = `translate3d(${previous.left - rootBox.left}px,${previous.top - rootBox.top}px,0)`;
      void caret.offsetWidth;
      caret.classList.remove('caret-snap');
    }
    caret.style.height = target.height + 'px';
    caret.style.transform = `translate3d(${x}px,${y}px,0)`;
    caret.dataset.reading = String(!field);
    lastRect = { left: target.left, top: target.top, height: target.height };
    lastScrollY = window.scrollY;
    clearTimeout(hideTimer);
    if (!field) hideTimer = setTimeout(hide, Math.max(0, readUntil - Date.now()));
    requestAnimationFrame(() => caret.classList.remove('caret-snap'));
  }
  function schedule() {
    if (!scheduled) { scheduled = true; requestAnimationFrame(update); }
  }
  document.addEventListener('pointerdown', event => {
    pointerText = !event.target.closest('button, a, summary, select, [role="separator"]');
  }, true);
  document.addEventListener('pointerup', () => {
    if (pointerText) readUntil = Date.now() + 1400;
    schedule();
  }, true);
  for (const event of ['selectionchange', 'input', 'keyup', 'focusin', 'focusout', 'scroll']) document.addEventListener(event, schedule, true);
  document.addEventListener('compositionstart', () => { composing = true; hide(); });
  document.addEventListener('compositionend', () => { composing = false; schedule(); });
  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('blur', hide);
  window.addEventListener('resize', schedule);
  media.addEventListener('change', () => { if (media.matches) hide(); else schedule(); });
  const observer = new ResizeObserver(schedule);
  observer.observe(document.body);
  schedule();
}
