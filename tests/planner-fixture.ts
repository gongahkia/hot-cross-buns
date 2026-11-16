// test-only semantic mapping: runtime imports accept Markdown exclusively.
import { parseTodoText as parseLegacy, type ParseResult } from '../src/todoText.ts';
import { createJournal, journalFromModel, parseJournal, serializeJournal } from '../src/journalDocument.ts';
import { assertImportText } from '../src/importLimits.ts';

const cache = new Map<string,string>();
export function plannerFixture(raw: string, today?: string): string;
export function plannerFixture<T>(raw: T, today?: string): T;
export function plannerFixture(raw: unknown, today = '2026-11-15'): unknown {
  if (typeof raw !== 'string') return raw;
  if (!raw || /^\uFEFF?---[\r\n]/.test(raw)) return raw;
  try { assertImportText(raw); } catch { return raw; }
  const key = today + '\0' + raw, cached = cache.get(key);
  if (cached !== undefined) return cached;
  const parsed = parseLegacy(raw,today);
  if (parsed.issues.length) return raw;
  let index = 0;
  for (const group of [...parsed.document.days,...parsed.document.undated ?? []]) for (const item of group.items) item.id = `fixture-${index++}`;
  const source = journalFromModel(parsed.document,'','test-journal').source!;
  cache.set(key,source);
  if (cache.size > 8) cache.delete(cache.keys().next().value!);
  return source;
}
export function parseTodoText(raw: string, today?: string): ParseResult {
  const parsed = raw ? parseJournal(plannerFixture(raw,today)) : { document: createJournal('test-journal'), issues: [] };
  return { ...parsed, document: structuredClone(parsed.document) };
}
export const serializeTodoText = serializeJournal;
