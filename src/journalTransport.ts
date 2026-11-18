import type { MarkdownPlanner, SourcePatch } from './markdownPlanner.ts';

export type JournalDelta = { baselineId: number; patches: readonly SourcePatch[] };
export const MAX_DELTA_PATCHES = 256;
export const MAX_DELTA_CHARACTERS = 65_536;

export function boundedJournalPatches(value: unknown): value is readonly SourcePatch[] {
  if (!Array.isArray(value) || value.length > MAX_DELTA_PATCHES) return false;
  let end = 0, characters = 0;
  for (const patch of value) {
    if (!patch || !patch.range || !Number.isSafeInteger(patch.range.start) || !Number.isSafeInteger(patch.range.end)
      || patch.range.start < end || patch.range.end <= patch.range.start
      || typeof patch.expected !== 'string' || typeof patch.text !== 'string'
      || patch.expected.length !== patch.range.end - patch.range.start || patch.text.length !== patch.expected.length) return false;
    end = patch.range.end;
    characters += patch.expected.length + patch.text.length;
    if (characters > MAX_DELTA_CHARACTERS) return false;
  }
  return true;
}

/** replay against an immutable, session-local baseline; the validator checks every changed token. */
export function replayJournalDelta(base: MarkdownPlanner, value: unknown, validate: (model: MarkdownPlanner, source: string) => MarkdownPlanner | null): MarkdownPlanner | null {
  if (!boundedJournalPatches(value)) return null;
  let offset = 0;
  const parts: string[] = [];
  const splitsSurrogate = (index: number) => /[\uD800-\uDBFF]/.test(base.source[index - 1] ?? '') && /[\uDC00-\uDFFF]/.test(base.source[index] ?? '');
  for (const patch of value) {
    const { start, end } = patch.range;
    if (end > base.source.length || splitsSurrogate(start) || splitsSurrogate(end) || base.source.slice(start, end) !== patch.expected) return null;
    parts.push(base.source.slice(offset, start), patch.text);
    offset = end;
  }
  parts.push(base.source.slice(offset));
  return validate(base, parts.join(''));
}
