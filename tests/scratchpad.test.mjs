import test from 'node:test';
import assert from 'node:assert/strict';
import { mapScratchpadSelection } from '../src/scratchpad.ts';

test('scratchpad selection maps plain lines without leaking empty rows into journal details', () => {
  const selection = '  Draft title  \r\n\r\n first detail  \n  second detail \n';
  assert.deepEqual(mapScratchpadSelection(selection, 'details'), [{ title: 'Draft title', details: ['first detail', 'second detail'] }]);
  assert.deepEqual(mapScratchpadSelection(selection, 'items'), [
    { title: 'Draft title', details: [] },
    { title: 'first detail', details: [] },
    { title: 'second detail', details: [] },
  ]);
  assert.deepEqual(mapScratchpadSelection(selection, 'single'), [{ title: 'Draft title first detail second detail', details: [] }]);
  assert.deepEqual(mapScratchpadSelection(' \n\t\n', 'details'), []);
});
