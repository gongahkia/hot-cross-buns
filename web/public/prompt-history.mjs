import { transcriptItems } from './transcript.mjs';

export function pastPrompts(state) {
  return transcriptItems(state.messages || [], state.dialogue || [], [])
    .filter(item => item.type === 'talk' || item.value.role === 'You')
    .map(item => item.value.text)
    .filter(text => typeof text === 'string' && text.trim() && !text.trimStart().startsWith('/'));
}

export function promptHistory(input, { prompts, enabled = () => true }) {
  let entries, index, draft, recalling = false;
  function reset() { entries = undefined; index = undefined; draft = undefined; }
  input.addEventListener('input', () => { if (!recalling) reset(); });
  input.addEventListener('pointerdown', reset);
  input.addEventListener('keydown', event => {
    if (!['ArrowUp', 'ArrowDown'].includes(event.key) || event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
        event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || input.disabled || input.readOnly || !enabled() ||
        input.selectionStart !== input.selectionEnd) return;
    const previous = event.key === 'ArrowUp';
    if (!entries) {
      if (!previous || input.value.slice(0, input.selectionStart).includes('\n')) return;
      entries = prompts().slice();
      if (!entries.length) { reset(); return; }
      index = entries.length;
      draft = { text: input.value, cursor: input.selectionStart };
    }
    const next = Math.max(0, Math.min(entries.length, index + (previous ? -1 : 1)));
    event.preventDefault();
    if (next === index) return;
    index = next;
    const restored = index === entries.length;
    input.value = restored ? draft.text : entries[index];
    const cursor = restored ? draft.cursor : input.value.length;
    input.setSelectionRange(cursor, cursor);
    // Use the composer's existing draft persistence and control updates.
    recalling = true;
    try { input.dispatchEvent(new input.ownerDocument.defaultView.Event('input', { bubbles: true })); }
    finally { recalling = false; }
    if (restored) reset();
  });
  return { reset };
}
