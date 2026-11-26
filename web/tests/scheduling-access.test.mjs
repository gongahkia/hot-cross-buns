import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fixture} from './fixture.mjs';

async function events(app){
 const abort=new AbortController(),response=await fetch(app.url+'/api/events',{signal:abort.signal}),reader=response.body.pipeThrough(new TextDecoderStream()).getReader();let buffer='';
 return {close:()=>abort.abort(),async until(predicate){const timer=setTimeout(()=>abort.abort(),20000);try{while(true){const end=buffer.indexOf('\n\n');if(end>=0){const value=JSON.parse(buffer.slice(6,end));buffer=buffer.slice(end+2);if(predicate(value)&&!value.switching)return value;}else{const part=await reader.read();if(part.done)throw Error('Stream closed');buffer+=part.value;}}}finally{clearTimeout(timer);}}};
}
async function action(app,body){const response=await fetch(app.url+'/api/action',{method:'POST',headers:{Origin:app.url,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,value:await response.json()};}

for(const choice of ['once','always','deny'])test(`chat schedule ${choice} uses an inline exact-action review and retains permission scope`,{timeout:35000},async()=>{
 const app=await fixture({startInSide:true,schedulingTask:true});let live;
 try{
  live=await events(app);let state=await live.until(value=>value.connection==='connected');const context=state.context;
  const send=await action(app,{op:'send',context,id:randomUUID(),text:'Schedule a fixture garden reminder for one hour from now.',files:[]});assert.equal(send.status,200);
  state=await live.until(value=>value.state?.approval?.scheduling);const review=state.state.approval;
  assert.match(review.result.title,/schedule change/i);assert.match(JSON.stringify(review.result.sections),/Once on/);assert.doesNotMatch(JSON.stringify(review.result.sections),/\bcron\b/);
  assert.equal((await action(app,{op:'approve',context,id:'stale',approved:true,permission_choice:'always'})).status,409);
  assert.equal((await action(app,{op:'approve',context,id:review.id,approved:true,permission_choice:'full'})).status,400);
  assert.equal((await action(app,{op:'approve',context,id:review.id,approved:choice!=='deny',...(choice==='deny'?{}:{permission_choice:choice})})).status,200);
  state=await live.until(value=>!value.state?.running&&!value.state?.needsApproval&&value.state?.messages?.some(message=>message.text?.includes('Fixture answer')));
  if(choice!=='deny')state=await live.until(value=>value.scheduled?.entries?.length===1);
  assert.equal(state.scheduled.entries.length,choice==='deny'?0:1);
  const root=dirname(dirname(dirname(app.draftFile))),path=join(root,'state','hot-cross-buns','schedule-permissions','permissions.json');
  let permission;try{permission=JSON.parse(await readFile(path,'utf8'));}catch(error){assert.equal(error.code,'ENOENT');}
  assert.equal(permission?.always_allow===true,choice==='always');
  assert.equal((await action(app,{op:'navigate',context,route:'/permissions'})).status,200);
  state=await live.until(value=>value.state?.panel?.kind==='permissions');
  assert.equal(state.state.panel.rows.some(row=>row.label==='Ask before schedule changes'),choice==='always');
  if(choice==='always'){
   const index=state.state.panel.rows.findIndex(row=>row.label==='Ask before schedule changes');
   assert.equal((await action(app,{op:'frame',context,frame:{type:'panel',panel:{id:state.state.panel.id,action:'activate',row:index}}})).status,200);
   await live.until(value=>value.state?.panel?.notice?.includes('Scheduling permissions updated'));
   assert.equal(JSON.parse(await readFile(path,'utf8')).always_allow,false);
  }
 }finally{live?.close();await app.close();}
});
