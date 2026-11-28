import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mentionQuery } from '../public/file-mentions.mjs';
import { workspaceMentions } from '../workspace-mentions.mjs';

test('mention trigger follows the caret without matching emails or quoted paths',()=>{
 for(const text of ['@','Read @src/cl','hello\n@note.md'])assert.ok(mentionQuery(text,text.length));
 for(const text of ['user@example.com','@file name','@"file name.md"','https://example.com/@x'])assert.equal(mentionQuery(text,text.length),null);
 assert.deepEqual(mentionQuery('Read @no suffix',8),{from:5,to:8,query:'no'});
});
test('workspace search returns bounded safe file selections and imports current bytes only',async()=>{
 const source=await mkdtemp(join(tmpdir(),'hcb-mentions-')),outside=await mkdtemp(join(tmpdir(),'hcb-outside-'));
 try{
  await mkdir(join(source,'src'));await mkdir(join(source,'node_modules'));await writeFile(join(source,'src','app.js'),'first');await writeFile(join(source,'.env'),'secret');await writeFile(join(source,'node_modules','generated.js'),'generated');await writeFile(join(outside,'private.txt'),'outside');await symlink(join(outside,'private.txt'),join(source,'linked.txt'));await symlink(outside,join(source,'linked-dir'));
  const host={context:'conversation:one',backend:{state:{source}},sessions:{switching:false},mutable(){}};const api=workspaceMentions(host);
  const result=await api.search(host.context,'');assert.deepEqual(result.files.map(f=>f.path),['src/app.js']);assert.ok(result.files.every(file=>!file.path.startsWith('/')));
  await assert.rejects(api.read(host.context,'../private.txt'));
  await writeFile(join(source,'src','app.js'),'latest');const selected=await api.read(host.context,result.files[0].id);assert.equal(selected.bytes.toString(),'latest');
  await rm(join(source,'src','app.js'));await symlink(join(outside,'private.txt'),join(source,'src','app.js'));await assert.rejects(api.read(host.context,result.files[0].id));
  host.backend={state:{source}};await assert.rejects(api.read(host.context,result.files[0].id));
  const many=Array.from({length:35},(_,i)=>writeFile(join(source,`file${i}.txt`),'text'));await Promise.all(many);const fresh=workspaceMentions(host);const limited=await fresh.search(host.context,'file');assert.equal(limited.files.length,30);assert.equal(limited.truncated,true);
 }finally{await rm(source,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});

 test('file types select matching local PNG icons with a bounded fallback',async()=>{
 const {fileTypeIcon,fileIconNames}=await import('../public/file-types.mjs');
 for(const [file,icon] of [['report.pdf','pdf'],['analysis.log','log'],['page.html','html'],['client.mjs','js'],['photo.png','image'],['component.tsx','reactts'],['file.unknown','file'],['constructor','file'],['../../private','file']])assert.equal(fileTypeIcon(file),'/file-icons/'+icon+'.png');
 const {readFile}=await import('node:fs/promises');for(const name of fileIconNames){const bytes=await readFile(new URL('../public/file-icons/'+name+'.png',import.meta.url));assert.equal(bytes.subarray(1,4).toString(),'PNG');}
 });

test('working folder confines matches, recency and cached selection tokens',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hcb-scoped-'));try{
  const project=join(root,'sagasu'),other=join(root,'Downloads');await mkdir(project);await mkdir(other);await writeFile(join(project,'code.py'),'local');await writeFile(join(other,'outside.txt'),'outside');
  let working=root;const host={context:'conversation:scope',backend:{state:{source:root},async workspace(){return {navigation:{root,working,recent_folders:[{path:other}],recent_files:[{path:join(other,'outside.txt')}]}}}},sessions:{switching:false},mutable(){}};const api=workspaceMentions(host);
  const all=await api.search(host.context,'outside');assert.equal(all.files.length,1);const old=all.files[0].id;working=project;
  const scoped=await api.search(host.context,'');assert.equal(scoped.root,project);assert.deepEqual(scoped.files.map(f=>f.path),['code.py']);await assert.rejects(api.read(host.context,old));assert.equal((await api.search(host.context,'outside')).files.length,0);
 }finally{await rm(root,{recursive:true,force:true})}
});
