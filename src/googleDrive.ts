import { assertImportSize, assertImportText, MAX_IMPORT_BYTES } from './importLimits.ts';
import type { TodoDocument } from './todoText.ts';
import { MAX_HISTORY_BYTES, MAX_REVISIONS, MAX_REVISION_BYTES, MissingHistoryError, parseRevision, revisionText, utf8Size, type Revision, type RevisionTransport } from './revisionProtocol.ts';

export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export type GoogleSession = { accessToken: string; expiresAt: number; accountId: string; email: string };
export type DriveFile = { id: string; name: string; version: string; mimeType: string; size?: string; trashed?: boolean; modifiedTime?: string; capabilities?: { canEdit?: boolean } };
export type DriveSnapshot = { file: DriveFile; text: string; etag: string | null; revisionId?: string };
export type DriveLink = { id: string; fileId: string; fileName: string; accountId: string; email: string; baselineText: string; baselineDocument: TodoDocument; version: string; needsReview: boolean; lastSavedAt: number | null; revisionProtocol?: 2 };
export class GoogleDriveError extends Error {
  status: number;
  constructor(message: string, status = 0) { super(message); this.status = status; }
}
const fields = 'id,name,version,mimeType,size,trashed,modifiedTime,capabilities(canEdit)';

export function validateDriveFile(value: unknown): DriveFile {
  const file = value as Partial<DriveFile> | null;
  if (!file || typeof file.id !== 'string' || !file.id || typeof file.name !== 'string' || typeof file.version !== 'string' || !/^\d+$/.test(file.version)) throw new GoogleDriveError('Google Drive returned incomplete file metadata. Try again.');
  if (file.trashed) throw new GoogleDriveError('The Google Drive file is in the trash. Restore it or unlink it.');
  if (!/\.(md|markdown)$/i.test(file.name) || !['text/markdown', 'text/plain', 'application/octet-stream'].includes(file.mimeType ?? '')) throw new GoogleDriveError('Choose a plain-text Planner.md file, rather than a Google document or folder.');
  if (file.capabilities?.canEdit === false) throw new GoogleDriveError('You do not have permission to edit this Google Drive file.');
  if (file.size !== undefined) { const size = Number(file.size); if (!Number.isFinite(size) || size < 0) throw new GoogleDriveError('Google Drive returned an invalid file size.'); assertImportSize(size); }
  return file as DriveFile;
}
async function readText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let size = 0, text = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMPORT_BYTES) { await reader.cancel(); assertImportSize(size); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode(); assertImportText(text); return text;
  } finally { reader.releaseLock(); }
}

export function createDriveApi(session: GoogleSession, fetcher: typeof fetch = globalThis.fetch, revisionCache = new Map<string, { version: string; record: Revision }>()) {
  const request = async (url: string, init: RequestInit = {}) => {
    if (session.expiresAt <= Date.now() + 30_000) throw new GoogleDriveError('Google Drive sign-in expired. Reconnect to continue saving.', 401);
    const headers = new Headers(init.headers); headers.set('Authorization', `Bearer ${session.accessToken}`);
    const response = await fetcher(url, { ...init, headers, credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(20_000) });
    if (!response.ok) {
      const message = response.status === 401 ? 'Google Drive sign-in expired. Reconnect to continue saving.'
        : response.status === 403 ? 'Google Drive denied access. Check that its API is enabled and this account can edit the selected file.'
        : response.status === 404 ? 'The Google Drive file is unavailable. Check its access or unlink it.'
        : response.status === 412 ? 'The Google Drive file changed before this save. Review it before saving again.'
        : response.status === 429 ? 'Google Drive is rate limiting requests. Wait a moment, then resume saving.'
        : `Google Drive request failed (${response.status}). Your browser journal is still available.`;
      throw new GoogleDriveError(message, response.status);
    }
    return response;
  };
  const metadata = async (id: string) => {
    const response = await request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=${encodeURIComponent(fields)}`);
    const file = validateDriveFile(await response.json());
    if (file.id !== id) throw new GoogleDriveError('Google Drive returned a different file. Select it again.');
    const etag = response.headers.get('ETag');
    return { file, etag: etag?.startsWith('"') && etag.endsWith('"') ? etag : null };
  };
  const read = async (id: string): Promise<DriveSnapshot> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await metadata(id);
      const response = await request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`);
      const text = await readText(response);
      const after = await metadata(id);
      if (before.file.version === after.file.version) return { ...after, text };
    }
    throw new GoogleDriveError('The Google Drive file kept changing while it was being read. Try again.');
  };
  const save = async (link: DriveLink, text: string): Promise<{ kind: 'saved' | 'unchanged' | 'changed'; snapshot: DriveSnapshot }> => {
    assertImportText(text);
    const remote = await read(link.fileId);
    if (remote.text === text) return { kind: 'unchanged', snapshot: remote };
    if (remote.file.version !== link.version || remote.text !== link.baselineText) return { kind: 'changed', snapshot: remote };
    const headers = new Headers({ 'Content-Type': 'text/plain;charset=utf-8' });
    if (remote.etag) headers.set('If-Match', remote.etag);
    const response = await request(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(link.fileId)}?uploadType=media&fields=${encodeURIComponent(fields)}`, { method: 'PATCH', headers, body: text });
    const file = validateDriveFile(await response.json());
    if (file.id !== link.fileId) throw new GoogleDriveError('Google Drive returned a different file after saving. Review the file before continuing.');
    return { kind: 'saved', snapshot: { file, text, etag: null } };
  };
  const create = async (text: string): Promise<DriveSnapshot> => {
    assertImportText(text);
    const boundary = 'hcb-' + crypto.randomUUID();
    const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`, JSON.stringify({ name: 'Planner.md', mimeType: 'text/markdown', description: 'Hot Cross Buns single-file Markdown planner' }), `\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n`, text, `\r\n--${boundary}--\r\n`], { type: `multipart/related; boundary=${boundary}` });
    const response = await request(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=${encodeURIComponent(fields)}`, { method: 'POST', body });
    return { file: validateDriveFile(await response.json()), text, etag: null };
  };
  const list = async (): Promise<DriveFile[]> => {
    const query = new URLSearchParams({ q: "trashed = false and mimeType = 'text/plain'", pageSize: '20', orderBy: 'modifiedTime desc', fields: `files(${fields})` });
    const response = await request('https://www.googleapis.com/drive/v3/files?' + query);
    const data = await response.json() as { files?: unknown[] };
    if (!Array.isArray(data.files)) throw new GoogleDriveError('Google Drive returned an invalid file list.');
    return data.files.filter(value => {
      const file = value as Partial<DriveFile> | null;
      return file?.capabilities?.canEdit !== false && !(file?.size && Number(file.size) > MAX_IMPORT_BYTES);
    }).map(validateDriveFile);
  };
  const readRevision = async (id: string, journal: string) => {
    const response = await request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`);
    const reader = response.body?.getReader(); if (!reader) throw new MissingHistoryError('A Drive revision body is unavailable. Try again after its transfer finishes.');
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }); let raw = '', size = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_REVISION_BYTES) { await reader.cancel(); throw new GoogleDriveError('The Drive revision exceeds the size limit.'); } raw += decoder.decode(value, { stream: true }); } raw += decoder.decode(); }
    finally { reader.releaseLock(); }
    return parseRevision(raw, journal);
  };
  const revisions = (fileId: string, device: () => Promise<string>): RevisionTransport => {
    if (!/^[\w-]{1,100}$/.test(fileId)) throw new GoogleDriveError('The Drive journal identity is invalid.');
    const journal = 'drive:' + fileId;
    return { journal, device,
      reserve: async () => {
        const response = await request('https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive&type=files');
        const result = await response.json() as { ids?: string[] };
        if (!Array.isArray(result.ids) || result.ids.length !== 1 || typeof result.ids[0] !== 'string' || !/^[\w-]+$/.test(result.ids[0])) throw new GoogleDriveError('Drive did not reserve a revision identity.');
        return result.ids[0];
      },
      list: async () => {
        const records: Revision[] = [], seen = new Set<string>(), pages = new Set<string>(); let pageToken = '', bytes = 0, actualBytes = 0;
        do {
          if (pages.has(pageToken)) throw new MissingHistoryError('Drive repeated a history page. Waiting for a complete listing.'); pages.add(pageToken);
          const query = new URLSearchParams({ q: `trashed = false and appProperties has { key='hcbJournal' and value='${fileId}' }`, pageSize: '100', fields: 'nextPageToken,incompleteSearch,files(id,version,size,appProperties)', ...(pageToken ? { pageToken } : {}) });
          const response = await request('https://www.googleapis.com/drive/v3/files?' + query);
          const page = await response.json() as { files?: Array<{ id: string; version: string; size: string; appProperties: Record<string, string> }>; nextPageToken?: string; incompleteSearch?: boolean };
          if (page.incompleteSearch || !Array.isArray(page.files) || page.nextPageToken !== undefined && (typeof page.nextPageToken !== 'string' || !page.nextPageToken)) throw new MissingHistoryError('Drive returned incomplete history. Waiting for a complete listing.');
          for (const file of page.files) {
            if (!file || typeof file.id !== 'string' || !file.id || typeof file.version !== 'string' || !/^\d+$/.test(file.version) || file.appProperties?.hcbJournal !== fileId || typeof file.size !== 'string' || !/^\d+$/.test(file.size) || !Number.isSafeInteger(Number(file.size))) throw new GoogleDriveError('Drive returned invalid revision metadata.');
            if (seen.has(file.id)) continue; seen.add(file.id); bytes += Number(file.size);
            if (seen.size > MAX_REVISIONS || bytes > MAX_HISTORY_BYTES || Number(file.size) > MAX_REVISION_BYTES) throw new GoogleDriveError('Drive history reached its 1,000 revision / 64 MiB limit. Export and archive the history before starting a new journal file. No history was deleted.');
            const cached = revisionCache.get(file.id);
            const record = cached?.version === file.version ? cached.record : await readRevision(file.id, journal);
            if (record.id !== file.appProperties.hcbRevision || record.digest !== file.appProperties.hcbDigest) throw new GoogleDriveError('Drive revision metadata does not match its verified contents.');
            actualBytes += utf8Size(revisionText(record)); if (actualBytes > MAX_HISTORY_BYTES) throw new GoogleDriveError('Drive history exceeds the 64 MiB read budget. File saving is paused.');
            revisionCache.set(file.id, { version: file.version, record }); records.push(record);
          }
          pageToken = page.nextPageToken ?? '';
          if (pages.size > MAX_REVISIONS) throw new MissingHistoryError('Drive history pagination exceeded its work budget.');
        } while (pageToken);
        return records;
      },
      put: async (record, transportId) => {
        if (!transportId) throw new GoogleDriveError('The revision identity was not saved before dispatch.');
        const boundary = 'hcb-' + crypto.randomUUID(), raw = revisionText(record);
        await parseRevision(raw, journal);
        const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`, JSON.stringify({ id: transportId, name: `HCB-${fileId}-${record.id}.json`, mimeType: 'application/json', appProperties: { hcbJournal: fileId, hcbRevision: record.id, hcbDigest: record.digest } }), `\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`, raw, `\r\n--${boundary}--\r\n`], { type: `multipart/related; boundary=${boundary}` });
        try { await request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', body }); }
        catch (error) { if (!(error instanceof GoogleDriveError && error.status === 409)) throw error; }
        const verified = await readRevision(transportId, journal);
        if (verified.id !== record.id || verified.digest !== record.digest) throw new GoogleDriveError('The saved Drive revision does not match its pending submission. Planner.md was not written.');
      },
    };
  };
  return { metadata, read, save, create, list, revisions };
}
