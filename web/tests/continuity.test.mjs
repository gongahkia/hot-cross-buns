import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {fixture} from './fixture.mjs';

async function events(app){
 const abort=new AbortController(),response=await fetch(app.url+'/api/events',{signal:abort.signal}),reader=response.body.pipeThrough(new TextDecoderStream()).getReader();let buffer='';
 return {close:()=>abort.abort(),async until(predicate){const timer=setTimeout(()=>abort.abort(),20000);try{while(true){const end=buffer.indexOf('\n\n');if(end>=0){const value=JSON.parse(buffer.slice(6,end));buffer=buffer.slice(end+2);if(predicate(value)&&!value.switching)return value;}else{const part=await reader.read();if(part.done)throw Error('Stream closed');buffer+=part.value;}}}finally{clearTimeout(timer);}}};
}
async function action(app,body){const response=await fetch(app.url+'/api/action',{method:'POST',headers:{'Content-Type':'application/json',Origin:app.url},body:JSON.stringify(body)});const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;}
function routed(app){return app.payloads.flatMap(payload=>{try{const value=JSON.parse(payload.messages.findLast(message=>message.role==='user').content);return typeof value.can_start_task==='boolean'?[value]:[];}catch{return [];}});}
async function say(app,live,context,text){await action(app,{op:'send',context,id:randomUUID(),text,files:[]});return live.until(value=>value.state?.dialogue?.some(turn=>turn.text===text&&turn.state==='answered'));}

test('main chat carries durable summaries and current editable memories through normal replies and cold restart',{timeout:60000},async()=>{
 const app=await fixture({contextWindow:32768,chatCount:1,dialogueCount:24,memories:['I prefer quiet interfaces.'],conversationalReplies:true});let live;
 try{
  live=await events(app);let state=await live.until(value=>value.state?.primary);
  state=await say(app,live,state.context,'Tell me about our ongoing conversation.');
  let request=routed(app).at(-1),context=JSON.parse(request.continuity_context);
  assert.ok(context.summarized_turns>0&&context.summarized_turns<24);assert.match(context.earlier_conversation_summary,/Fixture answer/);
  assert.ok(context.current_memories.some(memory=>memory.text==='I prefer quiet interfaces.'));
  assert.equal(request.recent_messages.at(-1).text,"You're welcome.");
  const summaryCalls=()=>app.payloads.filter(payload=>payload.messages.some(message=>message.role==='system'&&message.content.includes('factual rolling conversation summary'))).length;
  assert.equal(summaryCalls(),1);assert.equal(state.state.running,false);
  const summaryPayload=app.payloads.find(payload=>payload.messages.some(message=>message.role==='system'&&message.content.includes('factual rolling conversation summary')));
  assert.match(summaryPayload.messages.find(message=>message.role==='user').content,/A thought for the day 1/);
  live.close();await app.restart();live=await events(app);state=await live.until(value=>value.state?.primary);
  state=await say(app,live,state.context,'Continue our conversation after reopening.');assert.equal(summaryCalls(),1);
  let catalog=await action(app,{op:'memory',action:'list',context:state.context}),item=catalog.entries[0];
  catalog=await action(app,{op:'memory',action:'correct',context:state.context,id:item.id,revision:item.revision,text:'I prefer detailed interfaces.'});
  state=await say(app,live,state.context,'What interface style should you use for me?');
  context=JSON.parse(routed(app).at(-1).continuity_context);
  assert.ok(context.current_memories.some(memory=>memory.text==='I prefer detailed interfaces.'));
  assert.ok(!context.current_memories.some(memory=>memory.text==='I prefer quiet interfaces.'));
  assert.equal(summaryCalls(),1);
  item=catalog.entries.find(entry=>entry.id===item.id);
  await action(app,{op:'memory',action:'forget',context:state.context,id:item.id,revision:item.revision});
  await say(app,live,state.context,'What do you know about my interface preference now?');
  context=JSON.parse(routed(app).at(-1).continuity_context);
  assert.ok(!context.current_memories?.some(memory=>memory.id===item.id));
 }finally{live?.close();await app.close();}
});

test('a new main chat uses conversational routing before starting any task',{timeout:25000},async()=>{
 const app=await fixture({conversationalReplies:true});let live;
 try{live=await events(app);const state=await live.until(value=>value.state?.primary);const done=await say(app,live,state.context,'Hello, how are we doing today?');assert.equal(done.context,state.context);assert.equal(done.state.running,false);assert.equal(routed(app).length,1);assert.equal(app.payloads.length,1);assert.equal(done.state.dialogue.length,1);}finally{live?.close();await app.close();}
});

test('main chat can discuss a completed delegated result after its worker has closed',{timeout:45000},async()=>{
 const app=await fixture({conversationalReplies:true});let live;
 try{
  live=await events(app);const main=await live.until(value=>value.state?.primary);
  await action(app,{op:'send',context:main.context,id:randomUUID(),text:'Run fixture activity. Read the note and summarize it.',files:[]});
  const completed=await live.until(value=>value.state?.peers?.some(peer=>peer.state==='completed'));
  const child=completed.state.peers.find(peer=>peer.state==='completed').conversation_id;
  const calls=app.payloads.length;
  live.close();await app.restart();live=await events(app);
  const reopened=await live.until(value=>value.state?.primary);
  assert.equal(app.payloads.length,calls);
  await say(app,live,reopened.context,'How did that note summary go?');
  const context=JSON.parse(routed(app).at(-1).continuity_context);
  const result=context.retained_task_results.find(result=>result.conversation_id===child);
  assert.ok(result);assert.equal(result.reported_state,'completed');assert.match(result.summary,/Fixture answer/);
  assert.equal(result.can_guide,false);assert.equal(result.can_stop,false);assert.equal(result.can_correct_action,false);
 }finally{live?.close();await app.close();}
});
