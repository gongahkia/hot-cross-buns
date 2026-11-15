import { useEffect, useRef, useState } from 'react';
import { fileSyncLock, readLinkedText, saveLinkedText, supportsLinkedFiles, type FileLink, type FileSyncStatus, type LinkedFileHandle } from './linkedFile';
import { loadFileLink, loadTodoState, storeFileLink } from './todoStore';
import { serializeTodoText, type TodoDocument } from './todoText';

export function useLinkedFile(journalDocument: TodoDocument | null, canSave: () => boolean) {
  const ready = journalDocument !== null;
  const [status, setStatus] = useState<FileSyncStatus>({ kind: 'unlinked' });
  const record = useRef<FileLink | null>(null);
  const permitted = useRef(canSave); permitted.current = canSave;
  const failed = useRef<string | null>(null);
  const polling = useRef(false);
  const publish = (next: FileSyncStatus) => setStatus(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
  const poll = async () => {
    if (!supportsLinkedFiles() || polling.current || !permitted.current()) return;
    polling.current = true;
    try {
      await navigator.locks.request(fileSyncLock, { ifAvailable: true }, async lock => {
        if (!lock || !permitted.current()) return;
        const previous = record.current;
        const link = await loadFileLink(); record.current = link;
        if (link && previous?.id === link.id && previous.lastSavedAt !== link.lastSavedAt) failed.current = null;
        if (!link) { failed.current = null; publish({ kind: 'unlinked' }); return; }
        if (link.needsReview) { publish({ kind: 'changed', name: link.handle.name }); return; }
        if (failed.current === link.id) return;
        const journal = await loadTodoState();
        if (!permitted.current()) return;
        const outcome = await saveLinkedText(link, serializeTodoText(journal.document));
        if (outcome === 'changed') {
          await storeFileLink({ ...link, needsReview: true });
          publish({ kind: 'changed', name: link.handle.name });
        } else if (outcome === 'permission') publish({ kind: 'permission', name: link.handle.name });
        else {
          const next = outcome === 'saved' ? { ...link, baselineText: serializeTodoText(journal.document), baselineDocument: journal.document, lastSavedAt: Date.now() } : link;
          if (outcome === 'saved') await storeFileLink(next);
          record.current = next;
          publish({ kind: 'saved', name: next.handle.name, lastSavedAt: next.lastSavedAt });
        }
      });
    } catch (error) {
      failed.current = record.current?.id ?? null;
      publish({ kind: 'error', name: record.current?.handle.name, detail: String(error) });
    } finally { polling.current = false; }
  };
  const pollRef = useRef(poll); pollRef.current = poll;
  useEffect(() => {
    if (!ready) return;
    const check = () => { if (document.visibilityState === 'visible') void pollRef.current(); };
    check();
    const timer = window.setInterval(check, 1500);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => { clearInterval(timer); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); };
  }, [ready]);
  const establish = async (handle: LinkedFileHandle, raw: string, baselineDocument: TodoDocument, expectedId: string | null = null) => {
    await navigator.locks.request(fileSyncLock, async () => {
      const previous = await loadFileLink();
      if ((previous?.id ?? null) !== expectedId) throw new Error('The file link changed in another window. Open Settings and try again.');
      const link: FileLink = { id: previous?.id ?? crypto.randomUUID(), handle, baselineText: raw, baselineDocument, lastSavedAt: previous?.lastSavedAt ?? null, needsReview: false };
      await storeFileLink(link); record.current = link; failed.current = null;
      publish({ kind: 'saved', name: handle.name, lastSavedAt: link.lastSavedAt });
    });
  };
  const review = async () => {
    const handle = record.current?.handle;
    if (!handle || await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('Allow read and write access to review the linked file.');
    return navigator.locks.request(fileSyncLock, async () => {
      const link = await loadFileLink();
      if (!link) throw new Error('The file has been unlinked.');
      return { handle: link.handle, raw: await readLinkedText(link.handle), id: link.id, baselineDocument: link.baselineDocument };
    });
  };
  const resume = async () => {
    const handle = record.current?.handle;
    if (!handle || await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('Allow read and write access to resume file saving.');
    failed.current = null; await pollRef.current();
  };
  const unlink = async () => {
    await navigator.locks.request(fileSyncLock, async () => { await storeFileLink(null); record.current = null; failed.current = null; publish({ kind: 'unlinked' }); });
  };
  const awaitingSave = status.kind === 'saved' && record.current && journalDocument && serializeTodoText(journalDocument) !== record.current.baselineText;
  return { status: awaitingSave ? { ...status, kind: 'saving' as const } : status, establish, review, resume, unlink };
}
