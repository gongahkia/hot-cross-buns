import { assertImportSize, assertImportText } from './importLimits.ts';
import type { TodoDocument } from './todoText.ts';

export type LinkedFileHandle = FileSystemFileHandle & {
  queryPermission: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
};
export type FileLink = {
  id: string; handle: LinkedFileHandle; baselineText: string; baselineDocument: TodoDocument;
  lastSavedAt: number | null; needsReview: boolean;
  historyDirectory?: LinkedDirectoryHandle;
  conflictCopies?: string[];
};
export type LinkedDirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
  values: () => AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>;
};
export type FileSyncStatus = { kind: 'unlinked' | 'saving' | 'saved' | 'permission' | 'changed' | 'error'; name?: string; detail?: string; lastSavedAt?: number | null };
type FilePickers = {
  showOpenFilePicker?: (options: object) => Promise<LinkedFileHandle[]>;
  showSaveFilePicker?: (options: object) => Promise<LinkedFileHandle>;
  showDirectoryPicker?: (options: object) => Promise<LinkedDirectoryHandle>;
};
const pickers = () => window as Window & FilePickers;
export const MAX_FOLDER_ENTRIES = 2000;
export const supportsLinkedFiles = () => window.isSecureContext && !!pickers().showOpenFilePicker && !!pickers().showSaveFilePicker && !!navigator.locks;
export const fileSyncLock = 'hot-cross-buns-linked-file';
export const supportsSyncFolders = () => supportsLinkedFiles() && !!pickers().showDirectoryPicker;
export async function pickSyncFolder(): Promise<LinkedDirectoryHandle> {
  const directory = await pickers().showDirectoryPicker!({ mode: 'readwrite', id: 'hot-cross-buns-journal' });
  if (await directory.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('Allow access to the journal folder and its history files.');
  return directory;
}
const pickerTypes = [{ description: 'Hot Cross Buns journal', accept: { 'text/markdown': ['.md', '.markdown'] } }];

export async function pickLinkedFile(create: boolean): Promise<LinkedFileHandle> {
  const handle = create
    ? await pickers().showSaveFilePicker!({ suggestedName: 'Planner.md', types: pickerTypes })
    : (await pickers().showOpenFilePicker!({ multiple: false, types: pickerTypes }))[0];
  if (await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('Allow read and write access to link this file.');
  return handle;
}
export async function readLinkedText(handle: LinkedFileHandle): Promise<string> {
  const file = await handle.getFile();
  assertImportSize(file.size);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
  assertImportText(text);
  return text;
}

export type LinkedFileSnapshot = { text: string; handle: LinkedFileHandle; conflictCopies: string[] };
export function isJournalConflictCopy(name: string, journalName: string): boolean {
  const dot = journalName.lastIndexOf('.'), stem = (dot > 0 ? journalName.slice(0, dot) : journalName).toLowerCase(), extension = dot > 0 ? journalName.slice(dot).toLowerCase() : '';
  const candidate = name.toLowerCase();
  if (!candidate.startsWith(stem) || !candidate.endsWith(extension)) return false;
  const suffix = candidate.slice(stem.length, extension ? -extension.length : undefined);
  return /^ \(.*conflicted copy.*\)$/.test(suffix) || /^\.sync-conflict-[\w-]+$/.test(suffix);
}
export async function resolveLinkedFile(link: Pick<FileLink, 'handle' | 'historyDirectory'>): Promise<LinkedFileHandle> {
  if (!link.historyDirectory) return link.handle;
  const handle = await link.historyDirectory.getFileHandle(link.handle.name) as LinkedFileHandle;
  if (handle.name !== link.handle.name) throw new Error('The linked journal filename changed. Keep its exact original name and companion history, or explicitly link a new target.');
  return handle;
}
export async function readLinkedFile(link: Pick<FileLink, 'handle' | 'historyDirectory'>): Promise<LinkedFileSnapshot> {
  const handle = await resolveLinkedFile(link);
  const text = await readLinkedText(handle), conflictCopies: string[] = [];
  if (link.historyDirectory) {
    let entries = 0;
    for await (const entry of link.historyDirectory.values()) {
      if (++entries > MAX_FOLDER_ENTRIES) throw new Error('The sync folder reached its 2,000-entry scan limit. Use a dedicated journal folder and keep its complete history. No files were removed.');
      if (entry.kind === 'file' && isJournalConflictCopy(entry.name, handle.name)) conflictCopies.push(entry.name);
    }
  }
  return { text, handle, conflictCopies: conflictCopies.sort() };
}
export function classifyLinkedFileError(error: unknown): 'permission' | 'retrying' | 'error' {
  if (!(error instanceof DOMException)) return 'error';
  if (['NotAllowedError', 'SecurityError'].includes(error.name)) return 'permission';
  return ['NotFoundError', 'NotReadableError', 'NoModificationAllowedError', 'AbortError', 'InvalidStateError', 'TimeoutError'].includes(error.name) ? 'retrying' : 'error';
}

export async function saveLinkedText(link: FileLink, text: string): Promise<'saved' | 'unchanged' | 'changed' | 'permission'> {
  if (await (link.historyDirectory ?? link.handle).queryPermission({ mode: 'readwrite' }) !== 'granted') return 'permission';
  assertImportText(text);
  const handle = await resolveLinkedFile(link);
  const matches = async () => {
    const current = await resolveLinkedFile(link);
    return (!link.historyDirectory || await current.isSameEntry(handle)) && await readLinkedText(current) === link.baselineText;
  };
  if (!await matches()) return 'changed';
  if (text === link.baselineText) return 'unchanged';
  // writes are staged until close; check again on both sides of the write before committing.
  const writable = await handle.createWritable({ mode: 'exclusive' } as FileSystemCreateWritableOptions);
  try {
    if (!await matches()) { await writable.abort(); return 'changed'; }
    await writable.write(text);
    if (!await matches()) { await writable.abort(); return 'changed'; }
    await writable.close();
    return 'saved';
  } catch (error) {
    try { await writable.abort(); } catch { /* close or a failed stream may already release the staging file. */ }
    throw error;
  }
}
