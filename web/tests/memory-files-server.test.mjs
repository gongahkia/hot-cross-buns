import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fixture } from './fixture.mjs';

test('editing a category Markdown file updates the real memory and subsequent chat continuity', {timeout:30000},async()=>{
  const app=await fixture({memories:['I prefer concise replies.'],conversationalReplies:true}),abort=new AbortController();
  try {
    const stream=await fetch(app.url+'/api/events',{signal:abort.signal}),reader=stream.body.pipeThrough(new TextDecoderStream()).getReader();let buffer='';
    const until=async predicate=>{while(true){const end=buffer.indexOf('\n\n');if(end>=0){const value=JSON.parse(buffer.slice(6,end));buffer=buffer.slice(end+2);if(predicate(value))return value;}else{const value=await reader.read();if(value.done)throw Error('State stream closed');buffer+=value.value;}}};
    const {context}=await until(value=>value.connection==='connected');
    const action=async body=>{const response=await fetch(app.url+'/api/action',{method:'POST',headers:{Origin:app.url,'Content-Type':'application/json'},body:JSON.stringify({context,...body})});const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;};
    const first=await action({op:'memory',action:'list',category:'Preferences'});assert.equal(first.markdown_files.length,8);
    const file=first.markdown_files.find(file=>file.category==='Preferences').path;
    const original=await readFile(file,'utf8');await writeFile(file,original.replace('I prefer concise replies.','I prefer detailed replies.'),{mode:0o600});
    // No Memory refresh: the production routing boundary must import it before assembling continuity.
    await action({op:'send',id:randomUUID(),text:'How do I prefer your replies?',files:[]});
    await until(value=>value.state?.dialogue?.some(turn=>turn.response));
    const payload=app.payloads.findLast(value=>JSON.stringify(value).includes('continuity_context'));
    assert.ok(payload);assert.match(JSON.stringify(payload),/I prefer detailed replies/);assert.doesNotMatch(JSON.stringify(payload),/I prefer concise replies/);
    const updated=await action({op:'memory',action:'list',category:'Preferences'});assert.equal(updated.entries[0].id,first.entries[0].id);assert.equal(updated.entries[0].text,'I prefer detailed replies.');
    await action({op:'memory',action:'forget',id:updated.entries[0].id,revision:updated.entries[0].revision});
    assert.doesNotMatch(await readFile(file,'utf8'),/I prefer detailed replies/);
  }finally{abort.abort();await app.close();}
});
