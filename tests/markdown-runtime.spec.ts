import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { runCommand, openCommands } from './commands';
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
  await page.getByRole('button',{ name:'Scratchpad',exact:true }).click();
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
  await expect(dialog.getByRole('textbox',{ name:'Markdown source',exact:true })).toContainText('');
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
