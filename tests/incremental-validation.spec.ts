import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { runCommand } from './commands';
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const source=()=>`---\nhcb-format: 3\ndocument-id: incremental-browser\n---\n\n[ref]: https://example.com\n\n## Dated\n\n### ${today()}\n\nDaily **prose**.\n\n- [ ] Alpha\n  \`\`\`hcb\n  id: alpha\n  \`\`\`\n  - [ ] Child\n\n  > Attached [context][ref].\n\n## Undated\n\n### Inbox\n\n## Scratchpad\nCapture.\n`;
async function load(page:Page){
 await page.addInitScript(()=>{
  Reflect.set(window,'__hcbMarkdownMetrics',{enabled:true,samples:[]});
  const NativeWorker=window.Worker;
  class TrackedWorker extends NativeWorker {
   constructor(url:string|URL,options?:WorkerOptions){
    super(url,options);Reflect.set(window,'__hcbTestWorker',this);
    this.addEventListener('message',event=>{
     if(event.data.delta&&Reflect.get(window,'__hcbCorruptDelta')){
      Reflect.deleteProperty(window,'__hcbCorruptDelta');event.stopImmediatePropagation();
      this.dispatchEvent(new MessageEvent('message',{data:{...event.data,delta:{...event.data.delta,baselineId:-1}}}));
     }
    });
   }
  }
  Reflect.set(window,'Worker',TrackedWorker);
 });await page.goto('/');await page.getByLabel('Import a Planner.md file').setInputFiles({name:'Planner.md',mimeType:'text/markdown',buffer:Buffer.from(source())});const day=page.getByRole('region',{name:`Document for ${today()}`,exact:true});await expect(day.getByRole('checkbox',{name:'Complete Alpha',exact:true})).toBeVisible();return day;
}
async function reset(page:Page){await page.waitForFunction(()=>Reflect.get(window,'__hcbMarkdownMetrics').samples.some((sample:{phase:string})=>sample.phase==='durableSave'));await page.evaluate(()=>{Reflect.get(window,'__hcbMarkdownMetrics').samples=[];});}
async function hasPath(page:Page,path:string){await expect.poll(()=>page.evaluate(path=>Reflect.get(window,'__hcbMarkdownMetrics').samples.some((sample:{phase:string})=>sample.phase===path),path)).toBe(true);}
async function exported(page:Page){await runCommand(page,'Download Planner.md');const pending=page.waitForEvent('download');await page.getByRole('dialog',{name:'Download Planner.md',exact:true}).getByRole('button',{name:'download',exact:true}).click();return readFile((await(await pending).path())!,'utf8');}

test('real worker completes outlines incrementally while preserving exact Markdown and undo',async({page})=>{
 const day=await load(page);await reset(page);await day.getByRole('checkbox',{name:'Complete Alpha',exact:true}).click();await expect(day.getByRole('checkbox',{name:'Reopen Child',exact:true})).toBeChecked();await hasPath(page,'workerValidation:materialize:incremental');await hasPath(page,'workerTransport:materialize:delta');expect(await exported(page)).toBe(source().replaceAll('[ ]','[x]'));await page.keyboard.press('ControlOrMeta+z');await expect(day.getByRole('checkbox',{name:'Complete Alpha',exact:true})).not.toBeChecked();expect(await exported(page)).toBe(source());await page.keyboard.press('ControlOrMeta+Shift+z');await expect(day.getByRole('checkbox',{name:'Reopen Alpha',exact:true})).toBeChecked();expect(await exported(page)).toBe(source().replaceAll('[ ]','[x]'));
});
test('ordinary rich document edits still take the full validation path',async({page})=>{
 const day=await load(page);await day.getByRole('button',{name:`Edit block 1 in ${today()}`,exact:true}).click();await day.getByRole('textbox',{name:`Markdown for ${today()}`,exact:true}).fill('Other **prose**.');await reset(page);await day.getByRole('button',{name:'Save',exact:true}).click();await expect(day.getByRole('textbox')).toHaveCount(0);await hasPath(page,'workerValidation:writing:full');expect(await exported(page)).toBe(source().replace('Daily **prose**.','Other **prose**.'));
});


test('a restarted real worker sends a full model before compact editing resumes',async({page})=>{
 const day=await load(page);await reset(page);
 await page.evaluate(()=>Reflect.get(window,'__hcbTestWorker').dispatchEvent(new ErrorEvent('error',{message:'Test worker restart'})));
 await day.getByRole('checkbox',{name:'Complete Alpha',exact:true}).click();await expect(day.getByRole('checkbox',{name:'Reopen Child',exact:true})).toBeChecked();
 await hasPath(page,'workerTransport:materialize:full');await reset(page);
 await day.getByRole('checkbox',{name:'Reopen Alpha',exact:true}).click();await expect(day.getByRole('checkbox',{name:'Complete Child',exact:true})).not.toBeChecked();
 await hasPath(page,'workerTransport:materialize:delta');expect(await exported(page)).toBe(source());
});

test('a corrupted compact response recovers through a complete real-worker result',async({page})=>{
 const day=await load(page);await reset(page);await page.evaluate(()=>Reflect.set(window,'__hcbCorruptDelta',true));
 await day.getByRole('checkbox',{name:'Complete Alpha',exact:true}).click();await expect(day.getByRole('checkbox',{name:'Reopen Child',exact:true})).toBeChecked();
 await hasPath(page,'workerTransport:materialize:full');expect(await exported(page)).toBe(source().replaceAll('[ ]','[x]'));
 await reset(page);await day.getByRole('checkbox',{name:'Reopen Alpha',exact:true}).click();await hasPath(page,'workerTransport:materialize:delta');expect(await exported(page)).toBe(source());
});

test('compact completion and undo preserve later writing synchronized from another window',async({page,context})=>{
 const day=await load(page);await reset(page);await day.getByRole('checkbox',{name:'Complete Alpha',exact:true}).click();await hasPath(page,'workerTransport:materialize:delta');await reset(page);
 const other=await context.newPage();await other.goto('/');const second=other.getByRole('region',{name:`Document for ${today()}`,exact:true});
 await second.getByRole('button',{name:`Edit block 1 in ${today()}`,exact:true}).click();await second.getByRole('textbox',{name:`Markdown for ${today()}`,exact:true}).fill('Later **synced prose**.');await second.getByRole('button',{name:'Save',exact:true}).click();
 await expect(day.locator('strong').filter({hasText:'synced prose'})).toBeVisible();
 await day.getByRole('checkbox',{name:'Reopen Alpha',exact:true}).click();await expect(day.getByRole('checkbox',{name:'Complete Child',exact:true})).not.toBeChecked();
 expect(await exported(page)).toBe(source().replace('Daily **prose**.','Later **synced prose**.'));
 await page.keyboard.press('ControlOrMeta+z');await expect(day.getByRole('checkbox',{name:'Reopen Alpha',exact:true})).toBeChecked();
 expect(await exported(page)).toBe(source().replace('Daily **prose**.','Later **synced prose**.').replaceAll('[ ]','[x]'));await other.close();
});
