import { expect, type Page } from '@playwright/test';

export async function holdSyncDelivery(page: Page) {
  await page.evaluate(() => {
    void navigator.locks.request('hot-cross-buns-sync-delivery', () => new Promise<void>(resolve => Reflect.set(window, 'releaseSyncDelivery', resolve)));
  });
  await expect.poll(() => page.evaluate(() => typeof Reflect.get(window, 'releaseSyncDelivery'))).toBe('function');
  return () => page.evaluate(() => { Reflect.get(window, 'releaseSyncDelivery')(); Reflect.deleteProperty(window, 'releaseSyncDelivery'); });
}
export async function syncState(page: Page, key: string): Promise<any> {
  return page.evaluate(key => new Promise((resolve, reject) => {
    const open = indexedDB.open('hot-cross-buns-v1');
    open.onsuccess = () => { const db = open.result, read = db.transaction('state').objectStore('state').get(key); read.onsuccess = () => { db.close(); resolve(read.result ?? null); }; read.onerror = () => { db.close(); reject(read.error); }; };
    open.onerror = () => reject(open.error);
  }), key);
}
