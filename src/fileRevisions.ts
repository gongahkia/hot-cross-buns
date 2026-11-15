import { MAX_FOLDER_ENTRIES, type FileLink, type LinkedDirectoryHandle } from './linkedFile.ts';
import { MAX_HISTORY_BYTES, MAX_REVISIONS, MAX_REVISION_BYTES, RevisionIntegrityError, parseRevision, revisionText, sha256, type Revision, type RevisionTransport } from './revisionProtocol.ts';

type RevisionEntry = { kind: 'file'; name: string; getFile: () => Promise<{ size: number; text: () => Promise<string> }> } | { kind: 'directory'; name: string };
export async function readFolderRevisions(entries: AsyncIterable<RevisionEntry>, journal: string): Promise<Revision[]> {
  const records: Revision[] = []; let bytes = 0, visited = 0;
  for await (const entry of entries) {
    if (++visited > MAX_FOLDER_ENTRIES) throw new RevisionIntegrityError('Sync history reached its 2,000-entry scan limit, including temporary files. Keep the complete folder and inspect it before resuming. No files were removed.');
    if (entry.kind !== 'file' || !entry.name.toLowerCase().endsWith('.json')) continue;
    const file = await entry.getFile(); bytes += file.size;
    if (records.length >= MAX_REVISIONS || bytes > MAX_HISTORY_BYTES || file.size > MAX_REVISION_BYTES) throw new RevisionIntegrityError('Sync history reached its 1,000 revision / 64 MiB limit. Export and archive the complete folder before starting a new target. No history was deleted.');
    records.push(await parseRevision(await file.text(), journal));
  }
  return records;
}

export function fileRevisions(link: FileLink, device: () => Promise<string>): RevisionTransport {
  const journal = 'file:' + link.handle.name;
  const directory = async (create = false) => {
    const root = await link.historyDirectory!.getDirectoryHandle('.hot-cross-buns', { create });
    return root.getDirectoryHandle(await sha256(link.handle.name), { create }) as Promise<LinkedDirectoryHandle>;
  };
  return { journal, device,
    list: async () => readFolderRevisions((await directory()).values(), journal),
    put: async record => {
      const raw = revisionText(record); await parseRevision(raw, journal);
      const folder = await directory(true), handle = await folder.getFileHandle(record.id + '.json', { create: true });
      const existing = async () => {
        const file = await handle.getFile();
        if (file.size > MAX_REVISION_BYTES) throw new RevisionIntegrityError('A sync revision exceeds the size limit. Keep the history files and inspect them before resuming.');
        const text = await file.text(); if (!text) return false;
        if ((await parseRevision(text, journal)).digest !== record.digest) throw new RevisionIntegrityError('A different revision already uses this filename. Keep both copies for recovery.');
        return true;
      };
      if (await existing()) return;
      const writer = await handle.createWritable({ mode: 'exclusive' } as FileSystemCreateWritableOptions);
      try {
        // a transfer client can fill the empty entry while this writer is being prepared.
        if (await existing()) { await writer.abort(); return; }
        await writer.write(raw);
        if (await existing()) { await writer.abort(); return; }
        await writer.close();
      } catch (error) { try { await writer.abort(); } catch { /* an accepted close can have an uncertain receipt. */ } throw error; }
      if ((await parseRevision(await (await handle.getFile()).text(), journal)).digest !== record.digest) throw new Error('The saved revision could not be verified. TODO.txt was not written.');
    },
  };
}
