import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { runCommand } from './commands';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const source = () => `---\nhcb-format: 3\ndocument-id: unified-browser\n---\n\n[shared]: https://example.com\n\n## Dated\n\n### ${today()}\n\nDaily **writing** with [context][shared].\n\n- Plain outline\n  \`\`\`hcb\n  id: plain-outline\n  \`\`\`\n  - [ ] Nested action\n\n  > Attached **context** stays visible.\n\n## Undated\n\n### Inbox\n\nPersistent **writing**.\n\n- [ ] Undated action\n  \`\`\`hcb\n  id: undated-action\n  \`\`\`\n  - Plain context\n    - [ ] Undated child\n\n## Scratchpad\nShared capture.\n`;
async function load(page: Page) {
  await page.goto('/');
  await page.getByLabel('Import a Planner.md file').setInputFiles({ name: 'Planner.md', mimeType: 'text/markdown', buffer: Buffer.from(source()) });
  const day = page.getByRole('region', { name: `Document for ${today()}`, exact: true });
  await expect(day.locator('strong').filter({ hasText: 'writing' })).toBeVisible();
  return day;
}
async function download(page: Page) {
  await runCommand(page, 'Download Planner.md');
  const pending = page.waitForEvent('download');
  await page.getByRole('dialog', { name: 'Download Planner.md', exact: true }).getByRole('button', { name: 'download', exact: true }).click();
  return readFile((await (await pending).path())!, 'utf8');
}

test('dates and undated documents render writing directly and preserve attached content without Notes containers', async ({ page }) => {
  const day = await load(page);
  await expect(day.locator('strong').filter({ hasText: 'writing' })).toBeVisible();
  await expect(day.getByRole('link', { name: 'context', exact: true })).toHaveAttribute('href', 'https://example.com');
  await expect(day.locator('blockquote')).toContainText('Attached context stays visible.');
  await expect(day.getByText('id: plain-outline', { exact: true })).toHaveCount(0);
  await expect(day.getByText('Notes', { exact: true })).toHaveCount(0);
  await day.getByRole('group', { name: `Writing block 1 in ${today()}`, exact: true }).press('Enter');
  await day.getByRole('textbox', { name: `Markdown for ${today()}`, exact: true }).fill('Daily **updated writing** with [context][shared].');
  await day.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(day.locator('strong').filter({ hasText: 'updated writing' })).toBeVisible();
  await page.getByRole('button', { name: 'Undated', exact: true }).click();
  const inbox = page.getByRole('region', { name: 'Document for Inbox', exact: true });
  await expect(inbox.locator('strong')).toHaveText('writing');
  await inbox.getByRole('group', { name: 'Writing block 1 in Inbox', exact: true }).press('Enter');
  await inbox.getByRole('textbox', { name: 'Markdown for Inbox', exact: true }).fill('Persistent **updated writing**.');
  await inbox.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(inbox.locator('strong')).toHaveText('updated writing');
  expect(await download(page)).toBe(source().replace('Daily **writing**', 'Daily **updated writing**').replace('Persistent **writing**', 'Persistent **updated writing**'));
});

test('task completion works inside plain dated outlines and undated task outlines', async ({ page }) => {
  const day = await load(page);
  await day.getByRole('checkbox', { name: 'Complete Nested action', exact: true }).click();
  await expect(day.getByRole('checkbox', { name: 'Reopen Nested action', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Undated', exact: true }).click();
  const inbox = page.getByRole('region', { name: 'Document for Inbox', exact: true });
  await inbox.getByRole('checkbox', { name: 'Complete Undated child', exact: true }).click();
  await expect(inbox.getByRole('checkbox', { name: 'Reopen Undated action', exact: true })).toBeChecked();
  const exported = await download(page);
  expect(exported).toBe(source().replace('[ ] Nested action', '[x] Nested action').replace('[ ] Undated action', '[x] Undated action').replace('[ ] Undated child', '[x] Undated child'));
});

test('new writing can be a paragraph, table or mixed outline without a task wrapper', async ({ page }) => {
  const day = await load(page);
  await day.getByRole('button', { name: `Write in ${today()}`, exact: true }).click();
  const field = day.getByRole('textbox', { name: `Markdown for ${today()}`, exact: true });
  await field.fill('## Meeting\n\nA **direct paragraph**.\n\n| Person | Action |\n| --- | --- |\n| Sam | Review |\n\n- Context\n  - [ ] Follow up\n\n1. [ ] Ordered followup');
  await day.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(day.getByRole('heading', { name: 'Meeting', exact: true })).toBeVisible();
  await expect(day.getByRole('cell', { name: 'Sam', exact: true })).toBeVisible();
  await expect(day.getByRole('checkbox', { name: 'Complete Follow up', exact: true })).toBeVisible();
  await expect(field).toHaveCount(0);
  await day.getByRole('checkbox', { name: 'Complete Ordered followup', exact: true }).click();
  await expect(day.getByRole('checkbox', { name: 'Reopen Ordered followup', exact: true })).toBeChecked();
  const exported = await download(page);
  expect(exported).toContain('## Meeting\n\nA **direct paragraph**.\n\n| Person | Action |');
  expect(exported).toContain('1. [x] Ordered followup');
});

test('direct writing retains invalid drafts across reload and keeps native input undo', async ({ page }) => {
  const day = await load(page);
  await day.getByRole('group', { name: `Writing block 1 in ${today()}`, exact: true }).press('Enter');
  const field = day.getByRole('textbox', { name: `Markdown for ${today()}`, exact: true });
  await field.fill('Recoverable draft');
  await field.press('End'); await field.press('x');
  await expect(field).toHaveValue('Recoverable draftx');
  await field.press('ControlOrMeta+z');
  await expect(field).toHaveValue('Recoverable draft');
  await field.fill('~~~js\nUnfinished fence');
  await day.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(day.getByRole('status')).toContainText('invalid planner content');
  await expect(field).toHaveValue('~~~js\nUnfinished fence');
  await page.reload();
  await expect(field).toHaveValue('~~~js\nUnfinished fence');
  await field.fill('Recovered **writing**.');
  await day.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(field).toHaveCount(0);
  expect(await download(page)).toBe(source().replace('Daily **writing** with [context][shared].', 'Recovered **writing**.'));
});

test('legacy writing upgrades are previewable, downloadable and undoable without changing content', async ({ page }) => {
  const original = source().replace('hcb-format: 3', 'hcb-format: 2').replace('- [ ] Undated action', '- Undated action').replace('- [ ] Undated child', '- Undated child');
  await page.goto('/');
  await page.getByLabel('Import a Planner.md file').setInputFiles({ name: 'Planner.md', mimeType: 'text/markdown', buffer: Buffer.from(original) });
  await page.getByRole('button', { name: 'Enable unified writing', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Enable unified writing', exact: true });
  await expect(dialog.getByLabel('Unified writing upgrade preview')).toHaveText(original.replace('hcb-format: 2', 'hcb-format: 3'));
  const pending = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download original', exact: true }).click();
  expect(await readFile((await (await pending).path())!, 'utf8')).toBe(original);
  await dialog.getByRole('button', { name: 'Enable unified writing', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('region', { name: `Document for ${today()}`, exact: true }).getByText('Plain outline', { exact: true })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByRole('button', { name: 'Enable unified writing', exact: true })).toBeVisible();
  expect(await download(page)).toBe(original);
});

test('the shared document surface fits a phone and supports dark appearance and rich content', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const day = await load(page);
  await day.getByRole('button', { name: `Write in ${today()}`, exact: true }).click();
  await day.getByRole('textbox', { name: `Markdown for ${today()}`, exact: true }).fill('> [!note] Context\n> A **useful** note.\n\nFormula $$\\frac{1}{2} + x_i$$.');
  await day.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(day.getByRole('math')).toBeVisible();
  await expect(day.locator('[data-callout=note]')).toContainText('A useful note.');
  await runCommand(page, 'Settings');
  await page.getByRole('button', { name: 'Dark mode', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Hot Cross Buns settings', exact: true })).not.toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(day.getByRole('checkbox', { name: 'Complete Nested action', exact: true })).toBeVisible();
});

test('one child action opens a recoverable local draft and movement preserves a mixed branch',async({page})=>{
 const day=await load(page);await day.getByRole('button',{name:'Actions for Plain outline',exact:true}).click();
 const menu=page.getByLabel('Actions for Plain outline',{exact:true}).filter({has:page.getByRole('button',{name:'Add child',exact:true})});
 await expect(menu.getByRole('button',{name:'Add subtask',exact:true})).toHaveCount(0);await menu.getByRole('button',{name:'Add child',exact:true}).click();
 const field=day.getByRole('textbox',{name:`Markdown for ${today()}`,exact:true});await expect(field).toHaveValue(/- New child/);await page.keyboard.type('Plain child');await expect(field).toHaveValue(/- Plain child/);await day.getByRole('button',{name:'Save',exact:true}).click();await expect(field).toHaveCount(0);await expect(day.getByText('Plain child',{exact:true})).toBeVisible();
 await day.getByRole('button',{name:'Actions for Plain child',exact:true}).click();await page.getByRole('button',{name:'Make task',exact:true}).click();await expect(day.getByRole('checkbox',{name:'Complete Plain child',exact:true})).toBeVisible();
 await day.getByRole('button',{name:'Actions for Plain child',exact:true}).click();await page.getByRole('button',{name:'Move…',exact:true}).click();await page.getByRole('button',{name:'Indent',exact:true}).click();
 const text=await download(page);expect(text).toContain('    - [ ] Plain child');expect(text).toContain('> Attached **context** stays visible.');
});

test('undated task/plain conversion and moves preserve completion rather than resetting it',async({page})=>{
 await load(page);await page.getByRole('button',{name:'Undated',exact:true}).click();const inbox=page.getByRole('region',{name:'Document for Inbox',exact:true});await inbox.getByRole('button',{name:'Actions for Plain context',exact:true}).click();await page.getByRole('button',{name:'Make task',exact:true}).click();await expect(inbox.getByRole('checkbox',{name:'Complete Plain context',exact:true})).toBeVisible();await inbox.getByRole('checkbox',{name:'Complete Undated child',exact:true}).click();await expect(inbox.getByRole('checkbox',{name:'Reopen Undated action',exact:true})).toBeChecked();
 await inbox.getByRole('button',{name:'Actions for Undated action',exact:true}).click();await expect(page.getByRole('button',{name:'Make plain item',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Move…',exact:true}).click();await page.getByLabel('Move item to date',{exact:true}).fill(today());await page.getByRole('button',{name:'Move to date',exact:true}).click();await page.getByRole('button',{name:'Dated',exact:true}).click();await expect(page.getByRole('checkbox',{name:'Reopen Undated action',exact:true})).toBeChecked();expect(await download(page)).toContain('- [x] Undated action');
});

test('new workspaces start with direct Markdown writing and only two core views',async({page})=>{
 await page.goto('/');await expect(page.getByRole('button',{name:'Enable unified writing',exact:true})).toHaveCount(0);await expect(page.getByRole('navigation',{name:'Views',exact:true}).getByRole('button')).toHaveText(['Dated','Undated']);
 const day=page.getByRole('region',{name:`Document for ${today()}`,exact:true});await day.getByRole('button',{name:`Write in ${today()}`,exact:true}).click();await day.getByRole('textbox',{name:`Markdown for ${today()}`,exact:true}).fill('First **paragraph**.\n\n- Context\n  - [ ] First action');await day.getByRole('button',{name:'Save',exact:true}).click();await expect(day.getByRole('textbox')).toHaveCount(0);await expect(day.getByRole('checkbox',{name:'Complete First action',exact:true})).toBeVisible();expect(await download(page)).toContain('hcb-format: 3');
});

test('direct-document entry links and linked mentions move focus across the two views',async({page})=>{
 const linked=source().replace('Daily **writing** with [context][shared].','Daily **writing** with [action](#hcb-undated-action).');await page.goto('/');await page.getByLabel('Import a Planner.md file').setInputFiles({name:'Planner.md',mimeType:'text/markdown',buffer:Buffer.from(linked)});
 const day=page.getByRole('region',{name:`Document for ${today()}`,exact:true});await day.getByRole('link',{name:'action',exact:true}).click();const row=page.locator('[data-search-item-id="undated-action"]');await expect(row).toBeFocused();await row.getByText('Linked mentions (1)',{exact:true}).click();await row.getByRole('button',{name:'action',exact:true}).click();await expect(day.getByRole('link',{name:'action',exact:true})).toBeVisible();await expect(day.locator('[data-markdown-start]').first()).toBeFocused();expect(await download(page)).toBe(linked);
});

test('a changed document in another window preserves and rejects a stale local writing draft',async({page})=>{
 const day=await load(page);await day.getByRole('group', { name: `Writing block 1 in ${today()}`, exact: true }).press('Enter');const draft=day.getByRole('textbox',{name:`Markdown for ${today()}`,exact:true});await draft.fill('My recoverable draft.');
 const other=await page.context().newPage();await other.goto('/');const second=other.getByRole('region',{name:`Document for ${today()}`,exact:true});await second.getByRole('group', { name: `Writing block 1 in ${today()}`, exact: true }).press('Enter');await second.getByRole('textbox',{name:`Markdown for ${today()}`,exact:true}).fill('A newer **saved** paragraph.');await second.getByRole('button',{name:'Save',exact:true}).click();await expect(second.getByRole('textbox')).toHaveCount(0);
 await expect(day.locator('strong').filter({hasText:'saved'})).toHaveCount(0);await day.getByRole('button',{name:'Save',exact:true}).click();await expect(day.getByRole('status')).toContainText('changed');await expect(draft).toHaveValue('My recoverable draft.');await page.reload();await expect(draft).toHaveValue('My recoverable draft.');await day.getByRole('button',{name:'Cancel',exact:true}).click();await expect(day.locator('strong').filter({hasText:'saved'})).toBeVisible();await other.close();
});

test('identified roots expose child creation but cannot silently discard identity through indentation',async({page})=>{
 const day=await load(page);await day.getByRole('button',{name:'Actions for Plain outline',exact:true}).click();await expect(page.getByRole('button',{name:'Add child',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Move…',exact:true}).click();await expect(page.getByRole('button',{name:'Indent',exact:true})).toBeDisabled();await page.keyboard.press('Escape');expect(await download(page)).toBe(source());
});

test('reopening an undated task clears its retained completion date and undo restores both',async({page})=>{
 const raw=source().replace('[ ] Undated action','[x] Undated action').replace('[ ] Undated child','[x] Undated child').replace('id: undated-action','id: undated-action\n  completed: '+today());await page.goto('/');await page.getByLabel('Import a Planner.md file').setInputFiles({name:'Planner.md',mimeType:'text/markdown',buffer:Buffer.from(raw)});await page.getByRole('button',{name:'Undated',exact:true}).click();const inbox=page.getByRole('region',{name:'Document for Inbox',exact:true});await inbox.getByRole('checkbox',{name:'Reopen Undated action',exact:true}).click();await expect(inbox.getByRole('checkbox',{name:'Complete Undated action',exact:true})).not.toBeChecked();expect(await download(page)).not.toContain('completed: '+today());await page.keyboard.press('Escape');await page.keyboard.press('ControlOrMeta+z');await expect(inbox.getByRole('checkbox',{name:'Reopen Undated action',exact:true})).toBeChecked();expect(await download(page)).toBe(raw);
});


test('clicking saved prose edits it in place and returns focus after saving or cancelling',async({page})=>{
 const day=await load(page);
 await expect(day.getByRole('button',{name:`Edit block 1 in ${today()}`,exact:true})).toHaveCount(0);
 await day.locator('strong').filter({hasText:'writing'}).click();
 const field=day.getByRole('textbox',{name:`Markdown for ${today()}`,exact:true});
 await expect(field).toBeFocused();await expect(field).toHaveValue('Daily **writing** with [context][shared].');
 await field.fill('Click to **edit** this paragraph.');await field.press('ControlOrMeta+Enter');
 const block=day.getByRole('group',{name:`Writing block 1 in ${today()}`,exact:true});await expect(block).toBeFocused();
 expect(await download(page)).toBe(source().replace('Daily **writing** with [context][shared].','Click to **edit** this paragraph.'));
 await day.getByText('Click to edit this paragraph.',{exact:true}).click();await field.fill('A discarded change.');
 await day.getByRole('button',{name:'Cancel',exact:true}).click();await expect(block).toBeFocused();await expect(block).toContainText('Click to edit this paragraph.');
});

test('links, task controls and selecting rendered text do not open an editor',async({page})=>{
 const day=await load(page),popup=page.waitForEvent('popup');
 await day.getByRole('link',{name:'context',exact:true}).click();await(await popup).close();await expect(day.getByRole('textbox')).toHaveCount(0);
 await day.getByRole('checkbox',{name:'Complete Nested action',exact:true}).click();await expect(day.getByRole('checkbox',{name:'Reopen Nested action',exact:true})).toBeChecked();await expect(day.getByRole('textbox')).toHaveCount(0);
 const prose=day.getByRole('group',{name:`Writing block 1 in ${today()}`,exact:true}).locator('p');
 const bounds=(await prose.boundingBox())!;await page.mouse.move(bounds.x+3,bounds.y+bounds.height/2);await page.mouse.down();await page.mouse.move(bounds.x+70,bounds.y+bounds.height/2,{steps:8});await page.mouse.up();
 expect(await page.evaluate(()=>getSelection()?.toString().length)).toBeGreaterThan(0);await expect(day.getByRole('textbox')).toHaveCount(0);
});

test('clicking another block retains a dirty draft and reports how to finish it',async({page})=>{
 const day=await load(page);await day.locator('strong').filter({hasText:'writing'}).click();
 const field=day.getByRole('textbox',{name:`Markdown for ${today()}`,exact:true});await field.fill('Keep my current draft.');
 await day.locator('blockquote').click();await expect(field).toHaveValue('Keep my current draft.');await expect(day.getByRole('status')).toContainText('before editing another block');
 await day.getByRole('button',{name:'Cancel',exact:true}).click();await day.locator('blockquote').click();
 await expect(field).toHaveValue(/- Plain outline[\s\S]*id: plain-outline[\s\S]*Attached \*\*context\*\*/);
 await day.getByRole('button',{name:'Cancel',exact:true}).click();expect(await download(page)).toBe(source());
});


test('one quiet writing line handles empty and populated dated, undated and capture surfaces',async({page})=>{
 await page.addInitScript(()=>{window.open=()=>null;});await page.goto('/');
 const day=page.getByRole('region',{name:`Document for ${today()}`,exact:true}),line=day.getByRole('button',{name:`Write in ${today()}`,exact:true});
 await expect(day.getByRole('button',{name:/^(Add|Start) writing$/})).toHaveCount(0);
 await expect(line).toHaveCSS('cursor','text');await line.press('Enter');const field=day.getByRole('textbox',{name:`Markdown for ${today()}`,exact:true});await expect(field).toBeFocused();
 await field.fill('A first paragraph.');await field.press('ControlOrMeta+Enter');await expect(field).toHaveCount(0);await expect(day.getByText('A first paragraph.',{exact:true})).toBeVisible();
 await line.click();await expect(field).toHaveValue('');await field.fill('Another paragraph.');await field.press('ControlOrMeta+Enter');await expect(field).toHaveCount(0);await expect(day.getByText('Another paragraph.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Undated',exact:true}).click();const inbox=page.getByRole('region',{name:'Document for Inbox',exact:true});
 await inbox.getByRole('button',{name:'Write in Inbox',exact:true}).click();const undated=inbox.getByRole('textbox',{name:'Markdown for Inbox',exact:true});await undated.fill('Undated writing.');await undated.press('ControlOrMeta+Enter');await expect(undated).toHaveCount(0);await expect(inbox.getByText('Undated writing.',{exact:true})).toBeVisible();
 await runCommand(page,'Open Scratchpad');const capture=page.getByRole('dialog',{name:'Scratchpad',exact:true});await capture.getByRole('button',{name:'Write in Scratchpad',exact:true}).click();const scratch=capture.getByRole('textbox',{name:'Markdown for Scratchpad',exact:true});await scratch.fill('Captured writing.');await scratch.press('ControlOrMeta+Enter');await expect(scratch).toHaveCount(0);await expect(capture.getByText('Captured writing.',{exact:true})).toBeVisible();
});


test('inline editing grows with writing, stays bounded and retains keyboard focus visibility',async({page})=>{
 await page.setViewportSize({width:375,height:812});const day=await load(page);await day.locator('strong').filter({hasText:'writing'}).click();
 const field=day.getByRole('textbox',{name:`Markdown for ${today()}`,exact:true});await expect(field).toHaveCSS('background-color','rgba(0, 0, 0, 0)');await expect(field).toHaveCSS('border-top-width','0px');
 await field.fill(Array.from({length:80},(_,index)=>`Line ${index}`).join('\n'));
 await expect.poll(()=>field.evaluate(element=>element.clientHeight)).toBe(560);expect(await field.evaluate(element=>element.scrollHeight>element.clientHeight)).toBe(true);
 await field.fill('A short draft.');await expect.poll(()=>field.evaluate(element=>element.clientHeight)).toBeLessThan(100);
 await field.press('Tab');await page.keyboard.press('Shift+Tab');await expect(field).toBeFocused();await expect(field).not.toHaveCSS('box-shadow','none');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.emulateMedia({forcedColors:'active'});await expect(field).toHaveCSS('border-bottom-width','2px');
 await day.getByRole('button',{name:'Cancel',exact:true}).click();expect(await download(page)).toBe(source());
});
