import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createJournal, escapeMarkdownText, journalFromModel, materializeJournal, parseJournal, readJournal, serializeJournal, withScratchpad } from '../src/journalDocument.ts';
import { advanceRecurrences } from '../src/recurrence.ts';

const fixture = readFileSync(new URL('./fixtures/markdown-planner.md', import.meta.url), 'utf8');
const parse = text => { const result = parseJournal(text); assert.deepEqual(result.issues, []); return result.document; };
const edit = (document, work) => { const next = structuredClone(document); work(next); return materializeJournal(next); };
const item = (id, text, details = []) => ({ id, text, completed: false, details });

test('unchanged projections retain exact source, including rich Markdown and terminal scratchpad', () => {
  for (const source of [fixture, '\ufeff' + fixture.replaceAll('\n', '\r\n')]) {
    const document = parse(source);
    assert.equal(serializeJournal(document), source);
    assert.equal(serializeJournal(structuredClone(document)), source);
    assert.match(document.scratchpad, /2099-01-01/);
  }
});

test('creating a journal gives one durable document identity and all three sections', () => {
  const document = createJournal('example');
  assert.equal(readJournal(document.source).model.documentId, 'example');
  assert.equal(document.scratchpad, '');
  const next = edit(document, next => next.days.push({ date: '2026-11-16', items: [item('first', '**A** new task')] }));
  assert.equal(next.days[0].items[0].id, 'first');
  assert.equal(next.days[0].items[0].text, '**A** new task');
  assert.equal(readJournal(next.source).model.documentId, 'example');
});

test('title, checkbox and metadata edits retain unrelated prose, tables, fences and source spelling', () => {
  const source = fixture.replace('- [ ] Trip', 'Prose with  two spaces.\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n- [ ] Trip');
  const document = parse(source);
  const next = edit(document, next => { next.days[0].items[2].text = 'Longer trip'; next.days[0].items[2].span.through = '2026-11-20'; });
  assert.match(next.source, /Prose with  two spaces\.\n\n\| A \| B \|/);
  assert.match(next.source, /span: all-day through 2026-11-20/);
  assert.equal(next.scratchpad, document.scratchpad);
  assert.equal(next.source.includes('id: team-sync\n  repeat: weekly on mon; series standup'), true);
});

test('deleting and reordering entries preserves their full ordinary Markdown bodies', () => {
  const source = fixture.replace('  id: team-sync', '  id: team-sync').replace('- [ ] Night shift', '- [ ] Night shift\n\n  > Hand-off context\n\n  ```mermaid\n  graph TD; A-->B\n  ```');
  const document = parse(source);
  const next = edit(document, next => { const [night] = next.days[0].items.splice(3, 1); next.days[0].items.splice(1, 0, night); });
  assert.deepEqual(next.days[0].items.map(item => item.text), ['Water plants #home', 'Night shift', '09:00-09:30 Team sync #work', 'Trip']);
  assert.equal((next.source.match(/Hand-off context/g) ?? []).length, 1);
  assert.equal((next.source.match(/graph TD; A-->B/g) ?? []).length, 1);
  assert.match(next.source, /span: 22:00 to 2026-11-17 06:00/);
});

test('moving an entry across dates retains ID, body and explicitly changed span', () => {
  const document = parse(fixture);
  const next = edit(document, next => {
    const [trip] = next.days[0].items.splice(2, 1);
    trip.span.through = '2026-11-19';
    next.days[1].items.push(trip);
  });
  const trip = next.days[1].items.find(item => item.text === 'Trip');
  assert.ok(trip.id && !trip.id.startsWith('source:'));
  assert.equal(trip.span.through, '2026-11-19');
  assert.equal(next.days[0].items.some(item => item.text === 'Trip'), false);
  assert.equal(next.scratchpad, document.scratchpad);
});

test('planning details can change, reorder, grow and shrink without dropping opaque body content', () => {
  const document = parse(fixture.replace('  - [x] Confirm agenda', '  - [x] Confirm agenda\n\n    > Context stays with this detail'));
  const next = edit(document, next => {
    const meeting = next.days[0].items[1];
    meeting.details.reverse();
    meeting.details[1].text = 'Confirm updated agenda';
    meeting.details.push({ text: 'New detail', completed: false });
  });
  assert.deepEqual(next.days[0].items[1].details.map(detail => detail.text), ['Share update', 'Confirm updated agenda', 'New detail']);
  assert.equal((next.source.match(/Context stays with this detail/g) ?? []).length, 1);
  const reduced = edit(next, next => next.days[0].items[1].details.splice(0, 1));
  assert.deepEqual(reduced.days[0].items[1].details.map(detail => detail.text), ['Confirm updated agenda', 'New detail']);
  assert.match(reduced.source, /Context stays with this detail/);
});

test('scratchpad updates are the same canonical document transaction', () => {
  const document = parse(fixture);
  const text = '\n## Dated\n### 1900-01-01\n- [ ] still raw\n';
  const next = withScratchpad(document, text);
  assert.equal(next.scratchpad, text);
  assert.deepEqual(next.days, document.days);
  assert.equal(next.source.slice(0, readJournal(document.source).model.scratchpad.start), document.source.slice(0, readJournal(document.source).model.scratchpad.start));
  assert.equal(serializeJournal(document), fixture, 'undo snapshot remains exact');
});

test('a capture promotion commits both new entries and the cut in one source result', () => {
  const document = withScratchpad(createJournal('capture-test'), 'Meeting\nFollow up\n\nKeep this.\n');
  const next = edit(document, next => {
    next.undated[0].items.push(item('meeting', 'Meeting', [{ text: 'Follow up', completed: false }]));
    next.scratchpad = '\nKeep this.\n';
  });
  assert.equal(next.undated[0].items[0].details[0].text, 'Follow up');
  assert.equal(next.scratchpad, '\nKeep this.\n');
  assert.equal(parse(next.source).scratchpad, '\nKeep this.\n');
});

test('after-completion recurrence and successor identity commit through the same source adapter', () => {
  const document = parse(fixture);
  const next = structuredClone(document);
  const first = next.days[0].items[0];
  first.completed = false; first.completedOn = undefined; first.details[0].completed = false;
  const reopened = materializeJournal(next);
  const completed = structuredClone(reopened);
  completed.days[0].items[0].completed = true; completed.days[0].items[0].details[0].completed = true;
  advanceRecurrences(reopened, completed, '2026-11-17');
  const saved = materializeJournal(completed);
  assert.equal(saved.days[0].items[0].completedOn, '2026-11-17');
  const successor = saved.days.find(day => day.date === '2026-11-20').items[0];
  assert.equal(successor.repeat.series, 'watering');
  assert.equal(successor.repeat.occurrence, 2);
  assert.notEqual(successor.id, first.id);
  assert.equal(saved.scratchpad, document.scratchpad);
});

test('new groups stay within their section even with unrelated top-level notes', () => {
  const document = parse(createJournal('notes').source.replace('## Undated', '## Notes\n\nUnrelated page.\n\n## Undated'));
  const next = edit(document, next => next.days.push({ date: '2026-11-17', items: [item('new', 'Task')] }));
  assert.equal(next.days[0].items[0].id, 'new');
  assert.match(next.source, /## Notes\n\nUnrelated page\./);
  assert.equal(next.source.indexOf('### 2026-11-17') < next.source.indexOf('## Notes'), true);
});

test('explicit one-off model conversion preserves literal text and includes local scratchpad', () => {
  const model = { days: [{ date: '2026-11-16', keepEmpty: true, items: [item('old', '*literal* [x] #tag', [{ text: '<b>literal</b>', completed: false }])] }], undated: [{ name: 'Inbox', items: [] }] };
  const document = journalFromModel(model, 'Private capture now shared', 'converted');
  const parsed = readJournal(document.source).model.days[0].entries[0];
  assert.equal(parsed.text, '*literal* [x] #tag');
  assert.equal(parsed.details[0].text, '<b>literal</b>');
  assert.equal(document.scratchpad, 'Private capture now shared');
  assert.equal(document.days[0].items[0].text, escapeMarkdownText(model.days[0].items[0].text));
});

test('unknown versions, malformed content and missing source never use a TXT serialization fallback', () => {
  assert.throws(() => serializeJournal({ days: [] }), /no Markdown source/);
  const bad = parseJournal(fixture.replace('hcb-format: 1', 'hcb-format: 999'));
  assert.ok(bad.issues.length);
  assert.throws(() => materializeJournal(bad.document), /Only hcb-format/);
  assert.ok(parseJournal('2026-11-16\n\nOld file\n').issues.length);
});

test('title-only edits retain the exact spelling and delimiter of the same entry metadata', () => {
  const source = fixture.replace('  ```hcb\n  id: team-sync\n  repeat: weekly on mon; series standup\n  skip: 2026-11-23\n  ```', '  ~~~~hcb\n  skip: 2026-11-23  \n  repeat: weekly on mon; series standup\n  id: team-sync\n  ~~~~');
  const document = parse(source);
  const next = edit(document, next => { next.days[0].items[1].text = '09:00-09:30 Updated meeting'; });
  assert.equal(next.source, source.replace('09:00-09:30 Team sync #work','09:00-09:30 Updated meeting'));
});

test('a repeated serialization of one edit assigns one identity to an externally authored entry', () => {
  const document = parse(fixture);
  const next = structuredClone(document);
  next.days[0].items[2].text = 'Updated trip';
  assert.equal(serializeJournal(next), serializeJournal(next));
  assert.ok(!materializeJournal(next).days[0].items[2].id.startsWith('source:'));
});

test('after-completion successors retain rich bodies, detail provenance and span duration', () => {
  const source = fixture.replace('  completed: 2026-11-16', '  span: all-day through 2026-11-18\n  completed: 2026-11-16').replace('  - [x] Check soil', '  > Instructions remain with each occurrence.\n\n  - [x] Check soil\n\n    A detailed note.');
  const document = parse(source);
  const reopened = edit(document, next => { const water = next.days[0].items[0]; water.completed = false; water.completedOn = undefined; water.details[0].completed = false; });
  const next = structuredClone(reopened);
  next.days[0].items[0].completed = true; next.days[0].items[0].details[0].completed = true;
  advanceRecurrences(reopened,next,'2026-11-17');
  const saved = materializeJournal(next);
  assert.equal((saved.source.match(/Instructions remain with each occurrence/g) ?? []).length,2);
  assert.equal((saved.source.match(/A detailed note/g) ?? []).length,2);
  assert.equal(saved.days.find(day => day.date === '2026-11-20').items[0].span.through,'2026-11-22');
});

test('raw captured checkbox and heading prefixes stay plain undated titles', () => {
  for (const text of ['- [ ] A task','[x] A literal marker','# A heading','> A quote','1. A step','<div>Raw HTML</div>']) {
    const document = createJournal('capture');
    const next = edit(document, next => next.undated[0].items.push(item('literal',text)));
    assert.equal(readJournal(next.source).model.undated[0].entries[0].text,text);
    assert.equal(next.undated[0].items[0].completed,false);
  }
});

test('canonical parsed views are immutable so a caller cannot poison later reads from the source cache', () => {
  const document = parse(fixture);
  assert.throws(()=>{document.scratchpad='Poisoned';},TypeError);
  assert.throws(()=>{document.days[0].items[0].text='Poisoned';},TypeError);
  assert.equal(readJournal(fixture).document.source,fixture);
});

test('list names stay literal Markdown and renaming retains prose and entry bodies in place', () => {
  const original = createJournal('lists');
  const added = edit(original, next => next.undated.push({ name: '**Ideas** #', items: [item('idea','Write a talk')] }));
  assert.equal(added.undated[1].name,'**Ideas** #');
  const source = added.source.replace('- Write a talk','Prose before the entry.\n\n- Write a talk').replace('  id: idea\n  ```','  id: idea\n  ```\n\n  > Retain this body.');
  const before = parse(source);
  const renamed = edit(before, next => { next.undated[1].name='[Links] <examples>'; });
  assert.equal(renamed.source,source.replace('### \\*\\*Ideas\\*\\* \\#','### \\[Links\\] \\<examples\\>'));
  assert.equal(renamed.undated[1].name,'[Links] <examples>');
  assert.equal(renamed.undated[1].items[0].id,'idea');
});

test('source cache models cannot be mutated and multiple leading BOMs are rejected before offset calculation', () => {
  assert.throws(()=>{readJournal(fixture).model.days[0].entries[0].range.start=0;},TypeError);
  assert.throws(()=>parseJournal('\ufeff\ufeff'+fixture),/one leading/);
});

test('soft-wrapped timed titles retain their block through source and task operations', async () => {
  const { parseTimeBlock, setTimeBlock } = await import('../src/timeBlock.ts');
  const title = '09:00-09:30 Team\n  planning';
  const document = parse(fixture.replace('09:00-09:30 Team sync #work', title));
  assert.deepEqual(parseTimeBlock(document.days[0].items[1].text), { start:'09:00',end:'09:30',title:'Team\n  planning' });
  const saved = edit(document, next => { next.days[0].items[1].text = setTimeBlock(next.days[0].items[1].text,'10:00','11:00'); });
  assert.deepEqual(readJournal(saved.source).model.days[0].entries[1].timeBlock,{ start:'10:00',end:'11:00' });
});

test('dating and undating an entry converts every detail marker without hiding its content or body', () => {
  let document = createJournal('placement');
  document = edit(document, next => next.undated[0].items.push(item('talk','Draft a talk',[{text:'possible venue',completed:false}])));
  document = parse(document.source.replace('  - possible venue','  - possible venue\n\n    > Detailed context.'));
  const dated = edit(document, next => { const entry = next.undated[0].items.pop(); next.days.push({date:'2026-11-17',items:[entry]}); });
  assert.equal(dated.days[0].items[0].details[0].text,'possible venue');
  assert.ok(dated.source.includes('  - [ ] possible venue'));
  assert.ok(dated.source.includes('> Detailed context.'));
  const undated = edit(dated, next => { const entry = next.days[0].items.pop(); next.undated[0].items.push(entry); });
  assert.equal(undated.undated[0].items[0].details[0].text,'possible venue');
  assert.ok(undated.source.includes('  - possible venue'));
  assert.ok(!undated.source.includes('  - [ ] possible venue'));
  assert.ok(undated.source.includes('> Detailed context.'));
  assert.equal(undated.undated[0].items[0].id,'talk');
});

test('entry demotion removes obsolete identity metadata so promotion works again without duplicate active blocks', () => {
  let document = createJournal('promotion');
  document = edit(document, next => next.undated[0].items.push(item('one','One'),item('two','Two')));
  document = parse(document.source.replace('  id: one\n  ```','  id: one\n  ```\n\n  > Keep original context.'));
  const demoted = edit(document, next => { const [one] = next.undated[0].items.splice(0,1); next.undated[0].items[0].details.push({text:one.text,completed:false,sourceRef:one.sourceRef}); });
  assert.ok(!demoted.source.includes('id: one'));
  const promoted = edit(demoted, next => { const detail = next.undated[0].items[0].details.pop(); next.undated[0].items.push({...detail,id:'promoted-one',details:[]}); });
  assert.deepEqual(promoted.undated[0].items.map(item=>item.text),['Two','One']);
  assert.ok(promoted.source.includes('> Keep original context.'));
  assert.deepEqual(parseJournal(promoted.source).issues,[]);
});
