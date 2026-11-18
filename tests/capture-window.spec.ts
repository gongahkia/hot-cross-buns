import { expect, test, type Page } from '@playwright/test';
import {syncState} from './sync-helpers';
import { runCommand } from './commands';

const fixture = '---\nhcb-format: 3\ndocument-id: capture-window\n---\n\n## Dated\n\n## Undated\n\n### Inbox\n\n## Scratchpad\nA **shared capture**.\n';
async function load(page: Page, text = fixture) {
  await page.goto('/');
  await page.getByLabel('Import a Planner.md file').setInputFiles({ name: 'Planner.md', mimeType: 'text/markdown', buffer: Buffer.from(text) });
  await expect(page.getByRole('navigation', { name: 'Views', exact: true }).getByRole('button')).toHaveText(['Dated', 'Undated']);
}

test('Commands opens one reusable capture window and preserves its unsaved Markdown draft', async ({ page, context }) => {
  await load(page);
  const pending = page.waitForEvent('popup');
  await runCommand(page, 'Open Scratchpad');
  const popup = await pending;
  await expect(popup).toHaveURL(/popout=scratchpad/);
  await expect(popup).toHaveTitle('Scratchpad · Hot Cross Buns');
  await popup.getByRole('button', { name: 'Edit block 1 in Scratchpad', exact: true }).click();
  const field = popup.getByRole('textbox', { name: 'Markdown for Scratchpad', exact: true });
  await field.fill('An **unsaved capture**.');
  await runCommand(page, 'Open Scratchpad');
  expect(context.pages()).toHaveLength(2);
  await expect(field).toHaveValue('An **unsaved capture**.');
  await popup.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(field).toHaveCount(0);
  await expect(popup.getByRole('region', { name: 'Quick capture', exact: true }).locator('strong')).toHaveText('unsaved capture');
  await popup.close();
  const reopened = page.waitForEvent('popup');
  await runCommand(page, 'Open Scratchpad');
  const next = await reopened;
  await expect(next.getByRole('region', { name: 'Quick capture', exact: true }).locator('strong')).toHaveText('unsaved capture');
  await next.close();
});

test('mobile capture opens in-app and retains a draft when closed and reopened', async ({ page, context }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await load(page);
  await runCommand(page, 'Open Scratchpad');
  const dialog = page.getByRole('dialog', { name: 'Scratchpad', exact: true });
  await expect(dialog).toBeVisible();
  expect(context.pages()).toHaveLength(1);
  await dialog.getByRole('button', { name: 'Edit block 1 in Scratchpad', exact: true }).click();
  const field = dialog.getByRole('textbox', { name: 'Markdown for Scratchpad', exact: true });
  await field.fill('A **mobile draft**.');
  await dialog.getByRole('button', { name: 'Close Scratchpad', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await runCommand(page, 'Open Scratchpad');
  await expect(field).toHaveValue('A **mobile draft**.');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog.locator('strong')).toHaveText('mobile draft');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('a blocked desktop popup falls back to the same capture editor', async ({ page, context }) => {
  await page.addInitScript(() => { window.open = () => null; });
  await load(page);
  await runCommand(page, 'Open Scratchpad');
  const dialog = page.getByRole('dialog', { name: 'Scratchpad', exact: true });
  await expect(dialog.locator('strong')).toHaveText('shared capture');
  await expect(dialog.getByRole('button', { name: 'Add writing', exact: true })).toBeVisible();
  expect(context.pages()).toHaveLength(1);
  await dialog.getByRole('button', { name: 'Close Scratchpad', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Dated', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('capture retains its cross-window editing lease and an old draft survives takeover', async ({ page, context }) => {
  await page.addInitScript(() => { window.open = () => null; });
  await load(page);
  await runCommand(page, 'Open Scratchpad');
  const first = page.getByRole('dialog', { name: 'Scratchpad', exact: true });
  await first.getByRole('button', { name: 'Edit block 1 in Scratchpad', exact: true }).click();
  const draft = first.getByRole('textbox', { name: 'Markdown for Scratchpad', exact: true });
  await draft.fill('Keep this **old draft**.');
  const second = await context.newPage();
  await second.goto('/?popout=scratchpad');
  await expect(second.getByRole('button', { name: 'Take over editing', exact: true })).toBeVisible();
  await expect(second.getByRole('button', { name: 'Edit block 1 in Scratchpad', exact: true })).toHaveCount(0);
  await second.getByRole('button', { name: 'Take over editing', exact: true }).click();
  await second.getByRole('button', { name: 'Edit block 1 in Scratchpad', exact: true }).click();
  await second.getByRole('textbox', { name: 'Markdown for Scratchpad', exact: true }).fill('A **newer capture**.');
  await second.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(second.getByRole('region', { name: 'Quick capture', exact: true }).locator('strong')).toHaveText('newer capture');
  await expect(draft).toHaveValue('Keep this **old draft**.');
  await expect(draft).toHaveAttribute('readonly');
  await expect(first.getByRole('button', { name: 'Download draft', exact: true })).toBeVisible();
  await second.close();
});

test('capture blocks copy or move with Markdown structure and one atomic undo', async ({ page }) => {
  await page.addInitScript(() => { window.open = () => null; });
  await load(page, fixture.replace('A **shared capture**.\n', 'A **paragraph**.\n\n- [x] Parent\n  - [x] Child\n\n~~~js\nconst retained = "🥐";\n~~~\n'));
  await runCommand(page, 'Open Scratchpad');
  const capture = page.getByRole('dialog', { name: 'Scratchpad', exact: true });
  const before=(await syncState(page,'current')).document.source;
  await capture.getByRole('button', { name: 'Move block 2 from Scratchpad', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Move to undated', exact: true }).click();
  const destination = page.getByRole('dialog', { name: 'Move Markdown to an undated document', exact: true });
  await destination.getByLabel('Keep source text', { exact: true }).selectOption('copy');
  await destination.getByRole('button', { name: 'Copy content', exact: true }).click();
  await expect(destination).not.toBeVisible();
  await expect(capture.getByRole('checkbox', { name: 'Reopen Parent', exact: true })).toBeChecked();
  const copied=(await syncState(page,'current')).document.source;
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async()=>(await syncState(page,'current')).document.source).toBe(before);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(async()=>(await syncState(page,'current')).document.source).toBe(copied);
  await capture.getByRole('button', { name: 'Close Scratchpad', exact: true }).click();
  await page.getByRole('button', { name: 'Undated', exact: true }).click();
  const inbox = page.getByRole('region', { name: 'Document for Inbox', exact: true });
  await expect(inbox.getByRole('checkbox', { name: 'Reopen Parent', exact: true })).toBeChecked();
  await expect(inbox.getByRole('checkbox', { name: 'Reopen Child', exact: true })).toBeChecked();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(inbox.getByRole('checkbox')).toHaveCount(0);
  await runCommand(page, 'Open Scratchpad');
  await capture.getByRole('button', { name: 'Move block 3 from Scratchpad', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Move to undated', exact: true }).click();
  await destination.getByRole('button', { name: 'Move content', exact: true }).click();
  await expect(destination).not.toBeVisible();
  await expect(capture.getByText('const retained = "🥐";', { exact: true })).toHaveCount(0);
  await capture.getByRole('button', { name: 'Close Scratchpad', exact: true }).click();
  await expect(inbox.locator('code')).toHaveText('const retained = "🥐";');
  await page.getByRole('button', { name: 'Undo scratchpad conversion', exact: true }).click();
  await expect(inbox.locator('code')).toHaveCount(0);
  await runCommand(page, 'Open Scratchpad');
  await expect(capture.locator('code')).toHaveText('const retained = "🥐";');
});

test('takeover waits for an accepted rich capture save before granting the next editor',async({page})=>{
 await page.addInitScript(()=>{
  window.open=()=>null;
  const post=Worker.prototype.postMessage;
  Worker.prototype.postMessage=function(message,options?:StructuredSerializeOptions|Transferable[]){
   if(message.kind==='writing' && message.operation?.markdown?.includes('Held **capture**')){
    Reflect.set(window,'releaseHeldCapture',()=>post.call(this,message,options as StructuredSerializeOptions));return;
   }
   post.call(this,message,options as StructuredSerializeOptions);
  };
 });
 await load(page);await runCommand(page,'Open Scratchpad');const first=page.getByRole('dialog',{name:'Scratchpad',exact:true});await first.getByRole('button',{name:'Edit block 1 in Scratchpad',exact:true}).click();await first.getByRole('textbox',{name:'Markdown for Scratchpad',exact:true}).fill('Held **capture**.');await first.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>typeof Reflect.get(window,'releaseHeldCapture')==='function');
 const other=await page.context().newPage();await other.goto('/?popout=scratchpad');await other.getByRole('button',{name:'Take over editing',exact:true}).click();await expect(other.getByText('Taking over the scratchpad…',{exact:false})).toBeVisible();await expect(other.getByRole('button',{name:'Edit block 1 in Scratchpad',exact:true})).toHaveCount(0);
 await page.evaluate(()=>Reflect.get(window,'releaseHeldCapture')());await expect(first.getByRole('textbox',{name:'Markdown for Scratchpad',exact:true})).toHaveCount(0);await expect(other.getByRole('button',{name:'Edit block 1 in Scratchpad',exact:true})).toBeVisible();await expect(other.getByRole('region',{name:'Quick capture',exact:true}).locator('strong')).toHaveText('capture');await expect(first.getByRole('button',{name:'Take over editing',exact:true})).toBeVisible();await other.close();
});
