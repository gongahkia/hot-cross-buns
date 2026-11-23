import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fixture } from './fixture.mjs';

async function events(url){
 const abort=new AbortController(),response=await fetch(url+'/api/events',{signal:abort.signal}),reader=response.body.pipeThrough(new TextDecoderStream()).getReader();let buffer='';
 return {close:()=>abort.abort(),async until(predicate){const timer=setTimeout(()=>abort.abort(),15000);try{while(true){const end=buffer.indexOf('\n\n');if(end>=0){const value=JSON.parse(buffer.slice(6,end));buffer=buffer.slice(end+2);if(predicate(value))return value;}else{const part=await reader.read();if(part.done)throw Error('Stream closed');buffer+=part.value;}}}finally{clearTimeout(timer);}}};
}
async function action(app,body){const response=await fetch(app.url+'/api/action',{method:'POST',headers:{'Content-Type':'application/json',Origin:app.url},body:JSON.stringify(body)});return {status:response.status,value:await response.json()};}

test('quoted response drafts validate retained excerpts, reach the backend and remain idempotent',{timeout:45000},async()=>{
 const app=await fixture({chatCount:1,dialogueCount:3});let live;
 try{
  live=await events(app.url);const state=await live.until(value=>value.responses?.length>0&&value.state?.conversation_id),context=state.context,ref=state.responses[0];
  let result=await action(app,{op:'response',action:'quote',context,id:ref.id,digest:ref.digest,text:'Invented response text'});assert.equal(result.status,400);
  result=await action(app,{op:'response',action:'quote',context,id:ref.id,digest:ref.digest,text:'A quiet note 1.'});assert.equal(result.status,200);const quote=result.value.response_quote;assert.equal(quote.text,'A quiet note 1.');
  result=await action(app,{op:'save',context,text:'Explain this passage.'});assert.equal(result.status,200);assert.deepEqual(result.value.response_quote,quote);
  const restored=await action(app,{op:'draft',context});assert.deepEqual(restored.value.response_quote,quote);
  const invalid=await action(app,{op:'send',context,id:randomUUID(),text:'Explain this passage.',files:[],response_quote:{...quote,text:'Invented'}});assert.equal(invalid.status,409);
  const request={op:'send',context,id:randomUUID(),text:'Explain this passage.',files:[],response_quote:quote};
  assert.equal((await action(app,request)).status,200);assert.equal((await action(app,request)).status,200);
  const admitted=await live.until(value=>value.state?.dialogue?.some(turn=>turn.text?.endsWith('Explain this passage.')));
  const turn=admitted.state.dialogue.find(turn=>turn.text.endsWith('Explain this passage.'));assert.match(turn.text,/Quoted assistant response/);assert.match(turn.text,/A quiet note 1\./);
  assert.equal((await action(app,{op:'draft',context:admitted.context})).value.response_quote,undefined);
 }finally{live?.close();await app.close();}
});

test('quotes remain usable without writing unsent content when saved drafts are disabled',{timeout:45000},async()=>{
 const app=await fixture({chatCount:1,dialogueCount:3,draftsEnabled:false});let live;
 try{
  live=await events(app.url);const state=await live.until(value=>value.responses?.length>0&&value.state?.conversation_id),context=state.context,ref=state.responses[0];
  const choose={op:'response',action:'quote',context,id:ref.id,digest:ref.digest,text:'A quiet note 1.',draftText:'Keep my unsent question.'};
  let result=await action(app,choose);assert.equal(result.status,200);assert.equal(result.value.text,choose.draftText);
  assert.deepEqual(JSON.parse(await readFile(app.draftFile,'utf8')),{version:1,enabled:false,drafts:[]});
  result=await action(app,{op:'response',action:'clear',context,draftText:choose.draftText});assert.equal(result.status,200);assert.equal(result.value.text,choose.draftText);assert.equal(result.value.response_quote,undefined);
  assert.equal((await action(app,{op:'draft',context})).value.response_quote,undefined);
  result=await action(app,choose);assert.equal(result.status,200);const quote=result.value.response_quote;
  assert.equal((await action(app,{op:'save',context,text:choose.draftText})).status,200);
  assert.deepEqual((await action(app,{op:'draft',context})).value.response_quote,quote);
  assert.equal((await action(app,{op:'response',action:'validate',context})).status,200);
  assert.equal((await action(app,{op:'send',context,id:randomUUID(),text:choose.draftText,files:[],response_quote:quote})).status,200);
  await live.until(value=>value.state?.messages?.some(message=>message.text?.includes('Keep my unsent question.'))||value.state?.dialogue?.some(turn=>turn.text?.includes('Keep my unsent question.')));
  assert.equal((await action(app,{op:'draft',context})).value.response_quote,undefined);
  assert.deepEqual(JSON.parse(await readFile(app.draftFile,'utf8')),{version:1,enabled:false,drafts:[]});
 }finally{live?.close();await app.close();}
});

test('forking a dialogue response retains its boundary, leaves the parent draft and starts no model work',{timeout:45000},async()=>{
 const app=await fixture({chatCount:1,dialogueCount:4});let live;
 try{
  live=await events(app.url);const parent=await live.until(value=>value.responses?.length>0&&value.state?.conversation_id),context=parent.context,ref=parent.responses[0];
  assert.equal((await action(app,{op:'save',context,text:'Unsent parent note'})).status,200);
  const forked=await action(app,{op:'response',action:'fork',context,id:ref.id,digest:ref.digest,requestId:randomUUID()});assert.equal(forked.status,200,JSON.stringify(forked.value));
  const child=await live.until(value=>value.state?.conversation_id===forked.value.conversation_id&&value.state?.dialogue?.length);
  assert.notEqual(child.context,context);assert.equal(child.state.dialogue.length,1);assert.match(child.state.dialogue[0].response,/A quiet note 1/);assert.equal(app.payloads.length,0);
  assert.equal((await action(app,{op:'response',action:'reply',context:child.context,id:ref.id,digest:ref.digest})).status,409);
  assert.equal((await action(app,{op:'draft',context:child.context})).value.text,'');
  assert.equal((await action(app,{op:'open-work',context:child.context,id:parent.state.conversation_id})).status,200);
  const back=await live.until(value=>value.state?.conversation_id===parent.state.conversation_id);
  assert.equal((await action(app,{op:'draft',context:back.context})).value.text,'Unsent parent note');
 }finally{live?.close();await app.close();}
});
