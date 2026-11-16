import { constants, createReadStream } from 'node:fs';
import { lstat, opendir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { MAX_FOLDER_ENTRIES, isJournalConflictCopy } from '../src/linkedFile.ts';
import { readFolderRevisions } from '../src/fileRevisions.ts';
import { MAX_HISTORY_BYTES, MAX_REVISION_BYTES, revisionGraph, sha256 } from '../src/revisionProtocol.ts';
import { MAX_IMPORT_BYTES, assertImportText } from '../src/importLimits.ts';

async function regular(path, directory = false) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile())) throw new Error('Expected a regular file or directory; symbolic links are not followed.');
  return stat;
}
async function readBounded(path, limit) {
  const stat = await regular(path);
  if (stat.size > limit) throw new Error('A file exceeds the sync size limit.');
  const chunks = []; let bytes = 0;
  for await (const chunk of createReadStream(path, { highWaterMark: 64 * 1024, flags: constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) })) {
    bytes += chunk.length; if (bytes > limit) throw new Error('A file grew beyond the sync size limit while checking.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function check() {
  const [folder, name = 'Planner.md', ...extra] = process.argv.slice(2);
  if (!folder || extra.length || !name || /[\\/\u0000-\u001f]/.test(name) || ['.', '..'].includes(name)) throw new Error('Usage: npm run --silent sync:check -- /path/to/journal-folder [journal-filename]');
  const root = resolve(folder); await regular(root, true);
  const projection = await readBounded(join(root, name), MAX_IMPORT_BYTES); assertImportText(projection.toString('utf8'));
  const historyRoot = join(root, '.hot-cross-buns'); await regular(historyRoot, true);
  const historyPath = join(historyRoot, await sha256(name)); await regular(historyPath, true);
  let physicalBytes = 0;
  const entries = async function* () {
    for await (const entry of await opendir(historyPath)) {
      if (entry.isDirectory()) { yield { kind: 'directory', name: entry.name }; continue; }
      const path = join(historyPath, entry.name);
      yield { kind: 'file', name: entry.name, getFile: async () => {
        const stat = await regular(path);
        return { size: stat.size, text: async () => {
          const data = await readBounded(path, Math.min(MAX_REVISION_BYTES, MAX_HISTORY_BYTES - physicalBytes));
          physicalBytes += data.length; return data.toString('utf8');
        } };
      } };
    }
  };
  const journal = 'file:' + name, graph = await revisionGraph(await readFolderRevisions(entries(), journal), journal);
  if (!graph.byId.size) throw new Error('No published history is present. Finish local saving and transfer the complete companion history.');
  let visited = 0, conflictCopies = 0;
  for await (const entry of await opendir(root)) {
    if (++visited > MAX_FOLDER_ENTRIES) throw new Error('The sync folder reached its 2,000-entry scan limit.');
    if (entry.isFile() && isJournalConflictCopy(entry.name, name)) conflictCopies++;
  }
  const pairs = [...graph.byId.values()].map(record => [record.id, record.digest]).sort((a, b) => a[0].localeCompare(b[0]));
  console.log(JSON.stringify({ format: 1, journal, projection: { bytes: projection.length, sha256: createHash('sha256').update(projection).digest('hex') },
    history: { revisions: graph.stats.count, bytes: graph.stats.bytes, heads: graph.heads, sha256: await sha256(JSON.stringify(pairs)) }, conflictCopies }, null, 2));
}
check().catch(error => { console.error('Sync folder check failed:', error instanceof Error ? error.message : 'Unknown error'); process.exitCode = 1; });
