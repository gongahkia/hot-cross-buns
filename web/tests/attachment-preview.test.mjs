import assert from 'node:assert/strict';
import test from 'node:test';
import { attachmentPreview } from '../attachment-preview.mjs';

test('document previews bound text and table size and report shortened content', () => {
  const text = attachmentPreview({ kind: 'text', language: 'js', text: 'x'.repeat(70000) });
  assert.equal(text.text.length, 65536);
  assert.equal(text.truncated, true);
  const table = attachmentPreview({ kind: 'table', rows: Array.from({ length: 50 }, () => Array(15).fill('value')) });
  assert.equal(table.rows.length, 40);
  assert.equal(table.rows[0].length, 12);
  assert.equal(table.truncated, true);
});

test('Office previews use extracted content with explicit sheet and document labels', () => {
  const word = attachmentPreview({ kind: 'word', blocks: [{ type: 'paragraph', text: 'Title' }, { type: 'table', rows: [[[ { text: 'A' } ], [ { text: 'B' } ]]] }] });
  assert.match(word.text, /Title\n\nA\tB/);
  assert.equal(word.note, 'Extracted text preview');
  const sheet = attachmentPreview({ kind: 'workbook', sheets: [{ name: 'Budget', maxRow: 2, maxCol: 2, cells: [{ row: 2, col: 2, value: '42' }] }] });
  assert.equal(sheet.rows[1][1], '42');
  assert.equal(sheet.note, 'Budget · first sheet');
});
