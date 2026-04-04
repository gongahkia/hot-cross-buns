import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

function todayStamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function pickSavePath(
  defaultFileName: string,
  extensions: string[],
  filterName: string
): Promise<string | null> {
  const result = await save({
    title: `Save ${filterName}`,
    defaultPath: defaultFileName,
    filters: [{ name: filterName, extensions }],
  });

  return typeof result === 'string' ? result : null;
}

export async function exportJsonBackup(): Promise<string | null> {
  const target = await pickSavePath(
    `hotcrossbuns-backup-${todayStamp()}.json`,
    ['json'],
    'JSON Backup'
  );

  if (!target) {
    return null;
  }

  const payload = await invoke<string>('export_data');
  await writeTextFile(target, payload);
  return target;
}

export async function exportCsvBackup(): Promise<string | null> {
  const target = await pickSavePath(
    `hotcrossbuns-tasks-${todayStamp()}.csv`,
    ['csv'],
    'CSV Export'
  );

  if (!target) {
    return null;
  }

  const payload = await invoke<string>('export_csv');
  await writeTextFile(target, payload);
  return target;
}

export async function chooseImportJsonPayload(): Promise<string | null> {
  const source = await open({
    title: 'Import JSON Backup',
    filters: [{ name: 'JSON Backup', extensions: ['json'] }],
    multiple: false,
  });

  if (typeof source !== 'string') {
    return null;
  }

  return readTextFile(source);
}
