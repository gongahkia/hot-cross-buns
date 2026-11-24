import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture } from './fixture.mjs';

test('browser session controls open from the web without granting access or making model requests', {timeout:30000}, async()=>{
 const app=await fixture(),abort=new AbortController();
 try {
  const res=await fetch(app.url+'/api/events',{signal:abort.signal}),reader=res.body.pipeThrough(new TextDecoderStream()).getReader();let buffer='';
  while(!buffer.includes('\n\n'))buffer+=(await reader.read()).value;
  const snapshot=JSON.parse(buffer.slice(6,buffer.indexOf('\n\n'))),context=snapshot.context;
  const action=async body=>{const res=await fetch(app.url+'/api/action',{method:'POST',headers:{Origin:app.url,'Content-Type':'application/json'},body:JSON.stringify({context,...body})});return {status:res.status,value:await res.json()};};
  const opened=await action({op:'navigate',route:'/browser'});assert.equal(opened.status,200);assert.equal(app.payloads.length,0);
  let latest=snapshot;
  const until=Date.now()+5000;
  while(latest.state?.panel?.kind!=='browser'&&Date.now()<until){const next=await reader.read();buffer+=next.value;const frames=buffer.split('\n\n');buffer=frames.pop();for(const frame of frames)if(frame.startsWith('data: '))latest=JSON.parse(frame.slice(6));}
  assert.equal(latest.state.panel.kind,'browser');assert.match(JSON.stringify(latest.state.panel),/Browser|browser/);
  assert.equal(latest.state.running,false);assert.equal(app.payloads.length,0);
 } finally {abort.abort();await app.close();}
});
