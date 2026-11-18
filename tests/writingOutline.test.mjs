import assert from 'node:assert/strict';
import test from 'node:test';
import { materializeJournal, readJournal } from '../src/journalDocument.ts';
import { editWritingOutline, writingChildDraft } from '../src/writingOutline.ts';
import { editWritingFragment } from '../src/journalWriting.ts';
const source='---\nhcb-format: 3\ndocument-id: writing-actions\n---\n\n## Dated\n\n### 2026-11-18\n\nKeep **prose**.\n\n- Parent\n  ```hcb\n  id: parent\n  ```\n  - Context\n    > Keep *attached* text.\n    - [ ] Child\n  - Sibling\n\n- [x] Done\n  ```hcb\n  id: done\n  completed: 2026-11-17\n  ```\n\n## Undated\n\n### Inbox\n\nKeep **undated** prose.\n\n## Scratchpad\nCapture.\n';
const at=(value,text)=>value.indexOf(text);
const parse=value=>{const result=readJournal(value);assert.deepEqual(result.model.issues,[]);return result;};

test('plain/task conversion preserves exact source outside the selected marker',()=>{
 const next=editWritingOutline(source,at(source,'- Context'),'task');parse(next.source);assert.equal(next.source,source.replace('- Context','- [ ] Context'));
 assert.equal(editWritingOutline(next.source,at(next.source,'- [ ] Context'),'plain').source,source);
 assert.throws(()=>editWritingOutline(source,at(source,'- [x] Done'),'plain'),/Reopen/);
});
test('one child draft inherits the selected item style without a durable placeholder',()=>{
 const draft=writingChildDraft(source,at(source,'- Context'));assert.ok(draft.markdown.includes('    - [ ] Child\n    - New child'));assert.equal(draft.markdown.slice(draft.selection,draft.selection+9),'New child');
 const model=parse(source).model,entry=model.days[0].entries[0];const next=editWritingFragment(source,{kind:'dated',date:'2026-11-18'},entry.range,draft.markdown.replace('New child','A child'));
 assert.ok(next.source.includes('    - A child'));assert.ok(next.source.includes('> Keep *attached* text.'));assert.equal(source.includes('New child'),false);
 const task=writingChildDraft(source,at(source,'- [ ] Child'));assert.ok(task.markdown.includes('      - [ ] New child'));
});
test('branch moves and promotion retain rich content and plain-item kind',()=>{
 const moved=editWritingOutline(source,at(source,'- Sibling'),'in');parse(moved.source);assert.equal(moved.days[0].entries[0].details[0].children[1].text,'Sibling');
 const promoted=editWritingOutline(source,at(source,'- Context'),'promote');parse(promoted.source);assert.equal(promoted.days[0].entries[1].kind,'note');assert.equal(promoted.days[0].entries[1].details[0].text,'Child');assert.ok(promoted.source.includes('> Keep *attached* text.'));assert.ok(promoted.source.endsWith('## Scratchpad\nCapture.\n'));
});
test('moving a completed task between documents retains completion, date, identity and prose',()=>{
 const moved=editWritingOutline(source,at(source,'- [x] Done'),{list:'Inbox'});const document=parse(moved.source).document;const item=document.undated[0].items[0];assert.equal(item.id,'done');assert.equal(item.completed,true);assert.equal(item.completedOn,'2026-11-17');assert.ok(moved.source.includes('Keep **undated** prose.'));assert.ok(moved.source.includes('Keep **prose**.'));
 const back=editWritingOutline(moved.source,at(moved.source,'- [x] Done'),{date:'2026-11-19'});assert.equal(parse(back.source).document.days.find(day=>day.date==='2026-11-19').items[0].completed,true);
});
test('scheduled and recurring moves cannot silently discard fields or skip scope',()=>{
 const scheduled=source.replace('id: parent','id: parent\n  span: all-day through 2026-11-20');assert.throws(()=>editWritingOutline(scheduled,at(scheduled,'- Parent'),{list:'Inbox'}),/Clear the schedule/);
 const recurring=source.replace('id: parent','id: parent\n  repeat: daily; series parent');assert.throws(()=>editWritingOutline(recurring,at(recurring,'- Parent'),'task'),/choose which occurrences/);
});

test('identified top-level entries cannot lose their metadata during nesting',()=>{
 assert.throws(()=>editWritingOutline(source,at(source,'- [x] Done'),'in'),/Keep identified/);
 const clean=source.replace('- [x] Done','- Done').replace('  completed: 2026-11-17\n','');
 assert.throws(()=>editWritingOutline(clean,at(clean,'- Done'),'in'),/Keep identified/);
 assert.equal(parse(clean).document.days[0].items[1].id,'done');
});

test('the source adapter rejects metadata-losing demotion even outside contextual controls',()=>{
 const document=structuredClone(parse(source).document);const [child]=document.days[0].items.splice(1,1);
 document.days[0].items[0].details.push({text:child.text,completed:child.completed,sourceRef:child.sourceRef,children:child.details,body:child.body});
 assert.throws(()=>materializeJournal(document),/Keep identified/);assert.equal(parse(source).document.days[0].items[1].id,'done');
});
