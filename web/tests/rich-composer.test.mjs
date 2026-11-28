import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { indentUnit, syntaxTree } from '@codemirror/language';
import { formatSelection, listSelection, linkInfo, composerListKey } from '../composer-entry.mjs';

test('formatting writes Markdown and keeps the selected words selected for toggling', () => {
  let state = EditorState.create({ doc: 'hello world', selection: { anchor: 6, head: 11 } });
  state = state.update(formatSelection(state, '**')).state;
  assert.equal(state.doc.toString(), 'hello **world**');
  assert.equal(state.sliceDoc(state.selection.main.from, state.selection.main.to), 'world');
  state = state.update(formatSelection(state, '**')).state;
  assert.equal(state.doc.toString(), 'hello world');
  const cursor = EditorState.create({ doc: '', selection: { anchor: 0 } });
  const italic = cursor.update(formatSelection(cursor, '*')).state;
  assert.equal(italic.doc.toString(), '**'); assert.equal(italic.selection.main.head, 1);
});
test('bullet and numbered list shortcuts apply to every selected line and toggle off', () => {
  let state = EditorState.create({ doc: 'one\ntwo', selection: { anchor: 0, head: 7 } });
  state = state.update(listSelection(state)).state;
  assert.equal(state.doc.toString(), '- one\n- two');
  state = EditorState.create({ doc: state.doc.toString(), selection: { anchor: 0, head: state.doc.length } });
  assert.equal(state.update(listSelection(state)).state.doc.toString(), 'one\ntwo');
  assert.equal(EditorState.create({ doc: 'one\ntwo', selection: { anchor: 0, head: 7 } }).update(listSelection(EditorState.create({ doc: 'one\ntwo', selection: { anchor: 0, head: 7 } }), true)).state.doc.toString(), '1. one\n2. two');
});
test('link previews use local brand assets and never resolve file, credentialed or private favicons', () => {
  assert.equal(linkInfo('https://chatgpt.com/dots/example').logo, '/brands/openai.png');
  assert.equal(linkInfo('https://example.com/private?token=value').logo, 'https://example.com/favicon.ico');
  for (const url of ['http://127.0.0.1:4317/','https://192.168.1.1/','https://localhost/','https://[::1]/']) assert.equal(linkInfo(url).logo, '');
  for (const url of ['javascript:alert(1)','file:///etc/passwd','https://secret:pass@example.com']) assert.equal(linkInfo(url), null);
});

function listEditor(doc, cursor = doc.length) {
  let state = EditorState.create({ doc, selection: { anchor: cursor }, extensions: [markdown({ addKeymap: false }), indentUnit.of('    ')] });
  return { get state() { return state; }, dispatch(transaction) { state = transaction.state; } };
}
test('asterisk bullets nest with Tab, outdent with Shift+Tab and continue with Shift+Enter', () => {
  const editor = listEditor('* parent\n* child');
  assert.equal(composerListKey({ key: 'Tab' }, editor), true);
  assert.equal(editor.state.doc.toString(), '* parent\n    * child');
  let bullets = 0; syntaxTree(editor.state).iterate({ enter(node) { if (node.name === 'ListMark') bullets++; } });
  assert.equal(bullets, 2);
  assert.equal(composerListKey({ key: 'Enter', shiftKey: true }, editor), true);
  assert.equal(editor.state.doc.toString(), '* parent\n    * child\n    * ');
  assert.equal(composerListKey({ key: 'Tab', shiftKey: true }, editor), true);
  assert.equal(editor.state.doc.toString(), '* parent\n    * child\n* ');
  assert.equal(composerListKey({ key: 'Enter', shiftKey: true }, editor), true);
  assert.equal(editor.state.doc.toString(), '* parent\n    * child\n');
});
test('Shift+Enter splits the current item and increments ordered lists while Enter leaves submission to the composer', () => {
  const editor = listEditor('* first second', 7);
  assert.equal(composerListKey({ key: 'Enter' }, editor), false);
  assert.equal(editor.state.doc.toString(), '* first second');
  assert.equal(composerListKey({ key: 'Enter', shiftKey: true }, editor), true);
  assert.equal(editor.state.doc.toString(), '* first\n*  second');
  const ordered = listEditor('1. first');
  assert.equal(composerListKey({ key: 'Enter', shiftKey: true }, ordered), true);
  assert.equal(ordered.state.doc.toString(), '1. first\n2. ');
  for (const event of [{ key: 'Tab', ctrlKey: true }, { key: 'Enter', shiftKey: true, isComposing: true }]) assert.equal(composerListKey(event, ordered), false);
  const prose = listEditor('ordinary text');
  assert.equal(composerListKey({ key: 'Enter', shiftKey: true }, prose), false);
  assert.equal(composerListKey({ key: 'Tab' }, prose), false);
});
