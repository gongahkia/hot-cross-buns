import type { FileLink, LinkedDirectoryHandle } from './linkedFile.ts';
import { MAX_HISTORY_BYTES, MAX_REVISIONS, MAX_REVISION_BYTES, parseRevision, revisionText, sha256, type Revision, type RevisionTransport } from './revisionProtocol.ts';

export function fileRevisions(link: FileLink, device: () => Promise<string>): RevisionTransport {
  const journal = 'file:' + link.handle.name;
  const directory = async () => {
    const root = await link.historyDirectory!.getDirectoryHandle('.hot-cross-buns', { create: true });
    return root.getDirectoryHandle(await sha256(link.handle.name), { create: true }) as Promise<LinkedDirectoryHandle>;
  };
  return { journal, device,
    list: async () => {
      const folder = await directory(), records: Revision[] = []; let bytes = 0;
      for await (const entry of folder.values()) {
        if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue;
        const file = await (entry as FileSystemFileHandle).getFile(); bytes += file.size;
        if (records.length >= MAX_REVISIONS || bytes > MAX_HISTORY_BYTES || file.size > MAX_REVISION_BYTES) throw new Error('Sync history reached its 1,000 revision / 64 MiB limit. Export and archive the complete folder before starting a new target. No history was deleted.');
        records.push(await parseRevision(await file.text(), journal));
      }
      return records;
    },
    put: async record => {
      const raw = revisionText(record); await parseRevision(raw, journal);
      const folder = await directory(), handle = await folder.getFileHandle(record.id + '.json', { create: true });
      const existing = await (await handle.getFile()).text();
      if (existing) {
        if ((await parseRevision(existing, journal)).digest !== record.digest) throw new Error('A different revision already uses this filename. Keep both copies for recovery.');
        return;
      }
      const writer = await handle.createWritable({ mode: 'exclusive' } as FileSystemCreateWritableOptions);
      try { await writer.write(raw); await writer.close(); } catch (error) { try { await writer.abort(); } catch { /* an accepted close can have an uncertain receipt. */ } throw error; }
      if ((await parseRevision(await (await handle.getFile()).text(), journal)).digest !== record.digest) throw new Error('The saved revision could not be verified. TODO.txt was not written.');
    },
  };
}
