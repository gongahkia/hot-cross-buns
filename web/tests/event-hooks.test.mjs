import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHmac } from 'node:crypto';
import { eventHooks } from '../event-hooks.mjs';

test('event keys require exact review, authenticate raw inputs, rotate and stay out of public metadata', async () => {
  const root=await mkdtemp(join(tmpdir(),'hcb-event-'));
  const current={id:'job-event',kind:'event',digest:'a'.repeat(64),title:'Issue triage',enabled:true};
  const host={backendStateRoot:root,context:'conversation:fixture',backend:{state:{checks:[current]}},mutable(){}};
  const received=[], now=Date.now();
  const hooks=eventHooks(host,{now:()=>now,enqueue:async(_,value)=>{received.push(value);return {queued:true}}});
  try {
    await assert.rejects(hooks.manage({id:current.id,action:'enable'}),/review changed/);
    const review=await hooks.manage({id:current.id,action:'review'});
    const enabled=await hooks.manage({id:current.id,action:'enable',review:review.review});
    assert.match(enabled.key,/^[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(await hooks.manage({id:current.id,action:'status'})).includes(enabled.key));
    const raw=Buffer.from(JSON.stringify({type:'issue',data:{title:'A sample issue'}}));
    const timestamp=String(Math.floor(now/1000)),delivery='delivery-1';
    const signature=createHmac('sha256',enabled.key).update(timestamp+'.'+delivery+'.').update(raw).digest('hex');
    const headers={'x-hcb-timestamp':timestamp,'x-hcb-event-id':delivery,'x-hcb-signature':signature};
    await assert.rejects(hooks.deliver(current.id,{...headers,'x-hcb-signature':'f'.repeat(64)},raw),/authentication/);
    await assert.rejects(hooks.deliver(current.id,headers,Buffer.from('{}')),/authentication/);
    await hooks.deliver(current.id,headers,raw);
    assert.equal(received.length,1);assert.equal(received[0].policy,current.digest);
    assert.ok(!JSON.stringify(received).includes(enabled.key));
    const rotate=await hooks.manage({id:current.id,action:'review'});
    current.digest='b'.repeat(64);
    await assert.rejects(hooks.manage({id:current.id,action:'enable',review:rotate.review}),/review changed/);
    await hooks.manage({id:current.id,action:'disable'});
    await assert.rejects(hooks.deliver(current.id,headers,raw),/disabled/);
    const saved=JSON.parse(await readFile(join(root,'hot-cross-buns','event-hooks.json'),'utf8'));
    assert.deepEqual(saved.hooks,[]);
  } finally {await rm(root,{recursive:true,force:true})}
});
