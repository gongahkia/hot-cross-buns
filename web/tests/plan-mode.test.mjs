import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {fixture} from './fixture.mjs';

async function stream(url) {
  const abort=new AbortController(), response=await fetch(url+'/api/events',{signal:abort.signal}), reader=response.body.pipeThrough(new TextDecoderStream()).getReader();let buffer='';
  return {close:()=>abort.abort(),async until(predicate){const timer=setTimeout(()=>abort.abort(),20000);try{while(true){const end=buffer.indexOf('\n\n');if(end>=0){const value=JSON.parse(buffer.slice(6,end));buffer=buffer.slice(end+2);if(predicate(value))return value;}else{const part=await reader.read();if(part.done)throw Error('Stream closed');buffer+=part.value;}}}finally{clearTimeout(timer)}}};
}
async function action(app,body){const response=await fetch(app.url+'/api/action',{method:'POST',headers:{Origin:app.url,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,value:await response.json()};}

test('plan mode retains drafts and answers revise the same plan without starting implementation',{timeout:60000},async()=>{
  const app=await fixture({planningQuestions:true});let live;
  try {
    live=await stream(app.url);const initial=await live.until(s=>s.state?.conversation_id),context=initial.context;
    await action(app,{op:'save',context,text:'Plan how to improve the parser'});
    assert.equal((await action(app,{op:'draft',context})).value.plan_first,undefined);
    assert.equal((await action(app,{op:'send',context,id:randomUUID(),text:'Plan how to improve the parser',files:[]})).status,200);
    const parent=await live.until(s=>s.state?.peers?.some(peer=>peer.state==='review'));
    const peer=parent.state.peers.find(peer=>peer.state==='review');assert.equal(peer.plan_phase,'review');
    const child=peer.conversation_id;
    await action(app,{op:'save',context,text:'Keep the main draft'});
    assert.equal((await action(app,{op:'open-work',context,id:child})).status,200);
    const pending=await live.until(s=>s.state?.conversation_id===child&&s.state.plans?.some(plan=>plan.questions?.length));
    const plan=pending.state.plans.find(plan=>plan.questions?.length),planAction=verb=>action(app,{op:'frame',context:pending.context,frame:{type:'task_plan',task_plan:{conversation_id:child,task_id:plan.id,revision:plan.revision,digest:plan.digest,action:verb,request_id:randomUUID()}}});
    assert.equal((await planAction('approve')).status,409);
    const correction=await action(app,{op:'begin-correction',context:pending.context,kind:'plan',id:plan.id,revision:plan.revision,digest:plan.digest});assert.equal(correction.status,200,JSON.stringify(correction.value));
    const text='Answer to the pending plan question: use JSON. Revise this same plan for review. Do not start work.';
    assert.equal((await action(app,{op:'send',context:correction.value.context,id:randomUUID(),text,files:[],correction:correction.value.correction.id})).status,200);
    await live.until(s=>s.state?.peers?.some(peer=>peer.conversation_id===child&&peer.state==='review')&&!s.state.working);
    const preserved=await action(app,{op:'draft',context});assert.equal(preserved.value.text,'Keep the main draft');assert.equal(preserved.value.plan_first,undefined);
    await action(app,{op:'open-work',context,id:child});
    const revised=await live.until(s=>s.state?.conversation_id===child&&s.state.plans?.some(p=>p.id===plan.id&&p.revision>plan.revision&&p.phase==='review'&&!p.questions?.length));
    assert.equal(revised.state.running,false);assert.equal((await planAction('approve')).status,409);
    assert.ok(app.payloads.some(p=>JSON.stringify(p).includes('use JSON')));
    assert.ok(app.payloads.every(p=>!p.tools?.length));
  } finally {live?.close();await app.close()}
});

test('ordinary chat has no sticky plan mode or plan indicator state',{timeout:30000},async()=>{
  const app=await fixture({conversationalReplies:true});let live;
  try {live=await stream(app.url);const initial=await live.until(s=>s.state?.conversation_id),context=initial.context;
    assert.equal((await action(app,{op:'plan-mode',context,enabled:true})).status,400);
    assert.equal((await action(app,{op:'send',context,id:randomUUID(),text:'Hello there',files:[]})).status,200);
    const reply=await live.until(s=>s.state?.dialogue?.some(turn=>turn.state==='answered'));
    assert.equal(reply.state.plans?.length||0,0);assert.equal(reply.state.peers?.some(peer=>peer.plan_phase)||false,false);
    assert.equal((await action(app,{op:'draft',context})).value.plan_first,undefined);
  }finally{live?.close();await app.close()}
});
