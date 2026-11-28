import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { pastPrompts, promptHistory } from '../public/prompt-history.mjs';

function fixture(prompts = ['first prompt', 'second\nprompt']) {
  const dom = new JSDOM('<textarea></textarea>');
  const input = dom.window.document.querySelector('textarea');
  let edits = 0, allowed = true, current = prompts;
  const history = promptHistory(input, { prompts: () => current, enabled: () => allowed });
  input.addEventListener('input', () => edits++);
  const key = (key, options = {}) => {
    const event = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
    input.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const type = text => { input.value = text; input.dispatchEvent(new dom.window.Event('input')); };
  return { input, key, type, history, edits: () => edits, setPrompts: value => current = value, allow: value => allowed = value };
}

test('Up and Down recall prompts in order, stop at the oldest, and restore the draft and cursor', () => {
  const f = fixture();
  f.type('unfinished draft'); f.input.setSelectionRange(4, 4);
  for (const [key, text] of [['ArrowUp', 'second\nprompt'], ['ArrowUp', 'first prompt'], ['ArrowUp', 'first prompt'], ['ArrowDown', 'second\nprompt'], ['ArrowDown', 'unfinished draft']]) {
    assert.equal(f.key(key), true);
    assert.equal(f.input.value, text);
  }
  assert.equal(f.input.selectionStart, 4);
  assert.equal(f.edits(), 5);
  assert.equal(f.key('ArrowDown'), false);
});

test('typing leaves history, and changing chats resets navigation without carrying the previous draft', () => {
  const f = fixture();
  f.key('ArrowUp'); f.type('edited recalled prompt');
  assert.equal(f.key('ArrowDown'), false);
  assert.equal(f.input.value, 'edited recalled prompt');
  f.key('ArrowUp');
  f.history.reset(); f.setPrompts(['other chat']); f.input.value = 'other draft';
  f.key('ArrowUp'); assert.equal(f.input.value, 'other chat');
  f.key('ArrowDown'); assert.equal(f.input.value, 'other draft');
  f.history.reset(); f.setPrompts([]);
  assert.equal(f.key('ArrowUp'), false);
  assert.equal(f.input.value, 'other draft');
});

test('history leaves multiline editing, selection, composition, modifiers and locked drafts alone', () => {
  const f = fixture();
  f.type('first\nsecond'); f.input.setSelectionRange(8, 8);
  assert.equal(f.key('ArrowUp'), false);
  assert.equal(f.key('ArrowDown'), false);
  f.input.setSelectionRange(0, 2); assert.equal(f.key('ArrowUp'), false);
  f.input.setSelectionRange(0, 0);
  for (const options of [{ isComposing: true }, { shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }]) assert.equal(f.key('ArrowUp', options), false);
  f.input.readOnly = true; assert.equal(f.key('ArrowUp'), false); f.input.readOnly = false;
  f.input.disabled = true; assert.equal(f.key('ArrowUp'), false); f.input.disabled = false;
  f.allow(false); assert.equal(f.key('ArrowUp'), false); f.allow(true);
  assert.equal(f.input.value, 'first\nsecond');
  assert.equal(f.key('ArrowUp'), true);
  assert.equal(f.input.value, 'second\nprompt');
});

test('past prompts combine retained Work and dialogue chronologically without assistant text or local commands', () => {
  const old = '2026-11-28T01:00:00Z', recent = '2026-11-28T02:00:00Z';
  assert.deepEqual(pastPrompts({
    messages: [{ role: 'You', text: 'first', created_at: old }, { role: 'Hot Cross Buns', text: 'assistant' }, { role: 'You', text: '/settings' }],
    dialogue: [{ text: 'second', created_at: recent }, { text: '  ' }],
  }), ['first', 'second']);
  assert.deepEqual(pastPrompts({}), []);
});
