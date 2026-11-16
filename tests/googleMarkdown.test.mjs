import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { parseJournal, readJournal } from '../src/journalDocument.ts';

test('the one-time Google converter emits the exact runtime Markdown contract with namespaced identities and literal provider text', () => {
  const source = execFileSync('python3', ['-c', `
import sys
sys.path.insert(0, 'tests')
from test_google_conversion import sample_snapshot, AS_OF, collection
from scripts.convert_google_snapshot import convert
snapshot = sample_snapshot()
snapshot['calendarList']['pages'][0]['items'].append({'id': 'second', 'timeZone': 'Asia/Singapore'})
task = snapshot['tasksByList'][0]['tasks']['pages'][0]['items'][0]
task['title'] = '- [x] **literal** <script> # Dated'
task['notes'] = 'id: not-metadata\\n~~~hcb\\n[link](javascript:alert(1))'
snapshot['calendarEvents'].append({'calendarId': 'second', 'events': collection(snapshot['calendarEvents'][0]['events']['pages'][0]['items'])})
print(convert(snapshot, AS_OF, False)[0], end='')
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  const parsed = parseJournal(source);
  assert.deepEqual(parsed.issues, []);
  const model = readJournal(source).model;
  const entries = [...model.days, ...model.undated].flatMap(group => group.entries);
  assert.equal(new Set(entries.map(entry => entry.id)).size, entries.length);
  assert.equal(entries.filter(entry => entry.repeat).length, 2);
  assert.equal(new Set(entries.filter(entry => entry.repeat).map(entry => entry.repeat.series)).size, 2);
  const capture = model.undated[0].entries[0];
  assert.equal(capture.text, '- [x] **literal** <script> # Dated');
  assert.deepEqual(capture.details.map(detail => detail.text), ['id: not-metadata', '~~~hcb', '[link](javascript:alert(1))']);
  assert.equal(parsed.document.scratchpad, '');
  assert.equal(entries.filter(entry => entry.replaces).length, 2);
  assert.equal(entries.filter(entry => entry.span?.kind === 'time').length, 2);
});
