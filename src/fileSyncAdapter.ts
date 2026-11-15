import { classifyLinkedFileError, readLinkedFile, saveLinkedText, type FileLink, type LinkedFileSnapshot } from './linkedFile.ts';
import type { SyncAdapter } from './journalSync.ts';

export const fileSyncAdapter: SyncAdapter<FileLink, LinkedFileSnapshot> = {
  name: link => link.handle.name,
  ready: async link => await (link.historyDirectory ?? link.handle).queryPermission({ mode: 'readwrite' }) === 'granted' ? null : 'permission',
  read: readLinkedFile,
  write: async (link, text) => {
    const kind = await saveLinkedText(link, text);
    if (kind === 'permission') throw new DOMException('Allow read and write access to continue file saving.', 'NotAllowedError');
    return { kind };
  },
  acknowledge: (link, snapshot, document, wrote, now) => ({ ...link, handle: snapshot.handle, conflictCopies: snapshot.conflictCopies, baselineText: snapshot.text, baselineDocument: document, lastSavedAt: wrote ? now : link.lastSavedAt }),
  classify: classifyLinkedFileError,
  network: false,
};
