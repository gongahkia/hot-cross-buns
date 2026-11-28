import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fixture } from './fixture.mjs';
const require = createRequire(new URL('../../app-host/package.json', import.meta.url));
const { PDFDocument } = require('pdf-lib');

test('attachment preparation replaces only the selected draft upload and keeps originals and model calls untouched', { timeout: 30000 }, async () => {
  const app = await fixture(), abort = new AbortController();
  try {
    const stream = await fetch(app.url + '/api/events', { signal: abort.signal }), reader = stream.body.pipeThrough(new TextDecoderStream()).getReader();
    let text='';while(!text.includes('\n\n'))text+=(await reader.read()).value;
    const context=JSON.parse(text.slice(6,text.indexOf('\n\n'))).context;
    const post=async body=>{const response=await fetch(app.url+'/api/action',{method:'POST',headers:{Origin:app.url,'Content-Type':'application/json'},body:JSON.stringify({context,...body})});return {status:response.status,value:await response.json()};};
    const pdf=await PDFDocument.create();for(let i=0;i<3;i++)pdf.addPage([200,300]);const original=Buffer.from(await pdf.save());
    const upload=await fetch(app.url+'/api/attachment?'+new URLSearchParams({context,name:'review.pdf'}),{method:'POST',headers:{Origin:app.url,'Content-Type':'application/octet-stream'},body:original});assert.equal(upload.status,200);
    const initial=await upload.json(),id=initial.uploads[0].id;
    await post({op:'save',text:'Keep my unsent prompt.'});
    const result=await post({op:'edit-attachment',id,edit:{pages:'2-3'}});
    assert.equal(result.status,200,JSON.stringify(result.value));assert.equal(result.value.text,'Keep my unsent prompt.');assert.equal(result.value.uploads.length,1);assert.notEqual(result.value.uploads[0].id,id);
    const read=async id=>{const response=await fetch(app.url+'/api/action',{method:'POST',headers:{Origin:app.url,'Content-Type':'application/json'},body:JSON.stringify({context,op:'download',ref:{kind:'upload',id}})});assert.equal(response.status,200);return Buffer.from(await response.arrayBuffer());};
    assert.equal((await PDFDocument.load(await read(result.value.uploads[0].id))).getPageCount(),2);
    const blocked=await post({op:'edit-attachment',id:result.value.uploads[0].id,edit:{annotations:[{type:'pen'}]}});assert.equal(blocked.status,400);
    const notes=await post({op:'edit-attachment',id:result.value.uploads[0].id,edit:{notes:'Removed annotation notes'}});assert.equal(notes.status,400);
    assert.deepEqual(await read(id),original);
    assert.equal((await post({op:'edit-attachment',id,edit:{pages:'1'}})).status,409);
    assert.equal((await post({op:'edit-attachment',id:result.value.uploads[0].id,edit:{pages:'99'}})).status,400);
    assert.equal(app.payloads.length,0);
  } finally {abort.abort();await app.close();}
});
