import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPlannerEdits, incrementallyValidatePlanner, parseMarkdownPlanner, plannerValidationKind, plannerWritable } from '../src/markdownPlanner.ts';
import { createPlannerIncrementalValidator } from '../src/plannerIncremental.ts';
import { journalModel, materializeJournal, readJournal } from '../src/journalDocument.ts';
import { runJournalWork } from '../src/journalWorker.ts';
import { benchmarkPlanner } from '../scripts/markdown-benchmark-fixture.mjs';
import { setItemCompletion } from '../src/outline.ts';

const wrap = (dated, undated = '- Notes', version = 3, capture = '- [ ] Captured checkbox\n') => `---\nhcb-format: ${version}\ndocument-id: incremental-tests\n---\n\n[ref]: https://example.com\n\n[^note]: Footnote **context**.\n\nA [missing target](#hcb-missing).\n\n## Dated\n\n### 2026-11-18\n\n${dated}\n\n## Undated\n\n### Inbox\n\n${undated}\n\n## Scratchpad\n${capture}`;
const parse = source => { const model = parseMarkdownPlanner(source); assert.ok(plannerWritable(model),JSON.stringify(model.issues)); return model; };
const nodes = entry => { const result=[entry],pending=[...entry.details];while(pending.length){const node=pending.pop();result.push(node);pending.push(...node.children??[]);}return result; };
const candidate = (model, edits) => { let source=model.source;for(const edit of [...edits].sort((a,b)=>b.range.start-a.range.start))source=source.slice(0,edit.range.start)+edit.text+source.slice(edit.range.end);return source; };
const equalFull = (before, after) => { const next=incrementallyValidatePlanner(before,after);assert.ok(next,'expected an eligible edit');assert.deepEqual(next,parseMarkdownPlanner(after));assert.equal(plannerValidationKind(next),'incremental');return next; };
const metric = work => { globalThis.__hcbMarkdownMetrics={enabled:true,samples:[]};try{const result=work();return{result,samples:globalThis.__hcbMarkdownMetrics.samples};}finally{delete globalThis.__hcbMarkdownMetrics;} };

test('checkbox edits match complete parsing across formats, markers, rich titles, endings and BOM',()=>{
 const titles=['Alpha','**Alpha**','`Alpha`','[Alpha][ref]','A &amp; B','$$x_i$$','<em>Alpha</em>','https://example.com','\\*Alpha\\*'];
 for(const version of [1,2,3])for(const ending of ['\n','\r\n','\r'])for(const bom of ['', '\uFEFF'])for(const marker of ['-','+','*'])for(const title of titles){
  const source=bom+wrap(`${marker} [ ] ${title}\n  ~~~hcb\n  id: root\n  ~~~\n\n  > [!note] Context\n  > A [link][ref] and note[^note].\n\n  - [ ] First child\n  - [X] Other child\n\n  ~~~mermaid\n  graph TD; A-->B\n  ~~~`,undefined,version).replaceAll('\n',ending);
  const model=parse(source),entry=model.days[0].entries[0],edits=nodes(entry).filter(node=>node.checkbox).map(node=>({range:node.checkbox,text:'x'}));
  const next=equalFull(model,candidate(model,edits));
  equalFull(next,candidate(next,nodes(next.days[0].entries[0]).filter(node=>node.checkbox).map(node=>({range:node.checkbox,text:' '}))));
  assert.equal(model.source,source);
 }
});

test('same-width plain title replacements match the full model throughout mixed outlines',()=>{
 for(const version of [1,2,3])for(const ending of ['\n','\r\n','\r']){
  let model=parse(wrap('- [ ] Alpha\n  ```hcb\n  id: root\n  ```\n  - [ ] First child\n    - [ ] Grand child\n\n    > Attached **context**.\n  - [x] Other child','- Notes\n  - A note',version).replaceAll('\n',ending));
  for(let round=0;round<24;round++){
   const entries=[...model.days[0].entries,...model.undated[0].entries],entry=entries[round%entries.length],node=nodes(entry)[round%nodes(entry).length];
   const text=node.markdown.replace(/[A-Za-z]/g,letter=>letter==='Z'?'A':letter==='z'?'a':String.fromCharCode(letter.charCodeAt(0)+1));
   model=equalFull(model,candidate(model,[{range:node.titleRange,text}]));
  }
 }
});

test('plain parents, deep tasks and undated checkboxes retain their completion semantics',()=>{
 const model=parse(wrap('- Plain\n  ```hcb\n  id: plain\n  ```\n  - Context\n    - [ ] Child\n      - [ ] Grandchild','- [ ] Undated\n  - Context\n    - [ ] Child'));
 for(const entry of [model.days[0].entries[0],model.undated[0].entries[0]]){
  equalFull(model,candidate(model,nodes(entry).filter(node=>node.checkbox).map(node=>({range:node.checkbox,text:'x'}))));
 }
 const numbered=parse(wrap('- [ ] Parent\n\n  1. [ ] Body example'));
 const at=numbered.source.indexOf('[ ] Body')+1;
 assert.equal(incrementallyValidatePlanner(numbered,numbered.source.slice(0,at)+'x'+numbered.source.slice(at+1)),null);
});

test('inconsistent ancestors and completion dates fall back to the full diagnostic validator',()=>{
 const cases=[wrap('- [ ] Parent\n  - [ ] Child'),wrap('- [x] Parent\n  ```hcb\n  completed: 2026-11-17\n  ```'),wrap('- [ ] Parent\n  ```hcb\n  repeat: every 1 day after completion; series parent; occurrence 1\n  ```')];
 for(const source of cases){
  const model=parse(source),entry=model.days[0].entries[0],node=entry.details[0]??entry,edits=[{range:node.checkbox,text:node.completed?' ':'x'}],after=candidate(model,edits);
  assert.equal(incrementallyValidatePlanner(model,after),null);assert.equal(plannerWritable(parseMarkdownPlanner(after)),false);
  assert.throws(()=>applyPlannerEdits(model,source,edits.map(edit=>({...edit,expected:source.slice(edit.range.start,edit.range.end)}))),/invalid planner content/);
 }
});

test('metadata, structure, code, references, scratchpad, Unicode and size changes use complete parsing',()=>{
 const source=wrap('- [ ] Alpha\n  ```hcb\n  id: root\n  ```\n\n  ~~~js\n  const word = "Alpha";\n  ~~~');const model=parse(source),title=model.days[0].entries[0].titleRange;
 const sources=['Bravo longer','日本語です','**A**','$$x$$','[ref]','<div>','A\nB C','09:00'].map(text=>candidate(model,[{range:title,text}]));
 sources.push(source.replace('id: root','id: soot'),source.replace('## Dated','## Other'),source.replace('example.com','example.net'),source.replace('const word','const Word'),source.replace('Captured','captured'),source.replace('~~~js','~~~hcb'),source.replace('2026-11-18','2026-11-19'));
 for(const after of sources){
  assert.equal(incrementallyValidatePlanner(model,after),null);
  const complete=parseMarkdownPlanner(after),patch={range:{start:0,end:source.length},expected:source,text:after};
  if(plannerWritable(complete))assert.deepEqual(applyPlannerEdits(model,source,[patch]),complete);else assert.throws(()=>applyPlannerEdits(model,source,[patch]));
 }
});

test('parser certificates cannot be forged by copying or shallow-freezing mutable models',()=>{
 const model=parse(wrap('- [ ] Alpha')),copy=structuredClone(model),at=model.days[0].entries[0].checkbox.start,after=model.source.slice(0,at)+'x'+model.source.slice(at+1);
 copy.days[0].entries[0].text='Forged';Object.freeze(copy);
 createPlannerIncrementalValidator().seal(copy);
 assert.equal(incrementallyValidatePlanner(copy,after),null);assert.equal(plannerValidationKind(copy),undefined);
 const next=applyPlannerEdits(copy,copy.source,[{range:{start:at,end:at+1},expected:' ',text:'x'}]);assert.deepEqual(next,parseMarkdownPlanner(after));assert.equal(plannerValidationKind(next),'full');
 assert.throws(()=>{model.days[0].entries[0].checkbox.start=0;},TypeError);
 assert.throws(()=>applyPlannerEdits(model,model.source+'stale',[]),/source changed/);
 assert.throws(()=>applyPlannerEdits(model,model.source,[{range:{start:at,end:at+1},expected:'x',text:'x'}]),/fragment changed/);
});

test('broad source-adapter patches reuse unchanged entries and avoid a synchronous full parse',()=>{
 const before=readJournal(wrap('- [ ] Alpha\n  ```hcb\n  id: root\n  ```\n\n- [ ] Bravo\n  ```hcb\n  id: other\n  ```')).document;
 const copy=structuredClone(before);setItemCompletion(copy.days[0].items[0],true);
 const {result:next,samples}=metric(()=>materializeJournal(copy));
 assert.equal(plannerValidationKind(journalModel(next)),'incremental');assert.ok(samples.some(sample=>sample.phase==='incrementalValidation'));assert.ok(!samples.some(sample=>sample.phase==='synchronousParse'));
 assert.equal(journalModel(next).days[0].entries[1],journalModel(before).days[0].entries[1]);assert.deepEqual(journalModel(next),parseMarkdownPlanner(next.source));
});

test('worker completion validates incrementally and a structural edit returns to full parsing',()=>{
 const source=benchmarkPlanner(10000,'2026-11-18'),first=runJournalWork({id:1,kind:'parse',source});assert.equal(first.ok,true);
 const document=structuredClone(readJournal(source).document);setItemCompletion(document.days.at(-1).items[0],true);
 const {result,samples}=metric(()=>runJournalWork({id:2,kind:'materialize',document}));assert.equal(result.ok,true);assert.equal(plannerValidationKind(result.model),'incremental');assert.ok(!samples.some(sample=>sample.phase==='synchronousParse'));assert.deepEqual(result.model,parseMarkdownPlanner(result.model.source));
 const next=structuredClone(readJournal(result.model.source).document);next.days.at(-1).items[0].text+=' extended';const full=runJournalWork({id:3,kind:'materialize',document:next});assert.equal(full.ok,true);assert.equal(plannerValidationKind(full.model),'full');assert.deepEqual(full.model,parseMarkdownPlanner(full.model.source));
});

test('tabbed markers, deep outlines and render-budget fallbacks stay equivalent',()=>{
 for(const prefix of ['-\t[ ] ','  - [ ] ','+  [ ] ']){
  const model=parse(wrap(prefix+'Alpha'));
  const node=model.days[0].entries[0];equalFull(model,candidate(model,[{range:node.checkbox,text:'x'}]));
 }
 const deep='- [ ] Alpha\n'+Array.from({length:32},(_,index)=>'  '.repeat(index+1)+'- [ ] Child').join('\n');
 const model=parse(wrap(deep));equalFull(model,candidate(model,nodes(model.days[0].entries[0]).filter(node=>node.checkbox).map(node=>({range:node.checkbox,text:'x'}))));
 const oversized=parse(wrap('- [ ] Alpha\n\n  '+'A'.repeat(41000)));
 equalFull(oversized,candidate(oversized,[{range:oversized.days[0].entries[0].checkbox,text:'x'}]));
});

test('a safe edit cannot conceal another changed region or update only part of a candidate',()=>{
 const model=parse(wrap('- [ ] Alpha\n  ```hcb\n  id: root\n  ```'));
 const entry=model.days[0].entries[0],changed=candidate(model,[{range:entry.checkbox,text:'x'}]).replace('example.com','example.net');
 assert.equal(incrementallyValidatePlanner(model,changed),null);
 const next=applyPlannerEdits(model,model.source,[{range:{start:0,end:model.source.length},expected:model.source,text:changed}]);
 assert.equal(plannerValidationKind(next),'full');assert.deepEqual(next,parseMarkdownPlanner(changed));assert.equal(model.days[0].entries[0].completed,false);
});
