import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname,join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fixture } from './fixture.mjs';

async function liveState(app){
 const abort=new AbortController(),response=await fetch(app.url+'/api/events',{signal:abort.signal}),reader=response.body.pipeThrough(new TextDecoderStream()).getReader();let buffer='';
 return {close:()=>abort.abort(),async until(predicate){const timer=setTimeout(()=>abort.abort(),20000);try{while(true){const end=buffer.indexOf('\n\n');if(end>=0){const value=JSON.parse(buffer.slice(6,end));buffer=buffer.slice(end+2);if(predicate(value)&&!value.switching)return value;}else{const part=await reader.read();if(part.done)throw Error('Stream closed');buffer+=part.value;}}}finally{clearTimeout(timer);}}};
}

test('onboarding uses the real chat admission and one confirmed memory batch across a cold restart',{timeout:45000},async()=>{
 const app=await fixture({introductionReplies:true,conversationalReplies:true});let live;
 try{
  live=await liveState(app);let state=await live.until(value=>value.state?.primary);
  const request=async body=>{const response=await fetch(app.url+'/api/action',{method:'POST',headers:{Origin:app.url,'Content-Type':'application/json'},body:JSON.stringify({context:state.context,...body})});const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;};
  await request({op:'introduction',action:'intro_status',timezone:'Asia/Singapore'});
  await request({op:'introduction',action:'intro_start',timezone:'Asia/Singapore'});
  state=await live.until(value=>value.state?.messages?.some(message=>message.text.includes('What should I call you?')));
  assert.equal(state.state.messages.filter(message=>message.role==='You').length,0);assert.equal(app.payloads.length,0);assert.equal(state.state.desktop?.introduction_chat,undefined);
  await request({op:'send',id:randomUUID(),text:'My name is Alice.',files:[]});
  state=await live.until(value=>value.state?.dialogue?.some(turn=>turn.text==='My name is Alice.'&&turn.state==='answered'));
  assert.match(state.state.dialogue.at(-1).response,/How would/);assert.equal(state.state.peers?.length||0,0);assert.equal((await request({op:'memory',action:'list'})).total,0);
  await request({op:'send',id:randomUUID(),text:'Casual and concise. A garden project.',files:[]});
  state=await live.until(value=>value.state?.dialogue?.some(turn=>turn.response?.includes('Want me to save these together?')));
  assert.equal((await request({op:'memory',action:'list'})).total,0);
  live.close();await app.restart();live=await liveState(app);state=await live.until(value=>value.state?.primary);
  const before=state.state.messages.filter(message=>message.text.includes('What should I call you?')).length;
  await request({op:'introduction',action:'intro_start',timezone:'Asia/Singapore'});assert.equal(before,1);
  await request({op:'send',id:randomUUID(),text:'yes please',files:[]});
  state=await live.until(value=>value.state?.dialogue?.some(turn=>turn.text==='yes please'&&turn.state==='answered'));
  assert.match(state.state.dialogue.at(-1).response,/Saved to memory/);assert.equal((await request({op:'memory',action:'list'})).total,3);
  assert.equal((await request({op:'introduction',action:'intro_status',timezone:'UTC'})).status,'completed');
  assert.equal(app.payloads.filter(payload=>payload.messages.some(message=>message.role==='system'&&message.content.includes('one-time onboarding conversation'))).length,2);
  await request({op:'send',id:randomUUID(),text:'Let’s get on with our conversation.',files:[]});
  state=await live.until(value=>value.state?.dialogue?.some(turn=>turn.text==='Let’s get on with our conversation.'&&turn.state==='answered'));assert.match(state.state.dialogue.at(-1).response,/continuing conversation/);
 }finally{live?.close();await app.close();}
});

test('first-load timezone is detected once and introduction answers save in one explicit batch', {timeout:30000},async()=>{
 const app=await fixture(),abort=new AbortController();
 try{
  const response=await fetch(app.url+'/api/events',{signal:abort.signal}),reader=response.body.pipeThrough(new TextDecoderStream()).getReader();let text='';while(!text.includes('\n\n'))text+=(await reader.read()).value;
  const context=JSON.parse(text.slice(6,text.indexOf('\n\n'))).context;
  const request=async body=>{const response=await fetch(app.url+'/api/action',{method:'POST',headers:{Origin:app.url,'Content-Type':'application/json'},body:JSON.stringify({context,...body})});return {status:response.status,value:await response.json()};};
  const first=await request({op:'introduction',action:'intro_status',timezone:'Asia/Singapore'});assert.equal(first.status,200);assert.equal(first.value.timezone,'Asia/Singapore');assert.equal(first.value.status,'');
  assert.equal((await request({op:'memory',action:'list'})).value.total,0);
  const before=await request({op:'introduction',action:'intro_status',timezone:'America/New_York'});assert.equal(before.value.timezone,'Asia/Singapore');
  const answers={op:'introduction',action:'intro_save',timezone:'Asia/Singapore',revision:first.value.revision,name:'Alice',style:'Casual and concise',personal_context:'I maintain a garden project.'};
  const saved=await request(answers);assert.equal(saved.status,200);assert.equal(saved.value.status,'completed');
  const memories=await request({op:'memory',action:'list'});assert.equal(memories.value.total,3);assert.equal(memories.value.categories['Projects and goals'],1);
  assert.equal((await request(answers)).status,409);assert.equal((await request({op:'memory',action:'list'})).value.total,3);
  assert.equal((await request({...answers,context:'conversation:stale'})).status,409);
  const again=await request({op:'introduction',action:'intro_status',timezone:'UTC'});assert.equal(again.value.status,'completed');assert.equal(again.value.timezone,'Asia/Singapore');
  assert.equal((await request({op:'introduction',action:'intro_status',timezone:'not/a-zone'})).status,409);
  const root=dirname(dirname(dirname(app.draftFile)));const settings=JSON.parse(await readFile(join(root,'config','hot-cross-buns','config.json'),'utf8'));assert.equal(settings.job_defaults.timezone,'Asia/Singapore');
  assert.equal(app.payloads.length,0);
 }finally{abort.abort();await app.close();}
});

test('the web-owned scheduler starts on return and stops with its host', {timeout:30000},async()=>{
 const app=await fixture({startScheduler:true}),root=dirname(dirname(dirname(app.draftFile)));let pid;
 try{
  for(let attempt=0;attempt<100;attempt++){
   try{pid=JSON.parse(await readFile(join(root,'state','hot-cross-buns','jobs','supervisor.json'),'utf8')).pid;if(pid)break;}catch{}
   await new Promise(resolve=>setTimeout(resolve,30));
  }
  assert.ok(pid,'Local scheduler did not start');assert.doesNotThrow(()=>process.kill(pid,0));assert.equal(app.payloads.length,0);
 }finally{await app.close();}
 assert.throws(()=>process.kill(pid,0));
});
