import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fixture } from './fixture.mjs';

test('review queue uses the managed owner, rejects stale decisions and preserves the draft', {timeout:30000}, async()=>{
  const app=await fixture(), abort=new AbortController();
  try {
    const directory=join(dirname(dirname(dirname(app.draftFile))),'state','hot-cross-buns','suggestions');
    await mkdir(directory,{recursive:true,mode:0o700});
    const id='suggestion-0123456789abcdef01234567';
    const record={version:1,id,kind:'note',status:'pending',title:'Keep the summary',body:'Reviewed content',work_id:'work-fixture',created_at:new Date().toISOString()};
    await writeFile(join(directory,id+'.json'),JSON.stringify(record),{mode:0o600});
    const response=await fetch(app.url+'/api/events',{signal:abort.signal}), reader=response.body.pipeThrough(new TextDecoderStream()).getReader();let buffer='';
    while(!buffer.includes('\n\n'))buffer+=(await reader.read()).value;
    const context=JSON.parse(buffer.slice(6,buffer.indexOf('\n\n'))).context;
    const action=async body=>{const response=await fetch(app.url+'/api/action',{method:'POST',headers:{Origin:app.url,'Content-Type':'application/json'},body:JSON.stringify({context,...body})});return {status:response.status,value:await response.json()};};
    await action({op:'save',text:'Keep this draft'});
    const list=await action({op:'review-queue',action:'list'});assert.equal(list.status,200);assert.equal(list.value.entries.length,1);
    const inspect=await action({op:'review-queue',action:'inspect',id});assert.equal(inspect.status,200);assert.equal(inspect.value.review.body,'Reviewed content');
    assert.equal((await action({op:'review-queue',action:'accept',id})).status,400);
    assert.equal((await action({op:'review-queue',action:'accept',id,revision:'0'.repeat(64)})).status,409);
    assert.equal((await action({op:'review-queue',action:'reject',id,revision:inspect.value.review.revision,context:'conversation:stale'})).status,409);
    const accepted=await action({op:'review-queue',action:'accept',id,revision:inspect.value.review.revision});assert.equal(accepted.status,200);assert.deepEqual(accepted.value.entries,[]);
    assert.equal((await action({op:'review-queue',action:'accept',id,revision:inspect.value.review.revision})).status,409);
    assert.equal((await action({op:'draft'})).value.text,'Keep this draft');assert.equal(app.payloads.length,0);
    assert.equal((await fetch(app.url+'/review-queue.mjs')).status,200);
  } finally {abort.abort();await app.close();}
});
