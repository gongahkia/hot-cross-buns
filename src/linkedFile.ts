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
export const supportsLinkedFiles = () => window.isSecureContext && !!pickers().showOpenFilePicker && !!pickers().showSaveFilePicker && !!navigator.locks;
export const fileSyncLock = 'hot-cross-buns-linked-file';
export const supportsSyncFolders = () => supportsLinkedFiles() && !!pickers().showDirectoryPicker;
export async function pickSyncFolder(): Promise<LinkedDirectoryHandle> {
  const directory = await pickers().showDirectoryPicker!({ mode: 'readwrite', id: 'hot-cross-buns-journal' });
  if (await directory.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('Allow access to the journal folder and its history files.');
  return directory;
}
const pickerTypes = [{ description: 'Hot Cross Buns journal', accept: { 'text/plain': ['.txt'] } }];

export async function pickLinkedFile(create: boolean): Promise<LinkedFileHandle> {
  const handle = create
    ? await pickers().showSaveFilePicker!({ suggestedName: 'TODO.txt', types: pickerTypes })
    : (await pickers().showOpenFilePicker!({ multiple: false, types: pickerTypes }))[0];
  if (await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('Allow read and write access to link this file.');
  return handle;
}
export async function readLinkedText(handle: LinkedFileHandle): Promise<string> {
  const file = await handle.getFile();
  assertImportSize(file.size);
  const text = await file.text();
  assertImportText(text);
  return text;
}

export async function saveLinkedText(link: FileLink, text: string): Promise<'saved' | 'unchanged' | 'changed' | 'permission'> {
  if (await link.handle.queryPermission({ mode: 'readwrite' }) !== 'granted') return 'permission';
  assertImportText(text);
  if (await readLinkedText(link.handle) !== link.baselineText) return 'changed';
  if (text === link.baselineText) return 'unchanged';
  // writes are staged until close; check again on both sides of the write before committing.
  const writable = await link.handle.createWritable({ mode: 'exclusive' } as FileSystemCreateWritableOptions);
  try {
    if (await readLinkedText(link.handle) !== link.baselineText) { await writable.abort(); return 'changed'; }
    await writable.write(text);
    if (await readLinkedText(link.handle) !== link.baselineText) { await writable.abort(); return 'changed'; }
    await writable.close();
    return 'saved';
  } catch (error) {
    try { await writable.abort(); } catch { /* close or a failed stream may already release the staging file. */ }
    throw error;
  }
}
