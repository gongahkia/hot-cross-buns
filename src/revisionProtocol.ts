import { assertImportText, MAX_IMPORT_BYTES } from './importLimits.ts';

export const MAX_REVISIONS = 1000;
export const MAX_HISTORY_BYTES = 64 * 1024 * 1024;
export const MAX_REVISION_BYTES = MAX_IMPORT_BYTES * 6 + 128 * 1024;
export type Revision = { protocol: 1; journal: string; id: string; device: string; parents: string[]; origin: 'journal' | 'external'; text: string; digest: string };
export type RevisionState = {
  frontier: string[]; seenHeads: string[]; recordedText: string | null;
  pending?: { record: Revision; transportId?: string }; review?: Revision;
  handledProjection?: string; projectedHeads?: string[]; stats?: { count: number; bytes: number };
};
export type RevisionTransport = {
  journal: string; device: () => Promise<string>; reserve?: () => Promise<string>;
  list: () => Promise<Revision[]>; put: (record: Revision, transportId?: string) => Promise<void>;
};
export class MissingHistoryError extends Error {}
export class RevisionIntegrityError extends Error {}
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/;
export const utf8Size = (text: string) => new TextEncoder().encode(text).byteLength;
const body = (record: Revision) => ({ protocol: record.protocol, journal: record.journal, id: record.id, device: record.device, parents: record.parents, origin: record.origin, text: record.text });
export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export const revisionText = (record: Revision) => JSON.stringify({ ...body(record), digest: record.digest });
export function assertHistorySpace(stats: RevisionState['stats'], record: Revision): void {
  if (stats && (stats.count >= MAX_REVISIONS || stats.bytes + utf8Size(revisionText(record)) > MAX_HISTORY_BYTES)) throw new RevisionIntegrityError('Sync history reached its 1,000 revision / 64 MiB limit. Export and archive the complete history before starting a new target. No history was removed.');
}
export async function createRevision(journal: string, device: string, parents: string[], text: string, origin: Revision['origin'] = 'journal'): Promise<Revision> {
  assertImportText(text);
  const record: Revision = { protocol: 1, journal, id: crypto.randomUUID(), device, parents: [...new Set(parents)].sort(), origin, text, digest: '' };
  record.digest = await sha256(JSON.stringify(body(record)));
  return record;
}
export async function parseRevision(raw: string, journal: string): Promise<Revision> {
  if (!raw) throw new MissingHistoryError('A history file is still empty. Waiting for its transfer to finish.');
  if (utf8Size(raw) > MAX_REVISION_BYTES) throw new RevisionIntegrityError('A sync revision exceeds the size limit. Keep the history files and inspect them before resuming.');
  let record: Revision;
  try { record = JSON.parse(raw) as Revision; } catch { throw new RevisionIntegrityError('A sync revision is incomplete or malformed. Keep both copies and inspect the history files.'); }
  if (!record || record.protocol !== 1 || record.journal !== journal || !uuid.test(record.id) || !uuid.test(record.device)
    || !Array.isArray(record.parents) || record.parents.length > MAX_REVISIONS || record.parents.some(id => typeof id !== 'string' || !uuid.test(id) || id === record.id)
    || new Set(record.parents).size !== record.parents.length || [...record.parents].sort().join() !== record.parents.join()
    || !['journal', 'external'].includes(record.origin) || typeof record.text !== 'string' || typeof record.digest !== 'string'
    || Object.keys(record).sort().join() !== 'device,digest,id,journal,origin,parents,protocol,text') throw new RevisionIntegrityError('A sync revision has an unsupported format or belongs to a different journal. File saving is paused.');
  assertImportText(record.text);
  if (await sha256(JSON.stringify(body(record))) !== record.digest) throw new RevisionIntegrityError('A sync revision failed its integrity check. File saving is paused; no history files were removed.');
  return record;
}
export async function revisionGraph(records: Revision[], journal: string) {
  const byId = new Map<string, Revision>(); let bytes = 0;
  for (const candidate of records) {
    const raw = revisionText(candidate), record = await parseRevision(raw, journal), previous = byId.get(record.id);
    if (previous) { if (previous.digest !== record.digest) throw new RevisionIntegrityError('Two different sync revisions use the same identity. Keep both files for recovery.'); continue; }
    byId.set(record.id, record); bytes += utf8Size(raw);
    if (byId.size > MAX_REVISIONS || bytes > MAX_HISTORY_BYTES) throw new RevisionIntegrityError('Sync history reached its 1,000 revision / 64 MiB limit. Export the journal and archive the complete sync folder or Drive history before starting a new target. History is never pruned automatically.');
  }
  const parents = new Set<string>();
  for (const record of byId.values()) for (const id of record.parents) {
    if (!byId.has(id)) throw new MissingHistoryError('Sync history is missing an ancestor. Waiting for the remaining history files; no journal changes were applied.');
    parents.add(id);
  }
  const ancestors = new Map<string, Set<string>>(), visiting = new Set<string>(); let work = 0;
  const visit = (id: string): Set<string> => {
    const cached = ancestors.get(id); if (cached) return cached;
    if (visiting.has(id)) throw new RevisionIntegrityError('Sync history contains a cycle. File saving is paused.');
    visiting.add(id); const found = new Set([id]);
    for (const parent of byId.get(id)!.parents) for (const ancestor of visit(parent)) {
      if (++work > 1_000_000) throw new RevisionIntegrityError('Sync ancestry exceeds the work budget. Export and archive the complete history before starting a new target.');
      found.add(ancestor);
    }
    visiting.delete(id); ancestors.set(id, found); return found;
  };
  for (const id of byId.keys()) visit(id);
  const heads = [...byId.keys()].filter(id => !parents.has(id)).sort();
  return { byId, heads, ancestors, stats: { count: byId.size, bytes } };
}
