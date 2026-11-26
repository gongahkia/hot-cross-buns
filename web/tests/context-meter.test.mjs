import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {fileURLToPath} from 'node:url';
const boot=new JSDOM("",{url:"http://127.0.0.1/"});
for(const key of ["window","document","Node","HTMLElement","Element","DOMParser","navigator"])Object.defineProperty(globalThis,key,{value:key==="window"?boot.window:boot.window[key],configurable:true,writable:true});
const {outputFiles}=await build({entryPoints:[fileURLToPath(new URL('../public/context-meter.mjs',import.meta.url))],bundle:true,format:'esm',write:false,platform:'browser',external:['/vendor/mermaid-entry.mjs'],plugins:[{name:'local-browser-dependencies',setup(builder){for(const name of ['render-deps','icons-entry'])builder.onResolve({filter:new RegExp('^/vendor/'+name+'\\.mjs$')},()=>({path:fileURLToPath(new URL('../'+name+'.mjs',import.meta.url))}));}}]});
const {contextMeter}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].contents).toString('base64'));
const policy=(model='small',window=8192)=>({provider:'fixture',model,window,output_reserve:1024,source:'configured model context window'});
function fixture(){const dom=new JSDOM('<button id="model-picker">Model</button><button id="meter" hidden></button>',{pretendToBeVisual:true});globalThis.window=dom.window;globalThis.document=dom.window.document;dom.window.HTMLElement.prototype.showPopover=function(){this.dataset.open='true';};dom.window.HTMLElement.prototype.hidePopover=function(){delete this.dataset.open;};const trigger=document.getElementById('meter'),meter=contextMeter(trigger);return{dom,trigger,meter,close:()=>dom.window.close()};}
function snapshot({model='small',window=8192,last,active=false,tasks=[]}={}){return{context:'home',state:{provider:'fixture',model,working:active,composer:{context:{policy:policy(model,window),last}}},tasks};}
const usage=(model='small',input=5500)=>({policy:policy(model),input_tokens:input,input_limit:6656,output_reserve:1024,summarized:true,at:'2026-11-26T10:00:00Z'});
test('context ring is contextual and model switches clear obsolete percentages',()=>{const f=fixture();try{
 const idle=snapshot();idle.state.dialogueActive=true;f.meter.update(idle);assert.equal(f.trigger.hidden,true);
 f.meter.update(snapshot({active:true}));assert.equal(f.trigger.hidden,false);assert.match(f.trigger.getAttribute('aria-label'),/estimate available/);f.trigger.click();assert.match(f.meter.element.textContent,/8,192 tokens/);
 f.meter.update(snapshot({last:usage()}));assert.match(f.trigger.getAttribute('aria-label'),/83%/);assert.match(f.meter.element.textContent,/Earlier context was summarized/);
 f.meter.update(snapshot({model:'large',window:65536,active:true,last:usage()}));assert.doesNotMatch(f.trigger.getAttribute('aria-label'),/83%/);assert.match(f.meter.element.textContent,/65,536 tokens/);assert.doesNotMatch(f.meter.element.textContent,/5,500/);
 document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(f.trigger.getAttribute('aria-expanded'),'false');
 f.meter.update(snapshot({last:usage('small',100)}));assert.equal(f.trigger.hidden,true);
}finally{f.close();}});
test('active task usage is selected by model identity without adding agent windows',()=>{const f=fixture();try{
 f.meter.update(snapshot({tasks:[{active:true,context:{policy:policy('other',65536),last:usage('other')}}]}));assert.match(f.trigger.getAttribute('aria-label'),/estimate available/);
 f.meter.update(snapshot({tasks:[{active:true,context:{policy:policy(),last:usage()}}]}));f.trigger.click();assert.match(f.meter.element.textContent,/Active task/);assert.match(f.meter.element.textContent,/5,500 tokens/);
 f.meter.update({...snapshot(),context:'different-home'});assert.equal(f.trigger.hidden,true);assert.equal(f.trigger.getAttribute('aria-expanded'),'false');
}finally{f.close();}});
