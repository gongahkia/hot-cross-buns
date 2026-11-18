import assert from 'node:assert/strict';
import test from 'node:test';
import { createJournalWorkerHost } from '../src/journalWorker.ts';
import { boundedJournalPatches, replayJournalDelta } from '../src/journalTransport.ts';
import { createPlannerIncrementalValidator } from '../src/plannerIncremental.ts';
import { incrementalPlannerChanges, incrementallyValidatePlanner, parseMarkdownPlanner } from '../src/markdownPlanner.ts';
import { journalFromPlanner, readJournal } from '../src/journalDocument.ts';

const source = '---\nhcb-format: 3\ndocument-id: compact-worker\n---\n\n## Dated\n\n### 2026-11-18\n\n- [ ] Alpha\n  - [ ] Child\n\n- [ ] Other\n  ```hcb\n  id: other\n  ```\n\n## Undated\n\n### Inbox\n\n- Notes\n\n## Scratchpad\nCapture.\n';
const edit = () => { const document = structuredClone(readJournal(source).document); document.days[0].items[1].completed = true; return document; };
const normalize = value => JSON.parse(JSON.stringify(value));

test('compact worker edits replay to the full parser model and retain unchanged projections', () => {
 const host=createJournalWorkerHost(), validator=createPlannerIncrementalValidator();
 const initial=structuredClone(host({id:1,kind:'parse',source}));
 const base=validator.seal(initial.model), before=journalFromPlanner(base);
 const wire=structuredClone(host({id:2,kind:'materialize',document:edit(),baselineId:1,profile:true}));
 assert.equal(wire.ok,true);assert.equal('model' in wire,false);assert.equal(wire.delta.baselineId,1);
 assert.equal(wire.delta.patches.length,1);assert.equal(wire.validation,'incremental');
 assert.ok(wire.responseCharacters<500);
 const model=replayJournalDelta(base,wire.delta.patches,validator.validate);
 assert.deepEqual(normalize(model),normalize(parseMarkdownPlanner(source.replace('[ ] Other','[x] Other'))));
 const after=journalFromPlanner(model);
 assert.equal(after.document.days[0].items[0],before.document.days[0].items[0]);
 assert.equal(after.document.undated[0],before.document.undated[0]);
 assert.equal(before.document.days[0].items[1].completed,false);
});

test('receipts bind to the direct baseline and cannot be forged with equivalent copied models',()=>{
 const base=parseMarkdownPlanner(source), next=incrementallyValidatePlanner(base,source.replace('Alpha','Omega'));
 const patches=incrementalPlannerChanges(next,base);
 assert.ok(Object.isFrozen(patches));assert.ok(Object.isFrozen(patches[0]));assert.ok(Object.isFrozen(patches[0].range));
 assert.equal(incrementalPlannerChanges(next,parseMarkdownPlanner(source)),undefined);
 assert.equal(incrementalPlannerChanges(structuredClone(next),base),undefined);
 const later=incrementallyValidatePlanner(next,next.source.replace('Omega','Bravo'));
 assert.equal(incrementalPlannerChanges(later,base),undefined);
 assert.ok(incrementalPlannerChanges(later,next));
});

test('worker source mismatch, missing or evicted baseline, structural edits and forced full requests send complete models',()=>{
 const host=createJournalWorkerHost();host({id:1,kind:'parse',source});
 assert.ok(host({id:2,kind:'materialize',document:edit(),baselineId:999}).model);
 assert.ok(host({id:3,kind:'parse',source:source.replace('Alpha','Omega'),baselineId:1}).model);
 const structural=edit();structural.days[0].items[0].text='Longer title';
 assert.ok(host({id:4,kind:'materialize',document:structural,baselineId:1}).model);
 assert.ok(host({id:5,kind:'materialize',document:edit(),baselineId:1,fullModel:true}).model);
 assert.ok(host({id:6,kind:'materialize',document:edit(),baselineId:1}).model);
 const fresh=createJournalWorkerHost();assert.ok(fresh({id:7,kind:'materialize',document:edit(),baselineId:1}).model);
});

test('worker can rehydrate an undo baseline after the small source cache evicts it',()=>{
 const host=createJournalWorkerHost();host({id:1,kind:'parse',source});
 for(let id=2;id<5;id++)host({id,kind:'parse',source:source.replace('compact-worker',`other-${id}`)});
 const wire=host({id:5,kind:'materialize',document:edit(),baselineId:1});
 assert.ok(wire.delta);assert.equal(wire.delta.baselineId,1);
 const noop=host({id:6,kind:'parse',source,baselineId:1});
 // id 1 is now evicted from the four-slot worker history.
 assert.ok(noop.model);
 const current=host({id:7,kind:'parse',source,baselineId:6});
 assert.deepEqual(current.delta.patches,[]);
});

test('delta replay rejects malformed ranges, fragments, overlaps, size and unsupported syntax',()=>{
 const validator=createPlannerIncrementalValidator(), base=validator.seal(parseMarkdownPlanner(source));
 const at=source.indexOf('Alpha'), safe={range:{start:at,end:at+5},expected:'Alpha',text:'Omega'};
 for(const patches of [null,{},[null],[{}],[{...safe,range:{start:-1,end:4}}],[{...safe,range:{start:at+.5,end:at+5}}],[{...safe,text:'More'}],[{...safe,expected:'Wrong'}],[safe,safe],[{...safe,text:'*Bad*'}],[{...safe,range:{start:source.length,end:source.length+5}}],Array(257).fill(safe)]){
  assert.equal(replayJournalDelta(base,patches,validator.validate),null,JSON.stringify(patches)?.slice(0,100));
 }
 assert.equal(boundedJournalPatches([{range:{start:0,end:40_000},expected:'a'.repeat(40_000),text:'b'.repeat(40_000)}]),false);
 assert.equal(replayJournalDelta(structuredClone(base),[safe],validator.validate),null);
 const metadata=source.indexOf('compact-worker');
 assert.equal(replayJournalDelta(base,[{range:{start:metadata,end:metadata+7},expected:'compact',text:'another'}],validator.validate),null);
 assert.deepEqual(normalize(replayJournalDelta(base,[safe],validator.validate)),normalize(parseMarkdownPlanner(source.replace('Alpha','Omega'))));
});

test('too many validated token changes and unavailable weak receipts fall back to full responses',()=>{
 const wide=source.replace('- [ ] Alpha\n  - [ ] Child', '- [ ] Alpha\n  ```hcb\n  id: alpha\n  ```\n'+Array.from({length:257},(_,index)=>`  - [ ] Child ${index}`).join('\n'));
 const host=createJournalWorkerHost();host({id:1,kind:'parse',source:wide});
 const document=structuredClone(readJournal(wide).document);document.days[0].items[0].completed=true;document.days[0].items[0].details.forEach(detail=>{detail.completed=true;});
 assert.ok(host({id:2,kind:'materialize',document,baselineId:1}).model);
 const NativeWeakRef=globalThis.WeakRef;
 try {
  globalThis.WeakRef=undefined;
  const fresh=createJournalWorkerHost();fresh({id:1,kind:'parse',source});
  assert.ok(fresh({id:2,kind:'materialize',document:edit(),baselineId:1}).model);
 }finally{globalThis.WeakRef=NativeWeakRef;}
});

test('delta replay cannot split UTF-16 pairs or partially complete an outline',()=>{
 const validator=createPlannerIncrementalValidator(),unicode=source.replace('Capture.','Capture 🥐.'),base=validator.seal(parseMarkdownPlanner(unicode));
 const at=unicode.indexOf('🥐');
 assert.equal(replayJournalDelta(base,[{range:{start:at,end:at+1},expected:unicode[at],text:'A'}],validator.validate),null);
 const parent=unicode.indexOf('[ ] Alpha')+1;
 assert.equal(replayJournalDelta(base,[{range:{start:parent,end:parent+1},expected:' ',text:'x'}],validator.validate),null);
});
