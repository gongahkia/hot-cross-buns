export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_LINES = 100_000;

export function assertImportSize(bytes: number): void {
  if (bytes > MAX_IMPORT_BYTES) throw new Error('Planner.md imports are limited to 5 MiB. Split the file into smaller journals before importing.');
}

export function assertImportText(raw: string): void {
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(raw)) throw new Error('Journal text must be valid Unicode before UTF-8 storage.');
  assertImportSize(raw.length);
  assertImportSize(new TextEncoder().encode(raw).byteLength);
  let lines = raw.length ? 1 : 0;
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index];
    if (char !== '\n' && char !== '\r') continue;
    if (char === '\r' && raw[index + 1] === '\n') index++;
    if (index < raw.length - 1 && ++lines > MAX_IMPORT_LINES) {
      throw new Error('Planner.md imports are limited to 100,000 lines. Split the file into smaller journals before importing.');
    }
  }
}
