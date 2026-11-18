import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { runCommand, openCommands, openScratchpad } from './commands';
import { syncState } from './sync-helpers';

function today() { return new Intl.DateTimeFormat('en-CA',{ timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date()); }
function source(scratch = 'Meeting fragments\n') {
  return `---\nhcb-format: 1\ndocument-id: runtime-journal\n---\n\n# Hot Cross Buns\n\n## Dated\n\n### ${today()}\n\nUnstructured **meeting context**.\n\n| Topic | Owner |\n| --- | --- |\n| Work | Me |\n\n- [ ] First task\n  ~~~~hcb\n  id: first-task\n  ~~~~\n\n  > Context attached to the task.\n\n  \`\`\`mermaid\n  graph TD; A-->B\n  \`\`\`\n\n  - [ ] Follow up\n\n## Undated\n\n### Inbox\n\n- Read later\n  \`\`\`hcb\n  id: read-later\n  \`\`\`\n\n## Scratchpad\n${scratch}`;
}
async function importSource(page: Page,text = source()) {
  await page.getByLabel('Import a Planner.md file').setInputFiles({ name:'Planner.md',mimeType:'text/markdown',buffer:Buffer.from(text) });
  await expect(page.getByRole('group',{ name:'First task',exact:true })).toBeVisible();
}
async function editSource(page: Page) {
  const palette = await openCommands(page);
  await palette.getByRole('combobox').fill('source');
  await palette.getByRole('option',{ name:'Edit Markdown source',exact:true }).click();
  return page.getByRole('dialog',{ name:'Edit Markdown source',exact:true });
}
async function exported(page: Page) {
  await runCommand(page,'Download Planner.md');
  const dialog = page.getByRole('dialog',{ name:'Download Planner.md',exact:true });
  const download = page.waitForEvent('download');
  await dialog.getByRole('button',{ name:'download',exact:true }).click();
  return readFile(await (await download).path(),'utf8');
}

test('existing views persist exact Markdown, rich bodies and the shared scratchpad across reload and export', async ({page}) => {
  await page.goto('/');
  await importSource(page);
  const field = page.getByRole('textbox',{ name:'Edit First task',exact:true });
  await field.fill('Edited task'); await field.press('Enter');
  await expect.poll(async()=> (await syncState(page,'current'))?.document.source.includes('Edited task')).toBe(true);
  await openScratchpad(page);
  const scratch = page.getByRole('textbox',{ name:'Scratchpad text',exact:true });
  await scratch.fill('Shared capture\n\n## Dated\n- [ ] Still capture\n');
  await expect.poll(async()=> (await syncState(page,'current'))?.document.source.endsWith('Shared capture\n\n## Dated\n- [ ] Still capture\n')).toBe(true);
  await page.reload();
  await expect(page.getByRole('group',{ name:'Edited task',exact:true })).toBeVisible();
  const output = await exported(page);
  expect(output).toContain('document-id: runtime-journal');
  expect(output).toContain('Unstructured **meeting context**.');
  expect(output).toContain('| Work | Me |');
  expect(output).toContain('~~~~hcb\n  id: first-task\n  ~~~~');
  expect(output).toContain('> Context attached to the task.');
  expect(output).toContain('graph TD; A-->B');
  expect(output).toContain('Shared capture\n\n## Dated\n- [ ] Still capture\n');
  expect(await page.evaluate(()=>new Promise(resolve=>{const request=indexedDB.open('hot-cross-buns-v1'); request.onsuccess=()=>{resolve(request.result.version);request.result.close();};}))).toBe(4);
});

test('source editing stays hidden from the empty palette, validates identity and recovers drafts across reload', async ({page}) => {
  await page.goto('/'); await importSource(page);
  const palette = await openCommands(page);
  await expect(palette.getByRole('option',{ name:'Edit Markdown source',exact:true })).toHaveCount(0);
  await palette.press('Escape');
  await expect(palette).toBeHidden();
  const dialog = await editSource(page);
  const field = dialog.getByRole('textbox',{ name:'Markdown source',exact:true });
  const draft = source().replace('Unstructured **meeting context**.','Extra prose with $x^2$ and [a link](#hcb-first-task).');
  await field.fill(draft.replace('document-id: runtime-journal','document-id: other'));
  await dialog.getByRole('button',{ name:'Save Markdown',exact:true }).click();
  await expect(dialog.getByRole('alert')).toContainText('document-id unchanged');
  await field.fill(draft);
  await dialog.getByRole('button',{ name:'Close',exact:true }).click();
  await page.reload();
  const reopened = await editSource(page);
  await expect(reopened.getByRole('textbox',{ name:'Markdown source',exact:true })).toHaveValue(draft);
  await reopened.getByRole('button',{ name:'Save Markdown',exact:true }).click();
  await expect(reopened).toBeHidden();
  await expect.poll(async()=> (await syncState(page,'current'))?.document.source).toBe(draft);
});

test('newer changes in another window leave an open source draft recoverable instead of overwriting it', async ({page,context}) => {
  await page.goto('/'); await importSource(page);
  const dialog = await editSource(page);
  await dialog.getByRole('textbox',{ name:'Markdown source',exact:true }).fill(source('Unsaved source capture\n'));
  const other = await context.newPage(); await other.goto('/');
  const field = other.getByRole('textbox',{ name:'Edit First task',exact:true });
  await field.fill('Other window edit'); await field.press('Enter');
  await expect.poll(async()=> (await syncState(other,'current'))?.document.source.includes('Other window edit')).toBe(true);
  await dialog.getByRole('button',{ name:'Save Markdown',exact:true }).click();
  await expect(dialog.getByRole('alert')).toContainText('journal changed');
  await expect(dialog.getByRole('textbox',{ name:'Markdown source',exact:true })).toHaveValue(source('Unsaved source capture\n'));
  const download = page.waitForEvent('download');
  await dialog.getByRole('button',{ name:'Download draft',exact:true }).click();
  expect(await readFile(await (await download).path(),'utf8')).toContain('Unsaved source capture');
  expect((await syncState(other,'current')).document.source).toContain('Other window edit');
});

async function oldWorkspace(page: Page, scratchOnly = false) {
  await page.addInitScript(({ scratchOnly })=> {
    if (sessionStorage.getItem('legacy-fixture-created')) return;
    sessionStorage.setItem('legacy-fixture-created','true');
    localStorage.setItem('hot-cross-buns-storage-renamed-v1','true');
    const open=indexedDB.open('hot-cross-buns-v1',3);
    open.onupgradeneeded=()=>{open.result.createObjectStore('state');open.result.createObjectStore('scratchpad');};
    open.onsuccess=()=>{
      const db=open.result,tx=db.transaction(['state','scratchpad'],'readwrite');
      if (!scratchOnly) tx.objectStore('state').put({document:{days:[],undated:[{name:'Inbox',items:[{id:'kept',text:'Keep my saved work',completed:false,details:[]}]}]},baseline:null,revision:7},'current');
      tx.objectStore('scratchpad').put({text:'Earlier private scratchpad',revision:3},'current');
      tx.objectStore('state').put({ id:'old-target', baselineText:'old TXT bytes', handle:{name:'TODO.txt',kind:'file'}, needsReview:true },'linked-file');
      tx.objectStore('state').put({linkId:'old-target',checkpoint:{id:'old-submission',text:'unconfirmed original payload'},revisions:{pending:{record:{protocol:1,text:'original revision'}}}},'file-sync-ledger');
      tx.oncomplete=()=>db.close();
    };
  },{scratchOnly});
}

test('the explicit workspace transition retains legacy data and pending targets, shares scratchpad only after conversion and fences older openers', async ({page}) => {
  await oldWorkspace(page); await page.goto('/');
  await expect(page.getByRole('main',{name:'Markdown workspace transition'})).toBeVisible();
  await expect(page.getByRole('button',{ name:'Open command palette',exact:true })).toHaveCount(0);
  const before = await syncState(page,'legacy-txt:current');
  expect(before.revision).toBe(7);
  await page.getByRole('button',{name:'Convert saved workspace',exact:true}).click();
  await page.getByRole('button',{name:'Undated',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Edit Keep my saved work',exact:true})).toBeVisible();
  const state = await syncState(page,'current');
  expect(state.document.source).toContain('Earlier private scratchpad');
  expect(await syncState(page,'linked-file')).toBeNull();
  expect((await syncState(page,'legacy-txt:linked-file')).handle.name).toBe('TODO.txt');
  expect((await syncState(page,'legacy-txt:file-sync-ledger')).checkpoint.text).toBe('unconfirmed original payload');
  expect(await syncState(page,'legacy-txt:current')).toEqual(before);
  expect(await page.evaluate(()=>new Promise(resolve=>{const request=indexedDB.open('hot-cross-buns-v1',3);request.onerror=()=>resolve(request.error?.name);request.onsuccess=()=>{request.result.close();resolve('unexpected success');};}))).toBe('VersionError');
});

test('a scratchpad-only workspace also requires an explicit transition and is retained by starting empty', async ({page}) => {
  await oldWorkspace(page,true); await page.goto('/');
  await expect(page.getByRole('main',{name:'Markdown workspace transition'})).toBeVisible();
  await page.getByRole('button',{name:'Start an empty Markdown workspace',exact:true}).click();
  await expect(page.getByRole('button',{name:'Open command palette',exact:true})).toBeVisible();
  expect((await syncState(page,'current')).document.source).not.toContain('Earlier private scratchpad');
  const oldScratch=await page.evaluate(()=>new Promise<any>(resolve=>{const open=indexedDB.open('hot-cross-buns-v1');open.onsuccess=()=>{const db=open.result,request=db.transaction('scratchpad').objectStore('scratchpad').get('legacy-txt:current');request.onsuccess=()=>{db.close();resolve(request.result);};};}));
  expect(oldScratch.text).toBe('Earlier private scratchpad');
});

test('corrupted canonical source offers raw read-only recovery instead of accepting a stale task cache', async ({page}) => {
  await page.goto('/'); await importSource(page);
  const corrupted = source().replace('hcb-format: 1','hcb-format: 999');
  await page.evaluate(text=>new Promise<void>((resolve,reject)=>{
    const open=indexedDB.open('hot-cross-buns-v1');
    open.onsuccess=()=>{const db=open.result,tx=db.transaction('state','readwrite'),store=tx.objectStore('state'),read=store.get('current');read.onsuccess=()=>store.put({...read.result,document:{...read.result.document,source:text}},'current');tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};};
  }),corrupted);
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('could not open saved data');
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download browser recovery',exact:true}).click();
  const backup=JSON.parse(await readFile(await(await download).path(),'utf8'));
  expect(backup.state.current.document.source).toBe(corrupted);
  expect((await syncState(page,'current')).document.source).toBe(corrupted);
  await expect(page.getByRole('button',{name:'Open command palette',exact:true})).toHaveCount(0);
});

test('a failed scratchpad save stays recoverable and retries against newer task edits without losing either change', async ({page,context}) => {
  await page.goto('/'); await importSource(page);
  await page.evaluate(()=>{
    Reflect.set(window,'failScratch',true);
    const put=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(value,key){
      if(Reflect.get(window,'failScratch')&&this.name==='state'&&key==='current'&&value?.document?.source?.includes('Unsaved shared capture')) throw new DOMException('Injected scratchpad quota failure','QuotaExceededError');
      return put.call(this,value,key);
    };
  });
  await openScratchpad(page);
  await page.getByRole('textbox',{name:'Scratchpad text',exact:true}).fill('Unsaved shared capture');
  const recovery=page.getByRole('dialog',{name:'Unsaved scratchpad',exact:true});
  await expect(recovery.getByRole('textbox',{name:'Unsaved scratchpad text',exact:true})).toHaveValue('Unsaved shared capture');
  const other=await context.newPage(); await other.goto('/');
  const title=other.getByRole('textbox',{name:'Edit First task',exact:true});
  await title.fill('Newer task edit'); await title.press('Enter');
  await expect.poll(async()=> (await syncState(other,'current')).document.source.includes('Newer task edit')).toBe(true);
  await page.evaluate(()=>Reflect.set(window,'failScratch',false));
  await recovery.getByRole('button',{name:'Retry saving',exact:true}).click();
  await expect(recovery).toBeHidden();
  await expect.poll(async()=> (await syncState(page,'current')).document.source.includes('Unsaved shared capture')).toBe(true);
  expect((await syncState(page,'current')).document.source).toContain('Newer task edit');
});

test('a failed workspace transition keeps the earlier records and succeeds after retry', async ({page}) => {
  await oldWorkspace(page);
  await page.addInitScript(()=>{
    Reflect.set(window,'failTransition',true);
    const put=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(value,key){
      if(Reflect.get(window,'failTransition')&&this.name==='state'&&key==='current'&&value?.document?.source) throw new DOMException('Injected transition quota failure','QuotaExceededError');
      return put.call(this,value,key);
    };
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Convert saved workspace',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('transition quota failure');
  expect(await syncState(page,'current')).toBeNull();
  expect((await syncState(page,'legacy-txt:current')).revision).toBe(7);
  await page.evaluate(()=>Reflect.set(window,'failTransition',false));
  await page.getByRole('button',{name:'Convert saved workspace',exact:true}).click();
  await expect(page.getByRole('button',{name:'Open command palette',exact:true})).toBeVisible();
  expect((await syncState(page,'current')).document.source).toContain('Earlier private scratchpad');
});

test('capture promotion has one canonical undo and redo, including keyboard use from the scratchpad', async ({page}) => {
  await page.goto('/'); await importSource(page,source('Capture title\nFollow up\n'));
  const before=(await syncState(page,'current')).document.source;
  await openScratchpad(page);
  const editor=page.getByRole('textbox',{name:'Scratchpad text',exact:true});
  await editor.evaluate(element=>{const field=element as HTMLTextAreaElement;field.focus();field.setSelectionRange(0,field.value.length);field.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true,key:'Shift'}));});
  await editor.press('Shift+F10');
  await page.getByRole('menuitem',{name:'Move to undated',exact:true}).click();
  const destination=page.getByRole('dialog',{name:'Move text to an undated list',exact:true});
  await destination.getByRole('button',{name:'Create item',exact:true}).click();
  await expect(destination).toBeHidden();
  await expect.poll(async()=> (await syncState(page,'current')).document.undated[0].items.some((item:{text:string})=>item.text==='Capture title')).toBe(true);
  const after=(await syncState(page,'current')).document.source;
  await editor.focus(); await editor.press('Control+z');
  await expect.poll(async()=> (await syncState(page,'current')).document.source).toBe(before);
  await expect(editor).toHaveValue('Capture title\nFollow up\n');
  await editor.focus(); await editor.press('Control+Shift+z');
  await expect.poll(async()=> (await syncState(page,'current')).document.source).toBe(after);
  await expect(editor).toHaveValue('');
});

test('an aborted schema upgrade can export the original database without retrying the failed upgrade', async ({page}) => {
  await oldWorkspace(page);
  await page.addInitScript(()=>{
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value,key){
      if (String(key).startsWith('legacy-txt:')) throw new DOMException('Injected schema upgrade quota failure','QuotaExceededError');
      return put.call(this,value,key);
    };
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('could not open saved data');
  const download = page.waitForEvent('download',{timeout:5000});
  await page.getByRole('button',{name:'Download browser recovery',exact:true}).click();
  const raw = JSON.parse(await readFile(await (await download).path(),'utf8'));
  expect(raw.state.current.revision).toBe(7);
  expect(raw.state.current.document.undated[0].items[0].text).toBe('Keep my saved work');
  expect(raw.scratchpad.current.text).toBe('Earlier private scratchpad');
  expect(raw.state['legacy-txt:current']).toBeUndefined();
  expect(await page.evaluate(()=>new Promise(resolve=>{
    const open=indexedDB.open('hot-cross-buns-v1');
    open.onsuccess=()=>{const version=open.result.version;open.result.close();resolve(version);};
  }))).toBe(3);
});
