import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { fixture } from './fixture.mjs';

async function events(app) {
  const abort=new AbortController();
  const response=await fetch(app.url+'/api/events',{signal:abort.signal});
  const reader=response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer='';
  return {close:()=>abort.abort(), async until(predicate) {
    const timer=setTimeout(()=>abort.abort(),15000);
    try {while(true) {
      const end=buffer.indexOf('\n\n');
      if(end>=0) {const value=JSON.parse(buffer.slice(6,end));buffer=buffer.slice(end+2);if(predicate(value)&&!value.switching)return value;}
      else {const part=await reader.read();if(part.done)throw Error('Stream closed');buffer+=part.value;}
    }} finally {clearTimeout(timer);}
  }};
}
async function action(app, body) {
  const response=await fetch(app.url+'/api/action',{method:'POST',headers:{'Content-Type':'application/json',Origin:app.url},body:JSON.stringify(body)});
  const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;
}

test('cold launch returns to main after visiting a side chat and preserves both drafts and main history',{timeout:45000},async()=>{
  const app=await fixture({chatCount:2,dialogueCount:3});let live;
  try {
    live=await events(app);const main=await live.until(value=>value.state?.primary);
    assert.equal(main.state.conversation_id,app.seededChats[0].id);
    const history=main.state.dialogue;
    assert.equal(history.length,3);
    await action(app,{op:'save',context:main.context,text:'Main draft stays here.'});
    const chats=await action(app,{op:'chats',context:main.context});
    const topic=chats.items.find(item=>item.id===app.seededChats[1].id);
    await action(app,{op:'open-chat',context:main.context,selection:topic.selection});
    const side=await live.until(value=>value.state?.conversation_id===topic.id);
    assert.equal(side.state.primary,false);
    assert.equal(side.state.primary_conversation_id,main.state.conversation_id);
    await action(app,{op:'save',context:side.context,text:'Side draft stays separate.'});
    live.close();await app.restart();
    live=await events(app);const resumed=await live.until(value=>value.state?.primary);
    assert.equal(resumed.state.conversation_id,main.state.conversation_id);
    assert.deepEqual(resumed.state.dialogue,history);
    assert.equal((await action(app,{op:'draft',context:resumed.context})).text,'Main draft stays here.');
    const retained=await action(app,{op:'chats',context:resumed.context});
    assert.equal(retained.items.length,2);
    await action(app,{op:'open-chat',context:resumed.context,selection:retained.items.find(item=>item.id===topic.id).selection});
    const selected=await live.until(value=>value.state?.conversation_id===topic.id);
    assert.equal((await action(app,{op:'draft',context:selected.context})).text,'Side draft stays separate.');
    await action(app,{op:'navigate',context:selected.context,route:'/hot-cross-buns'});
    const back=await live.until(value=>value.state?.primary);
    assert.equal(back.state.conversation_id,main.state.conversation_id);
    assert.equal(app.payloads.length,0);
  } finally {live?.close();await app.close();}
});

test('first launch creates main once without adopting retained topics or starting a model',{timeout:45000},async()=>{
  const app=await fixture({chatCount:2,designateMain:false});let live;
  try {
    live=await events(app);const main=await live.until(value=>value.state?.primary);
    assert.ok(!app.seededChats.some(chat=>chat.id===main.state.conversation_id));
    assert.equal(main.state.messages.length,0);
    await action(app,{op:'navigate',context:main.context,route:'/new'});
    const side=await live.until(value=>value.state?.conversation_id&&value.context!==main.context);
    assert.equal(side.state.primary,false);
    live.close();await app.restart();
    live=await events(app);const resumed=await live.until(value=>value.state?.primary);
    assert.equal(resumed.context,main.context);
    const chats=await action(app,{op:'chats',context:resumed.context});
    assert.equal(chats.items.length,4);
    assert.equal(app.payloads.length,0);
  } finally {live?.close();await app.close();}
});

test('returning to main leaves a side task running under its original owner',{timeout:45000},async()=>{
  const app=await fixture();let live;
  try {
    live=await events(app);const main=await live.until(value=>value.state?.primary);
    await action(app,{op:'navigate',context:main.context,route:'/new'});
    const side=await live.until(value=>value.state?.conversation_id&&value.context!==main.context);
    app.blockAfterTool();
    await action(app,{op:'send',context:side.context,id:randomUUID(),text:'Read note.md for fixture activity.',files:[]});
    const working=await live.until(value=>value.state?.running&&value.state?.activity?.entries?.some(entry=>entry.kind==='tool'&&entry.state==='completed'));
    await action(app,{op:'navigate',context:working.context,route:'/hot-cross-buns'});
    const back=await live.until(value=>value.state?.primary);
    assert.equal(back.context,main.context);
    assert.equal(back.tasks.find(task=>task.id===side.state.conversation_id)?.state,'running');
    app.release();
    const done=await live.until(value=>value.tasks?.some(task=>task.id===side.state.conversation_id&&task.state==='completed'));
    assert.equal(done.context,main.context);
  } finally {app.release();live?.close();await app.close();}
});
