import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const {window}=new JSDOM('');globalThis.document=window.document;globalThis.window=window;
const result=await build({stdin:{contents:'export {settingsView} from "./public/views.mjs";export {filesystemApprovalActions,schedulingApprovalActions,mcpApprovalActions} from "./public/reviews.mjs"',resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'js'},bundle:true,write:false,platform:'browser',format:'esm',plugins:[{name:'icons',setup(builder){builder.onResolve({filter:/^\/vendor\/render-deps\.mjs$/},()=>({path:fileURLToPath(new URL('../render-deps.mjs',import.meta.url))}));builder.onResolve({filter:/^\/vendor\/icons-entry\.mjs$/},()=>({path:fileURLToPath(new URL('../icons-entry.mjs',import.meta.url))}));}}]});
const {settingsView,filesystemApprovalActions,schedulingApprovalActions,mcpApprovalActions}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].contents).toString('base64'));
test('Permissions opens management and renders explicit decision choices',()=>{
 const destinations=[];const view=settingsView({navigate:route=>destinations.push(route),backend:route=>destinations.push(route)});
 [...view.querySelectorAll('button')].find(button=>button.textContent.startsWith('Permissions')).click();assert.deepEqual(destinations,['/permissions']);
 const decisions=[];const actions=filesystemApprovalActions((approved,choice)=>decisions.push({approved,choice}));
 assert.deepEqual([...actions.querySelectorAll('button')].map(button=>button.textContent),['Decline','Allow once','Always for this folder','Full filesystem access']);
 assert.equal(actions.querySelectorAll('.approval-primary').length,1);assert.equal(actions.querySelector('.approval-primary').textContent,'Allow once');
 for(const button of actions.querySelectorAll('button'))button.click();
 assert.deepEqual(decisions,[{approved:false,choice:undefined},{approved:true,choice:'once'},{approved:true,choice:'always'},{approved:true,choice:'full'}]);
});

test('scheduling approvals offer one change or persistent scheduling without unrelated access',()=>{
 const decisions=[],actions=schedulingApprovalActions((approved,choice)=>decisions.push({approved,choice}));
 assert.deepEqual([...actions.querySelectorAll('button')].map(button=>button.textContent),['Decline','Allow once','Always allow scheduling']);
 assert.equal(actions.querySelectorAll('.approval-primary').length,1);assert.equal(actions.querySelector('.approval-primary').textContent,'Allow once');
 for(const button of actions.querySelectorAll('button'))button.click();assert.deepEqual(decisions,[{approved:false,choice:undefined},{approved:true,choice:'once'},{approved:true,choice:'always'}]);
});

test('MCP approvals have one primary and preserve exact choice values',()=>{
 const decisions=[],actions=mcpApprovalActions((approved,choice)=>decisions.push({approved,choice}));
 assert.deepEqual([...actions.querySelectorAll('button')].map(b=>b.textContent),['Decline','Allow once','Always allow this MCP']);
 assert.equal(actions.querySelectorAll('.approval-primary').length,1);
 assert.equal(actions.querySelector('.approval-primary').textContent,'Allow once');
 for(const b of actions.querySelectorAll('button'))b.click();
 assert.deepEqual(decisions,[{approved:false,choice:undefined},{approved:true,choice:'once'},{approved:true,choice:'always'}]);
});
