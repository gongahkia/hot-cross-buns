import type { Page } from '@playwright/test';

/** existing row-editor tests run against a real saved version-1 workspace. */
export async function openLegacyJournal(page: Page) {
  await page.goto('/');
  await page.getByRole('region',{name:'Dated journal',exact:true}).waitFor();
  const changed=await page.evaluate(()=>new Promise<boolean>((resolve,reject)=>{
    const request=indexedDB.open('hot-cross-buns-v1',4);
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result,tx=db.transaction('state','readwrite'),store=tx.objectStore('state'),read=store.get('current');let changed=false;
      read.onsuccess=()=>{
        const state=read.result,document=state?.document;
        if(document?.source?.includes('hcb-format: 3') && !document.days.length && !document.undated?.some((list:{items:unknown[]})=>list.items.length) && !document.scratchpad && !document.source.replace(/^---[\s\S]*?---/, '').replace(/^#{1,3} (?:Hot Cross Buns|Dated|Undated|Inbox|Scratchpad)\s*$/gm,'').trim()){
          state.document={...document,source:document.source.replace('hcb-format: 3','hcb-format: 1')};store.put(state,'current');changed=true;
        }
      };
      tx.oncomplete=()=>{db.close();resolve(changed);};tx.onabort=()=>{db.close();reject(tx.error);};
    };
  }));
  if(changed){await page.reload();await page.getByRole('region',{name:'Dated journal',exact:true}).waitFor();}
}
