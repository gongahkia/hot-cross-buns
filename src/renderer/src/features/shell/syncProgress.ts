export const syncProgressEvent = 'hcb:sync-progress';
export type SyncProgressDetail = { id: string; phase: 'start' | 'finish'; error?: string };
export function beginSyncProgress(): (error?: string) => void {
  const id = crypto.randomUUID();
  window.dispatchEvent(new CustomEvent<SyncProgressDetail>(syncProgressEvent, { detail: { id, phase: 'start' } }));
  return error => window.dispatchEvent(new CustomEvent<SyncProgressDetail>(syncProgressEvent, { detail: { id, phase: 'finish', error } }));
}
