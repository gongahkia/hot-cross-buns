import assert from 'node:assert/strict';
import test from 'node:test';
import {fixture} from './fixture.mjs';

test('model inventory is a separate read-only operation and preserves the conversation draft',{timeout:30000},async()=>{
  const app=await fixture();const abort=new AbortController();
  try {
    const response=await fetch(app.url+'/api/events',{signal:abort.signal}),reader=response.body.pipeThrough(new TextDecoderStream()).getReader();let buffer='';
    while(!buffer.includes('\n\n')){const part=await reader.read();if(part.done)throw Error('Missing state');buffer+=part.value;}
    const state=JSON.parse(buffer.slice(6,buffer.indexOf('\n\n'))),context=state.context;
    const action=async body=>{const result=await fetch(app.url+'/api/action',{method:'POST',headers:{Origin:app.url,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:result.status,value:await result.json()}};
    await action({op:'save',context,text:'Keep my model research note'});
    const inventory=await action({op:'providers',action:'inventory',context});assert.equal(inventory.status,200);assert.equal(inventory.value.inventory.agents.length,7);assert.equal(app.payloads.length,0);
    assert.equal((await action({op:'draft',context})).value.text,'Keep my model research note');
    assert.equal((await action({op:'providers',action:'inventory',context:'conversation:another'})).status,409);
    assert.equal((await fetch(app.url+'/models-view.mjs')).status,200);
  }finally{abort.abort();await app.close()}
});
