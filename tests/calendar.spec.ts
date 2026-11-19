import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { runCommand } from './commands';
const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const next = () => { const date=new Date(`${today()}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+1);return date.toISOString().slice(0,10); };
const source = () => `---\nhcb-format: 3\ndocument-id: calendar-browser\n---\n\n## Dated\n\n### ${today()}\n\nDaily **prose**.\n\n- [ ] 09:00-10:00 Meeting\n  \`\`\`hcb\n  id: meeting\n  \`\`\`\n\n  > **Context** stays here.\n\n- [ ] Untimed task\n  \`\`\`hcb\n  id: untimed\n  \`\`\`\n\n- Holiday\n  \`\`\`hcb\n  id: holiday\n  span: all-day through ${next()}\n  \`\`\`\n\n- [ ] 08:00-08:30 Daily\n  \`\`\`hcb\n  id: daily\n  repeat: daily; series daily\n  \`\`\`\n\n## Undated\n\n### Inbox\n\n## Scratchpad\n`;
async function load(page:Page){await page.goto('/');await page.getByLabel('Import a Planner.md file').setInputFiles({name:'Planner.md',mimeType:'text/markdown',buffer:Buffer.from(source())});await page.getByRole('button',{name:'Calendar',exact:true}).click();}
async function exported(page:Page){await runCommand(page,'Download Planner.md');const pending=page.waitForEvent('download');await page.getByRole('dialog',{name:'Download Planner.md',exact:true}).getByRole('button',{name:'download',exact:true}).click();return readFile((await (await pending).path())!,'utf8');}
async function openMeeting(page:Page){await page.getByLabel('Calendar period',{exact:true}).selectOption('day');await page.getByRole('button',{name:`Open Meeting on ${today()}`,exact:true}).click();return page.getByRole('dialog',{name:'Edit calendar entry',exact:true});}

test('calendar stays within Dated, displays canonical periods and preserves source on read',async({page})=>{
 await load(page);await expect(page.getByRole('button',{name:'Add writing',exact:true})).toBeInViewport();await expect(page.getByRole('grid',{name:'Month calendar',exact:true})).toBeVisible();
 await page.getByRole('button',{name:`Show day ${today()}`,exact:true}).click();
 await expect(page.getByLabel('Calendar period',{exact:true})).toHaveValue('day');
 await expect(page.getByRole('button',{name:`Open Meeting on ${today()}`,exact:true})).toContainText('09:00–10:00');
 await expect(page.getByRole('button',{name:`Open Holiday on ${today()}`,exact:true})).toBeVisible();
 await page.getByLabel('Calendar period',{exact:true}).selectOption('week');await expect(page.getByLabel('Week calendar',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:`Open Holiday on ${next()}`,exact:true})).toBeVisible();
 expect(await exported(page)).toBe(source());
});
test('calendar completion, time editing, day-document creation and journal undo use the same source',async({page})=>{
 await load(page);let entry=await openMeeting(page);await expect(entry.locator('blockquote')).toContainText('Context stays here.');
 await entry.getByRole('button',{name:'More actions for 09:00-10:00 Meeting',exact:true}).click();await entry.getByRole('button',{name:'Schedule…',exact:true}).click();await entry.getByRole('button',{name:'Set time block for 09:00-10:00 Meeting',exact:true}).click();
 const time=page.getByRole('dialog',{name:'Time block for 09:00-10:00 Meeting',exact:true});await time.getByLabel('Start time',{exact:true}).fill('10:00');await time.getByLabel('End time',{exact:true}).fill('11:00');await time.getByRole('button',{name:'save',exact:true}).click();
 await expect(entry.getByRole('textbox',{name:'Edit 10:00-11:00 Meeting',exact:true})).toBeVisible();await entry.getByRole('button',{name:'Close entry',exact:true}).click();
 await page.getByRole('checkbox',{name:`Complete Meeting on ${today()}`,exact:true}).click();await expect(page.getByRole('checkbox',{name:`Reopen Meeting on ${today()}`,exact:true})).toBeChecked();
 await page.getByRole('button',{name:`Add writing to ${today()}`,exact:true}).click();const field=page.getByRole('textbox',{name:`Markdown for ${today()}`,exact:true});await expect(field).toBeFocused();await field.fill('A direct **calendar capture**.');await page.getByRole('button',{name:'Save',exact:true}).click();await expect(field).toHaveCount(0);await expect(page.locator('strong').filter({hasText:'calendar capture'})).toBeVisible();
 await page.keyboard.press('ControlOrMeta+z');await expect(page.locator('strong').filter({hasText:'calendar capture'})).toHaveCount(0);
 const text=await exported(page);expect(text).toContain('- [x] 10:00-11:00 Meeting');expect(text).toContain('> **Context** stays here.');
});
test('recurring calendar edits ask scope and materialize only the chosen occurrence',async({page})=>{
 await load(page);await page.getByLabel('Calendar period',{exact:true}).selectOption('day');await page.getByRole('button',{name:'Next day',exact:true}).click();
 await page.getByRole('button',{name:`Open Daily on ${next()}`,exact:true}).click();const entry=page.getByRole('dialog',{name:'Edit calendar entry',exact:true});const title=entry.getByRole('textbox',{name:'Edit 08:00-08:30 Daily',exact:true});await title.fill('Exception');await title.press('Tab');
 const scope=page.getByRole('dialog',{name:'Choose recurring edit scope',exact:true});await expect(scope).toBeVisible();await scope.getByRole('button',{name:'This item',exact:true}).click();await expect(entry.getByRole('textbox',{name:'Edit 08:00-08:30 Exception',exact:true})).toBeVisible();await entry.getByRole('button',{name:'Close entry',exact:true}).click();
 const text=await exported(page);expect(text).toContain('- [ ] 08:00-08:30 Daily');expect(text).toContain('- [ ] 08:00-08:30 Exception');expect(text).toContain(`replaces: daily on ${next()}`);
});
test('month keyboard navigation and phone day/week layouts stay bounded in both themes',async({page})=>{
 await page.setViewportSize({width:375,height:812});await load(page);const date=page.getByRole('button',{name:`Show day ${today()}`,exact:true});await date.focus();await date.press('ArrowRight');await expect(page.getByRole('button',{name:`Show day ${next()}`,exact:true})).toBeFocused();await page.keyboard.press('Enter');await expect(page.getByLabel('Calendar period',{exact:true})).toHaveValue('day');
 await page.getByLabel('Calendar period',{exact:true}).selectOption('week');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await runCommand(page,'Settings');await page.getByRole('button',{name:'Dark mode',exact:true}).click();await page.keyboard.press('Escape');await expect(page.locator('html')).toHaveAttribute('data-theme','night');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('recurring attached Markdown stays local until scope approval and a single-occurrence reschedule retains it',async({page})=>{
 const raw=source().replace('repeat: daily; series daily\n  ```\n\n## Undated','repeat: daily; series daily\n  ```\n\n  Daily **context**.\n\n## Undated');
 await page.goto('/');await page.getByLabel('Import a Planner.md file').setInputFiles({name:'Planner.md',mimeType:'text/markdown',buffer:Buffer.from(raw)});await page.getByRole('button',{name:'Calendar',exact:true}).click();await page.getByLabel('Calendar period',{exact:true}).selectOption('day');await page.getByRole('button',{name:'Next day',exact:true}).click();await page.getByRole('button',{name:`Open Daily on ${next()}`,exact:true}).click();
 const entry=page.getByRole('dialog',{name:'Edit calendar entry',exact:true});await entry.getByRole('group', { name: 'Writing block 1 in 08:00-08:30 Daily', exact: true }).press('Enter');const field=entry.getByRole('textbox',{name:'Markdown for 08:00-08:30 Daily',exact:true});await field.fill('An **exception body**.');await entry.getByRole('button',{name:'Save',exact:true}).click();const scope=page.getByRole('dialog',{name:'Choose recurring edit scope',exact:true});await expect(scope).toBeVisible();await scope.getByRole('button',{name:'This item',exact:true}).click();await expect(field).toHaveCount(0);await expect(entry.locator('strong')).toContainText('exception body');
 await entry.getByRole('button',{name:'More actions for 08:00-08:30 Daily',exact:true}).click();await entry.getByRole('button',{name:'Move…',exact:true}).click();await entry.getByRole('button',{name:'Move 08:00-08:30 Daily',exact:true}).click();await entry.getByRole('button',{name:'Move 08:00-08:30 Daily to today',exact:true}).click();await scope.getByRole('button',{name:'This item',exact:true}).click();await entry.getByRole('button',{name:'Close entry',exact:true}).click();
 const text=await exported(page);expect(text).toContain('Daily **context**.');expect(text).toContain('An **exception body**.');expect(text).toContain(`replaces: daily on ${next()}`);
});

for (const width of [1280, 800, 600, 375]) {
 test(`calendar keeps the writing column aligned when toggling views at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000});await page.goto('/');
  await page.getByLabel('Import a Planner.md file').setInputFiles({name:'Planner.md',mimeType:'text/markdown',buffer:Buffer.from(source())});
  await expect(page.getByRole('region',{name:`Document for ${today()}`,exact:true}).getByRole('checkbox',{name:'Complete Untimed task',exact:true})).toBeVisible();
  const frame=async()=>{const bounds=(await page.getByRole('main').boundingBox())!;return{x:bounds.x,width:bounds.width};};
  const writing=await frame();
  await page.getByRole('button',{name:'Calendar',exact:true}).click();
  for(const mode of ['month','week','day']){
   await page.getByLabel('Calendar period',{exact:true}).selectOption(mode);
   expect(await frame()).toEqual(writing);
   const calendar=mode==='month'?page.getByRole('grid',{name:'Month calendar',exact:true}):page.getByLabel(`${mode==='week'?'Week':'Day'} calendar`,{exact:true});
   const bounds=(await calendar.boundingBox())!;
   expect(bounds.x).toBeGreaterThanOrEqual(writing.x);expect(bounds.x+bounds.width).toBeLessThanOrEqual(writing.x+writing.width);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await page.getByRole('button',{name:'List',exact:true}).click();expect(await frame()).toEqual(writing);
  await page.getByRole('button',{name:'Undated',exact:true}).click();expect(await frame()).toEqual(writing);
  await page.getByRole('button',{name:'Dated',exact:true}).click();await page.getByRole('button',{name:'Calendar',exact:true}).click();expect(await frame()).toEqual(writing);
 });
}
