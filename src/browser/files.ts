/** Must be called directly from the click handler, before awaiting worker work. */
export function pickFile(accept = '.sqlite,.db,application/vnd.sqlite3'): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept;
    input.style.display = 'none';
    document.body.append(input);
    const finish = (file?: File) => { input.remove(); resolve(file); };
    input.addEventListener('change', () => finish(input.files?.[0]), { once: true });
    input.addEventListener('cancel', () => finish(), { once: true });
    input.click();
  });
}

export function downloadFile(bytes: BlobPart, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
  // Revoking during the click can cancel downloads in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function browserStorageInfo() {
  const estimate = await navigator.storage?.estimate?.();
  return { available: Boolean(navigator.storage), usage: estimate?.usage ?? null, quota: estimate?.quota ?? null,
    persisted: await navigator.storage?.persisted?.() ?? false };
}
