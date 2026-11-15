import { assertImportSize, assertImportText, MAX_IMPORT_BYTES } from './importLimits.ts';
import type { TodoDocument } from './todoText.ts';

export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export type GoogleSession = { accessToken: string; expiresAt: number; accountId: string; email: string };
export type DriveFile = { id: string; name: string; version: string; mimeType: string; size?: string; trashed?: boolean; modifiedTime?: string; capabilities?: { canEdit?: boolean } };
export type DriveSnapshot = { file: DriveFile; text: string; etag: string | null };
export type DriveLink = { id: string; fileId: string; fileName: string; accountId: string; email: string; baselineText: string; baselineDocument: TodoDocument; version: string; needsReview: boolean; lastSavedAt: number | null };
export class GoogleDriveError extends Error {
  status: number;
  constructor(message: string, status = 0) { super(message); this.status = status; }
}
const fields = 'id,name,version,mimeType,size,trashed,modifiedTime,capabilities(canEdit)';

export function validateDriveFile(value: unknown): DriveFile {
  const file = value as Partial<DriveFile> | null;
  if (!file || typeof file.id !== 'string' || !file.id || typeof file.name !== 'string' || typeof file.version !== 'string' || !/^\d+$/.test(file.version)) throw new GoogleDriveError('Google Drive returned incomplete file metadata. Try again.');
  if (file.trashed) throw new GoogleDriveError('The Google Drive file is in the trash. Restore it or unlink it.');
  if (file.mimeType !== 'text/plain' && !(file.mimeType === 'application/octet-stream' && /\.txt$/i.test(file.name))) throw new GoogleDriveError('Choose a plain-text TODO.txt file, rather than a Google document or folder.');
  if (file.capabilities?.canEdit === false) throw new GoogleDriveError('You do not have permission to edit this Google Drive file.');
  if (file.size !== undefined) { const size = Number(file.size); if (!Number.isFinite(size) || size < 0) throw new GoogleDriveError('Google Drive returned an invalid file size.'); assertImportSize(size); }
  return file as DriveFile;
}
async function readText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder('utf-8', { fatal: true });
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

export function createDriveApi(session: GoogleSession, fetcher: typeof fetch = globalThis.fetch) {
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
    const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`, JSON.stringify({ name: 'TODO.txt', mimeType: 'text/plain', description: 'Hot Cross Buns plain-text journal' }), `\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n`, text, `\r\n--${boundary}--\r\n`], { type: `multipart/related; boundary=${boundary}` });
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
  return { metadata, read, save, create, list };
}
