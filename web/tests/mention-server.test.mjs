import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './fixture.mjs';
test('file mention selection uses the existing attachment pipeline and rejects stale contexts', {timeout:30000},async()=>{
 const app=await fixture(),abort=new AbortController();try{
  const stream=await fetch(app.url+'/api/events',{signal:abort.signal}),reader=stream.body.pipeThrough(new TextDecoderStream()).getReader();let text='';while(!text.includes('\n\n'))text+=(await reader.read()).value;const snapshot=JSON.parse(text.slice(6,text.indexOf('\n\n'))),context=snapshot.context;
  const post=async body=>{const response=await fetch(app.url+'/api/action',{method:'POST',headers:{Origin:app.url,'Content-Type':'application/json'},body:JSON.stringify({context,...body})});return {status:response.status,value:await response.json()};};
  await post({op:'save',text:'Review @no'});const result=await post({op:'mention-search',query:'note'});assert.equal(result.status,200);assert.equal(result.value.files[0].path,'note.md');assert.equal(app.payloads.length,0);
  for(const name of ['pdf','html','log','js','file']){const response=await fetch(app.url+'/file-icons/'+name+'.png');assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.equal(Buffer.from(await response.arrayBuffer()).subarray(1,4).toString(),'PNG');}
  const file=result.value.files[0];assert.notEqual((await post({op:'mention-attach',id:'../note.md'})).status,200);
  const selected=await post({op:'mention-attach',id:file.id});assert.equal(selected.status,200,JSON.stringify(selected));assert.equal(selected.value.text,'Review @no');assert.equal(selected.value.uploads.length,1);assert.equal(selected.value.mentionPath,'note.md');
  await writeFile(join(snapshot.state.source,'note.md'),'changed after attachment');const download=await fetch(app.url+'/api/action',{method:'POST',headers:{Origin:app.url,'Content-Type':'application/json'},body:JSON.stringify({context,op:'download',ref:{kind:'upload',id:selected.value.uploads[0].id}})});assert.match(await download.text(),/Private fixture note/);
  assert.equal((await post({op:'mention-search',context:'conversation:stale',query:''})).status,409);assert.equal(app.payloads.length,0);
 }finally{abort.abort();await app.close();}
});

test('working folders stay in the chat and recent files survive a restart', {timeout:30000},async()=>{
 const app=await fixture(),abort=new AbortController();try{
  const snapshot=async()=>{const r=await fetch(app.url+'/api/events',{signal:abort.signal});const reader=r.body.pipeThrough(new TextDecoderStream()).getReader();let t='';while(!t.includes('\n\n'))t+=(await reader.read()).value;await reader.cancel();return JSON.parse(t.slice(6,t.indexOf('\n\n')))};
  const before=await snapshot(),context=before.context;
  const post=async body=>{const r=await fetch(app.url+'/api/action',{method:'POST',headers:{Origin:app.url,'Content-Type':'application/json'},body:JSON.stringify({context,...body})});const value=await r.json();assert.equal(r.status,200,JSON.stringify(value));return value};
  const {mkdir}=await import('node:fs/promises');const project=join(before.state.source,'project');await mkdir(project);await writeFile(join(project,'recent.md'),'Recent file');
  const focused=await post({op:'file-navigation',action:'focus',path:project});assert.equal(focused.working,project);assert.equal((await snapshot()).context,context);
  const scoped=await post({op:'mention-search',query:''});assert.equal(scoped.root,project);assert.ok(scoped.files.every(file=>file.path==='recent.md'));assert.equal((await post({op:'mention-search',query:'note'})).files.length,0);
  const files=await post({op:'mention-search',query:'recent'});await post({op:'mention-attach',id:files.files[0].id});
  await app.restart();const after=await snapshot();assert.equal(after.context,context);const restored=await post({op:'file-navigation',action:'status'});assert.equal(restored.working,project);assert.equal(restored.recent_files[0].path,join(project,'recent.md'));assert.equal(restored.root,before.state.source);assert.equal(app.payloads.length,0);
 }finally{abort.abort();await app.close();}
});
