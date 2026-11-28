import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import { editAttachment, selectedPages } from '../src/attachment-edit.mjs';

test('image edits crop the selected pixels into a new PNG and preserve original bytes', async () => {
  const canvas = createCanvas(100, 80), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 100, 80);ctx.fillStyle = '#f00';ctx.fillRect(50,0,50,80);
  const original = canvas.toBuffer('image/png'), before = Buffer.from(original);
  const result = await editAttachment('photo.png',original,{crop:{x:.5,y:0,width:.5,height:1},annotations:[]});
  const image = await loadImage(result.bytes);assert.equal(image.width,50);assert.equal(image.height,80);
  const output=createCanvas(50,80);output.getContext('2d').drawImage(image,0,0);
  assert.deepEqual([...output.getContext('2d').getImageData(0,0,1,1).data],[255,0,0,255]);assert.deepEqual(original,before);
});
test('PDF page selection removes excluded pages and preserves original bytes',async()=>{
 const pdf=await PDFDocument.create();for(let i=0;i<3;i++)pdf.addPage([200+i,300]);const original=Buffer.from(await pdf.save()),before=Buffer.from(original);
 const result=await editAttachment('notes.pdf',original,{pages:'1,3'});const output=await PDFDocument.load(result.bytes);assert.equal(output.getPageCount(),2);assert.equal(output.getPage(1).getWidth(),202);assert.deepEqual(original,before);
});
test('page ranges, crop bounds and annotation limits fail at the edit boundary',async()=>{
  assert.deepEqual(selectedPages('1-3, 5, 3',5),[0,1,2,4]);
  for(const value of ['0','3-2','1,99','1;2'])assert.throws(()=>selectedPages(value,5));
  await assert.rejects(editAttachment('image.png',Buffer.from('not decoded'),{crop:{x:.8,y:0,width:.5,height:1}}),/crop/);
  await assert.rejects(editAttachment('notes.txt',Buffer.from('original'),{annotations:[{type:'pen',page:1,color:'invalid',points:[[0,0]]}]}),/annotation/);
  await assert.rejects(editAttachment('notes.txt',Buffer.from('original'),{notes:'Read this section'}),/annotations/);
  assert.equal(await editAttachment('notes.txt',Buffer.from('original'),{}),null);
  for(const name of ['image.png','notes.pdf'])await assert.rejects(editAttachment(name,Buffer.from('not decoded'),{annotations:[{type:'pen'}]}),/annotations/);
});
