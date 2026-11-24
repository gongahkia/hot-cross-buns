import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {fixture} from './fixture.mjs';
async function events(url){
 const abort=new AbortController(),response=await fetch(url+'/api/events',{signal:abort.signal}),reader=response.body.pipeThrough(new TextDecoderStream()).getReader();let buffer='';
 return {close:()=>abort.abort(),async until(predicate){const timer=setTimeout(()=>abort.abort(),15000);try{while(true){const end=buffer.indexOf('\n\n');if(end>=0){const value=JSON.parse(buffer.slice(6,end));buffer=buffer.slice(end+2);if(predicate(value))return value;}else{const part=await reader.read();if(part.done)throw Error('Stream closed');buffer+=part.value;}}}finally{clearTimeout(timer);}}};
}
async function action(app,body){const response=await fetch(app.url+'/api/action',{method:'POST',headers:{'Content-Type':'application/json',Origin:app.url},body:JSON.stringify(body)});return {status:response.status,value:await response.json()};}
for(const choice of ['once','always','full'])test(`live filesystem ${choice} permission resumes the pending task and settings can revoke it`,{timeout:30000},async()=>{
 const app=await fixture({startInSide:true,filesystemTask:true});let live;
 try{
 live=await events(app.url);const initial=await live.until(value=>value.connection==='connected'&&!value.switching),context=initial.context;
 assert.equal((await action(app,{op:'send',context,id:randomUUID(),text:'Read the live fixture note without changing the workspace.',files:[]})).status,200);
 const waiting=await live.until(value=>value.state?.approval?.permission);const review=waiting.state.approval;
 assert.match(review.result.title,/filesystem access/);assert.match(JSON.stringify(review.result.preview),/note.md/);
 assert.equal((await action(app,{op:'approve',context,id:'stale',approved:true,permission_choice:'full'})).status,409);
 assert.equal((await action(app,{op:'approve',context,id:review.id,approved:true,permission_choice:'invalid'})).status,400);
 assert.equal((await action(app,{op:'approve',context,id:review.id,approved:true,permission_choice:choice})).status,200);
 await live.until(value=>!value.state?.running&&!value.state?.needsApproval&&value.state?.messages?.some(message=>message.text?.includes('Fixture answer')));
 const request=app.payloads.findLast(payload=>payload.messages.some(message=>message.role==='tool'&&message.content.includes('Private fixture note content')));
 assert.ok(request,'original pending tool read did not resume');
 assert.equal((await action(app,{op:'navigate',context,route:'/permissions'})).status,200);
 const settings=await live.until(value=>value.state?.panel?.kind==='permissions');
 const text=JSON.stringify(settings.state.panel);
 assert.equal(text.includes('Full filesystem access enabled'),choice==='full');
 assert.equal(settings.state.panel.rows.some(row=>row.label.startsWith('Revoke ')&&!row.label.startsWith('Revoke all')),choice==='always');
 const index=settings.state.panel.rows.findIndex(row=>row.label==='Revoke all filesystem access');assert.ok(index>=0);
 assert.equal((await action(app,{op:'frame',context,frame:{type:'panel',panel:{id:settings.state.panel.id,action:'activate',row:index}}})).status,200);
 await live.until(value=>value.state?.panel?.notice?.includes('revoked'));
 }finally{live?.close();await app.close();}
});
