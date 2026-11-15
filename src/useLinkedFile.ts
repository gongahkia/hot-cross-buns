import { fileSyncLock, pickSyncFolder, readLinkedText, saveLinkedText, supportsLinkedFiles, type FileLink, type LinkedFileHandle, type LinkedDirectoryHandle } from './linkedFile';
import { loadFileLink, loadDriveLink, storeFileLink, readSyncBundle, commitReviewedLink, loadSyncDevice, type ReviewedJournal, type TodoState } from './todoStore';
import { useJournalSync } from './useJournalSync';
import { fileRevisions } from './fileRevisions';
import { revisionGraph } from './revisionProtocol';
import type { SyncAdapter } from './journalSync';
import type { TodoDocument } from './todoText';

const adapter: SyncAdapter<FileLink, { text: string }> = {
  name: link => link.handle.name,
  ready: async link => await (link.historyDirectory ?? link.handle).queryPermission({ mode: 'readwrite' }) === 'granted' ? null : 'permission',
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
  const sync = useJournalSync<FileLink, { text: string }>('file', journal, canSave, adapter, 1500, supportsLinkedFiles(), validate, link => link.historyDirectory ? { ...adapter, revisions: fileRevisions(link, loadSyncDevice) } : adapter);
  const establish = async (handle: LinkedFileHandle, raw: string, baselineDocument: TodoDocument, expectedId: string | null = null, review?: ReviewedJournal, historyDirectory?: LinkedDirectoryHandle): Promise<TodoState | null> => {
    const result = await navigator.locks.request(fileSyncLock, async () => {
      if (await loadDriveLink()) throw new Error('Unlink Google Drive before linking a local file.');
      const previous = await loadFileLink();
      if ((previous?.id ?? null) !== expectedId) throw new Error('The file link changed in another window. Open Settings and try again.');
      const link = { id: previous?.id ?? crypto.randomUUID(), handle, baselineText: previous?.historyDirectory && review?.revisionId ? previous.baselineText : raw, baselineDocument, lastSavedAt: previous?.lastSavedAt ?? null, needsReview: false, historyDirectory: historyDirectory ?? previous?.historyDirectory };
      if (review) return commitReviewedLink('file', link, expectedId, review);
      await storeFileLink(link); return null;
    });
    await sync.refresh(); if (!review) void sync.poll(true); return result;
  };
  const review = async () => {
    const handle = sync.record?.handle;
    if (!handle || await (sync.record?.historyDirectory ?? handle).requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('Allow read and write access to review the linked file.');
    const bundle = await readSyncBundle<FileLink>('file');
    if (!bundle) throw new Error('The file has been unlinked.');
    const revision = bundle.ledger.revisions?.review;
    return { generation: bundle.ledger.generation, handle: bundle.link.handle, raw: revision?.text ?? await readLinkedText(bundle.link.handle), id: bundle.link.id, revisionId: revision?.id, baselineDocument: (bundle.ledger.checkpoint?.uncertain ? bundle.ledger.checkpoint.document : bundle.link.baselineDocument) };
  };
  const verifyReview = async (id: string) => {
    const bundle = await readSyncBundle<FileLink>('file');
    if (!bundle?.link.historyDirectory || bundle.ledger.revisions?.review?.id !== id) throw new Error('The journal revision changed. Cancel and review it again.');
    const records = await fileRevisions(bundle.link, loadSyncDevice).list();
    const graph = await revisionGraph(records, 'file:' + bundle.link.handle.name);
    const record = graph.byId.get(id);
    if (!record || record.digest !== bundle.ledger.revisions.review.digest) throw new Error('The reviewed history file is missing or changed. Keep the review open until its transfer finishes.');
    return record.text;
  };
  const enableHistory = async () => {
    const folder = await pickSyncFolder(), previous = await loadFileLink();
    if (!previous) throw new Error('The file was unlinked. Link the sync folder again.');
    const handle = await folder.getFileHandle(previous.handle.name);
    if (!await handle.isSameEntry(previous.handle)) throw new Error('Choose the folder containing the linked file. The existing file and journal were kept.');
    await navigator.locks.request('hot-cross-buns-sync-delivery', () => navigator.locks.request(fileSyncLock, async () => {
      const latest = await loadFileLink();
      if (latest?.id !== previous.id) throw new Error('The file link changed. Try again.');
      await storeFileLink({ ...latest, historyDirectory: folder });
    }));
    await sync.refresh(); void sync.poll(true);
  };
  const resume = async () => {
    const handle = sync.record?.handle;
    if (!handle || await (sync.record?.historyDirectory ?? handle).requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('Allow read and write access to resume file saving.');
    await sync.poll(true);
  };
  const unlink = async () => { await navigator.locks.request(fileSyncLock, () => storeFileLink(null)); await sync.refresh(); };
  return { status: sync.status, recovery: sync.ledger?.recovery, revisions: sync.ledger?.revisions, protected: !!sync.record?.historyDirectory, establish, review, verifyReview, enableHistory, resume, unlink };
}
