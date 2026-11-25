import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname,join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fixture } from './fixture.mjs';

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
