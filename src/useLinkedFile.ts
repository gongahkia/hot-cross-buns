import { fileSyncLock, readLinkedText, saveLinkedText, supportsLinkedFiles, type FileLink, type LinkedFileHandle } from './linkedFile';
import { loadFileLink, loadDriveLink, storeFileLink, readSyncBundle, commitReviewedLink, type ReviewedJournal, type TodoState } from './todoStore';
import { useJournalSync } from './useJournalSync';
import type { SyncAdapter } from './journalSync';
import type { TodoDocument } from './todoText';

const adapter: SyncAdapter<FileLink, { text: string }> = {
  name: link => link.handle.name,
  ready: async link => await link.handle.queryPermission({ mode: 'readwrite' }) === 'granted' ? null : 'permission',
  read: async link => ({ text: await readLinkedText(link.handle) }),
  write: async (link, text) => {
    const kind = await saveLinkedText(link, text);
    if (kind === 'permission') throw new DOMException('Allow read and write access to continue file saving.', 'NotAllowedError');
    return { kind };
  },
  acknowledge: (link, snapshot, document, wrote, now) => ({ ...link, baselineText: snapshot.text, baselineDocument: document, lastSavedAt: wrote ? now : link.lastSavedAt }),
  classify: error => error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError') ? 'permission' : 'error',
  network: false,
};
export function useLinkedFile(journal: TodoDocument | null, canSave: () => boolean, validate?: (document: TodoDocument) => void) {
  const sync = useJournalSync('file', journal, canSave, adapter, 1500, supportsLinkedFiles(), validate);
  const establish = async (handle: LinkedFileHandle, raw: string, baselineDocument: TodoDocument, expectedId: string | null = null, review?: ReviewedJournal): Promise<TodoState | null> => {
    const result = await navigator.locks.request(fileSyncLock, async () => {
      if (await loadDriveLink()) throw new Error('Unlink Google Drive before linking a local file.');
      const previous = await loadFileLink();
      if ((previous?.id ?? null) !== expectedId) throw new Error('The file link changed in another window. Open Settings and try again.');
      const link = { id: previous?.id ?? crypto.randomUUID(), handle, baselineText: raw, baselineDocument, lastSavedAt: previous?.lastSavedAt ?? null, needsReview: false };
      if (review) return commitReviewedLink('file', link, expectedId, review);
      await storeFileLink(link); return null;
    });
    await sync.refresh(); if (!review) void sync.poll(true); return result;
  };
  const review = async () => {
    const handle = sync.record?.handle;
    if (!handle || await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('Allow read and write access to review the linked file.');
    const bundle = await readSyncBundle<FileLink>('file');
    if (!bundle) throw new Error('The file has been unlinked.');
    return { generation: bundle.ledger.generation, handle: bundle.link.handle, raw: await readLinkedText(bundle.link.handle), id: bundle.link.id, baselineDocument: (bundle.ledger.checkpoint?.uncertain ? bundle.ledger.checkpoint.document : bundle.link.baselineDocument) };
  };
  const resume = async () => {
    const handle = sync.record?.handle;
    if (!handle || await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('Allow read and write access to resume file saving.');
    await sync.poll(true);
  };
  const unlink = async () => { await navigator.locks.request(fileSyncLock, () => storeFileLink(null)); await sync.refresh(); };
  return { status: sync.status, recovery: sync.ledger?.recovery, establish, review, resume, unlink };
}
