import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {localFilePreview} from '../local-file-preview.mjs';
test('file previews stay within the selected workspace and verify retained task outputs',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hcb-file-preview-'));
 try {
  const source=join(root,'source'),bundle=join(root,'bundle');await mkdir(source);await mkdir(join(bundle,'output'),{recursive:true});
  await writeFile(join(source,'PROJECT.md'),'workspace version');await writeFile(join(bundle,'output','PROJECT.md'),'retained version');
  const owner={state:{conversation_id:'chat',source,messages:[]}};
  const host={context:'conversation:chat',backend:owner,mutable(){},sessions:{workers:new Set([owner]),canOpen(){return false}}};
  const request={context:host.context,name:'PROJECT.md'};
  assert.equal((await localFilePreview(host,request)).text,'workspace version');
  for(const name of ['../secret.md','/etc/passwd','.env','folder/.secret.json'])await assert.rejects(localFilePreview(host,{...request,name}));
  await assert.rejects(localFilePreview(host,{...request,context:'conversation:other'}));
  if(process.platform!=='win32'){await symlink(join(bundle,'output','PROJECT.md'),join(source,'linked.md'));await assert.rejects(localFilePreview(host,{...request,name:'linked.md'}),/Linked/);}
  owner.state.messages=[{bundle:{Path:bundle,RunID:'run',Artifacts:[{Path:'PROJECT.md',Valid:true,SHA256:createHash('sha256').update('retained version').digest('hex')}]}}];
  assert.equal((await localFilePreview(host,request)).text,'workspace version');
  assert.equal((await localFilePreview(host,{...request,run:'run'})).text,'retained version');
  await writeFile(join(source,'project.test.md'),'dotted filename');
  assert.equal((await localFilePreview(host,{...request,name:'project.test.md'})).text,'dotted filename');
  const workspacePreview=await localFilePreview(host,{...request,name:'project.test.md',run:'run'});
  assert.equal(workspacePreview.text,'dotted filename');assert.equal(workspacePreview.note,'Current workspace file');
  await writeFile(join(bundle,'output','PROJECT.md'),'tampered');await assert.rejects(localFilePreview(host,{...request,run:'run'}),/changed/);
 }finally{await rm(root,{recursive:true,force:true})}
});


test('a main chat can preview its retired task output without granting unrelated task access',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hcb-retired-file-'));
 try{
  const state=join(root,'state'),bundle=join(state,'hot-cross-buns','workspaces','workspace','run-one'),directory=join(state,'hot-cross-buns','conversations','child');
  await mkdir(join(bundle,'output'),{recursive:true});await mkdir(join(directory,'revisions'),{recursive:true});
  const text='retained child output';await writeFile(join(bundle,'output','PROJECT.md'),text);
  await writeFile(join(bundle,'manifest.json'),JSON.stringify({run_id:'run-one',artifacts:[{path:'PROJECT.md',sha256:createHash('sha256').update(text).digest('hex')}]}));
  await writeFile(join(directory,'conversation.json'),JSON.stringify({id:'child',head_revision_id:'run-one'}));
  await writeFile(join(directory,'revisions','run-one.json'),JSON.stringify({id:'run-one',conversation_id:'child',bundle_path:bundle}));
  const owner={state:{conversation_id:'main',source:root,messages:[],dialogue:[{task_chat:'child'}]}};
  const host={context:'conversation:main',backendStateRoot:state,backend:owner,mutable(){},sessions:{workers:new Set([owner]),canOpen(){return false}}};
  assert.equal((await localFilePreview(host,{context:host.context,name:'PROJECT.md',run:'run-one'})).text,text);
  owner.state.dialogue=[];await assert.rejects(localFilePreview(host,{context:host.context,name:'PROJECT.md',run:'run-one'}),/not retained/);
 }finally{await rm(root,{recursive:true,force:true})}
});
