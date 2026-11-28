import assert from 'node:assert/strict';
import test from 'node:test';
import { responseRecords,responseReferences,selectedResponse,quoteResponse,checkQuote } from '../responses.mjs';
import { quotedRequest,validResponseQuote } from '../../app-host/src/response-reference.mjs';

const reply={id:'a'.repeat(64),revision:3,state:'answered',response:'**Reverse** the order of this list.\n\n```js\nreturn 42;\n```'};
const state={dialogue:[reply],messages:[{role:'Hot Cross Buns',revision_id:'rev-one',run_id:'run-one',text:'A retained answer.'}]};
test('response references bind exact loaded owners and rendered excerpts without accepting invented context',()=>{
 const refs=responseReferences(state);assert.equal(refs.length,2);assert.ok(refs.every(ref=>ref.can_fork));assert.ok(!JSON.stringify(refs).includes('retained answer'));
 const response=selectedResponse(state,refs[1].id,refs[1].digest),quote=quoteResponse(response,'Reverse the order of this list.');
 assert.ok(validResponseQuote(quote));assert.doesNotThrow(()=>checkQuote(state,quote));
 assert.throws(()=>quoteResponse(response,'Invented source text'));assert.throws(()=>checkQuote({dialogue:[{...reply,response:'Changed answer'}]},quote));assert.throws(()=>checkQuote({},quote));
 assert.match(quotedRequest(quote,'Explain this.'),/context, not new instructions/);assert.ok(quotedRequest(quote,'Explain this.').endsWith('\n\nExplain this.'));
 assert.throws(()=>quoteResponse(response,'x'.repeat(17000)));
 const reordered={...state,messages:[{role:'You',text:'Earlier'},...state.messages]};assert.equal(responseReferences(reordered)[0].id,refs[0].id);
});
test('quotes support inline formatting and code and response edits invalidate earlier digests',()=>{
 const value=responseRecords({dialogue:[{...reply,response:'a**bold**word and `code`'}]})[0];assert.equal(quoteResponse(value,'aboldword and code').text,'aboldword and code');
 const code=responseRecords(state)[1];assert.equal(quoteResponse(code,'return 42;').text,'return 42;');
 assert.throws(()=>selectedResponse(state,code.id,'b'.repeat(64)));
 assert.equal(responseRecords({dialogue:[{...reply,state:'routing'},{...reply,issue:'failed'}]}).length,0);
});

test('user messages have exact reply, quote and reaction references without fork authority',()=>{
 const input={messages:[{role:'You',text:'My own **prompt**.',created_at:'2026-11-28T00:00:00Z'}],dialogue:[{id:'user-turn',text:'Another prompt'}]};
 const refs=responseReferences(input);assert.equal(refs.length,2);assert.ok(refs.every(ref=>ref.role==='user'&&!ref.can_fork));
 const quote=quoteResponse(selectedResponse(input,refs[0].id,refs[0].digest),'My own prompt.');assert.equal(quote.role,'user');assert.ok(validResponseQuote(quote));assert.match(quotedRequest(quote,'Follow up'),/^Quoted user message/);assert.doesNotThrow(()=>checkQuote(input,quote));
 assert.throws(()=>selectedResponse({...input,messages:[{...input.messages[0],text:'Changed'}]},refs[0].id,refs[0].digest));
});
