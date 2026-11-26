import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './fixture.mjs';
async function events(app){const abort=new AbortController(),r=await fetch(app.url+'/api/events',{signal:abort.signal}),reader=r.body.pipeThrough(new TextDecoderStream()).getReader();let buffer='';return{close:()=>abort.abort(),async until(predicate){const timer=setTimeout(()=>abort.abort(),15000);try{for(;;){let n;while((n=buffer.indexOf('\n\n'))>=0){const v=JSON.parse(buffer.slice(6,n));buffer=buffer.slice(n+2);if(!v.switching&&predicate(v))return v;}const p=await reader.read();if(p.done)throw Error('No matching state');buffer+=p.value;}}finally{clearTimeout(timer);}}};}
async function action(app,body){const r=await fetch(app.url+'/api/action',{method:'POST',headers:{'Content-Type':'application/json',Origin:app.url},body:JSON.stringify(body)});const result=await r.json();assert.equal(r.status,200,JSON.stringify(result));return result;}
test('context telemetry follows the actual selected model without reusing its predecessor or making inference on selection',{timeout:30000},async()=>{
 const app=await fixture({contextWindow:65536,modelWindows:{'fixture-wide':131072},conversationalReplies:true,introductionStatus:'skipped'});let live;
 try{live=await events(app);let state=await live.until(v=>v.state?.primary);
 assert.equal(state.state.composer.context.policy.window,65536);assert.equal(state.state.composer.context.last,undefined);
 await action(app,{op:'send',context:state.context,id:randomUUID(),text:'Hello, tell me about this day.',files:[]});state=await live.until(v=>v.state?.dialogue?.some(t=>t.text==='Hello, tell me about this day.'&&t.state==='answered'));
 const first=state.state.composer.context.last;assert.equal(first.policy.model,'fixture');assert.ok(first.input_tokens>100);assert.ok(first.input_tokens<=first.input_limit);assert.equal(first.policy.window,65536);assert.equal(first.output_reserve,4096);
 assert.doesNotMatch(JSON.stringify(first),/Hello|system|messages|api_key/i);
 const calls=app.payloads.length;
 await action(app,{op:'frame',context:state.context,frame:{type:'composer',composer:{id:state.state.composer.id,request_id:randomUUID(),action:'model',provider:'fixture',model:'fixture-wide'}}});
 state=await live.until(v=>v.state?.model==='fixture-wide');assert.equal(state.state.composer.context.policy.window,131072);assert.equal(state.state.composer.context.last,undefined);assert.equal(app.payloads.length,calls);
 await action(app,{op:'send',context:state.context,id:randomUUID(),text:'Keep things concise for the next reply.',files:[]});state=await live.until(v=>v.state?.dialogue?.some(t=>t.text==='Keep things concise for the next reply.'&&t.state==='answered'));
 const second=state.state.composer.context.last;assert.equal(second.policy.model,'fixture-wide');assert.equal(second.policy.window,131072);assert.ok(second.input_tokens>0);
 live.close();await app.restart();live=await events(app);state=await live.until(v=>v.state?.primary);assert.equal(state.state.composer.context.last.input_tokens,second.input_tokens);
 }finally{live?.close();await app.close();}
});
