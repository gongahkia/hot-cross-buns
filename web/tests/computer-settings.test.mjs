import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const {window}=new JSDOM('');globalThis.document=window.document;globalThis.window=window;
const result=await build({stdin:{contents:'export {settingsView} from "./public/views.mjs"',resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'js'},bundle:true,write:false,platform:'browser',format:'esm',plugins:[{name:'icons',setup(builder){builder.onResolve({filter:/^\/vendor\/render-deps\.mjs$/},()=>({path:fileURLToPath(new URL('../render-deps.mjs',import.meta.url))}));builder.onResolve({filter:/^\/vendor\/icons-entry\.mjs$/},()=>({path:fileURLToPath(new URL('../icons-entry.mjs',import.meta.url))}));}}]});
const {settingsView}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].contents).toString('base64'));
test('Computer access opens the authoritative computer controls from device settings',()=>{
 const destinations=[];const view=settingsView({navigate:route=>destinations.push(route),backend:route=>destinations.push(route)});
 const button=[...view.querySelectorAll('button')].find(button=>button.textContent.startsWith('Computer access'));
 assert.ok(button);button.click();assert.deepEqual(destinations,['/computer']);
 assert.match(button.textContent,/one task/);
});
