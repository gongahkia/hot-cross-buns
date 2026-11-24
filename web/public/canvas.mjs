import {element,prose,codeBlock} from './text.mjs';
import {icon} from './icons.mjs';

export function canvasWorkspace({request,storage}) {
 try{storage??=window.localStorage}catch{storage={getItem:()=>null,setItem:()=>{throw new Error('Storage unavailable')}}}
 const root=element('aside',undefined,'file-sidebar canvas-workspace');root.hidden=true;root.setAttribute('aria-label','Canvas');
 const header=element('div',undefined,'section-head'),title=element('h2','Canvas');
 const close=element('button',undefined,'quiet icon-button');close.type='button';close.setAttribute('aria-label','Close Canvas');close.append(icon('close'));header.append(title,close);
 const tools=element('div',undefined,'view-tools'),editor=element('textarea');editor.maxLength=131072;editor.setAttribute('aria-label','Canvas source');editor.spellcheck=false;
 const preview=element('div',undefined,'canvas-preview'),notice=element('p','','hint');notice.setAttribute('role','status');
 const changes=element('input');changes.placeholder='Describe a change…';changes.maxLength=4000;changes.setAttribute('aria-label','Ask agent to revise Canvas');
 const revisions=element('select');revisions.setAttribute('aria-label','Canvas versions');
 let doc,context,record,timer,generation=0;
 const button=(label,fn)=>{const b=element('button',label,'quiet');b.type='button';b.addEventListener('click',fn);return b};
 function key(){return 'hot-cross-buns.canvas.v1:'+context+':'+doc.id}
 function persist(){if(!doc)return;record.draft=editor.value;try{storage.setItem(key(),JSON.stringify(record))}catch{notice.textContent='Canvas changes could not be saved in this browser.'}}
 function render(){preview.replaceChildren(doc.language==='markdown'?prose(editor.value):['html','svg','mermaid'].includes(doc.language)?prose('```'+doc.language+'\n'+editor.value+'\n```'):codeBlock(editor.value,doc.language))}
 function version(){persist();record.versions.push({source:editor.value,at:new Date().toISOString()});record.versions=record.versions.slice(-20);persist();listVersions();notice.textContent='Version saved.'}
 function listVersions(){revisions.replaceChildren(...record.versions.map((value,index)=>{const option=element('option','Version '+(index+1)+' · '+new Date(value.at).toLocaleTimeString());option.value=String(index);return option}));revisions.value=String(record.versions.length-1);revisions.disabled=!record.versions.length}
 revisions.addEventListener('change',()=>{editor.value=record.versions[Number(revisions.value)].source;persist();render();notice.textContent='Selected version restored as the current draft.'});
 const useAgent=button('Use agent version',()=>{version();editor.value=doc.content;record.base=doc.content;persist();render();useAgent.hidden=true});useAgent.hidden=true;
 const showPreview=button('Preview',()=>{render();preview.hidden=false;editor.hidden=true});
 const showSource=button('Source',()=>{preview.hidden=true;editor.hidden=false;editor.focus()});
 const save=button('Save version',version);
 const download=button('Download',()=>{const url=URL.createObjectURL(new Blob([editor.value],{type:'text/plain;charset=utf-8'})),link=element('a');link.href=url;link.download=doc.id+'.'+({markdown:'md',text:'txt'}[doc.language]||doc.language);link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)});
 const ask=button('Ask agent',async()=>{
  if(!doc||!changes.value.trim())return;
  const owned=generation;ask.disabled=true;notice.textContent='Sending your Canvas request…';persist();
  try{await request({context,id:doc.id,title:doc.title,language:doc.language,source:editor.value,instruction:changes.value,requestId:crypto.randomUUID()});if(owned===generation){changes.value='';notice.textContent='Request sent. Your Canvas draft is kept.'}}
  catch(error){if(owned===generation)notice.textContent=error.message}
  finally{if(owned===generation)ask.disabled=false}
 });
 tools.append(showPreview,showSource,save,download,revisions,useAgent);root.append(header,tools,notice,editor,preview,changes,ask);
 editor.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(persist,150)});
 function hide(){clearTimeout(timer);persist();generation++;root.hidden=true;document.body.classList.remove('file-preview-open')}
 close.addEventListener('click',hide);root.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();hide()}});
 function open(value,owner){
  persist();clearTimeout(timer);generation++;context=owner;doc=value;title.textContent=value.title;
  try{record=JSON.parse(storage.getItem(key()))}catch{record=null}
  if(!record||typeof record.draft!=='string'||record.draft.length>131072||!Array.isArray(record.versions)){record={base:doc.content,draft:doc.content,versions:[]}}
  record.versions=record.versions.filter(v=>typeof v.source==='string'&&v.source.length<=131072).slice(-20);
  if(record.base!==doc.content&&record.draft===record.base){record.draft=doc.content;record.base=doc.content}
  useAgent.hidden=record.base===doc.content;notice.textContent=useAgent.hidden?'':"The agent supplied another revision. Your edits are kept until you choose Use agent version.";
  editor.value=record.draft;editor.hidden=true;preview.hidden=false;ask.disabled=false;listVersions();render();root.hidden=false;document.body.classList.add('file-preview-open');persist();
 }
 return{element:root,open,close:hide,reset(owner){if(context&&context!==owner){hide();doc=undefined;record=undefined;context=owner}}};
}
