import { journalModel, materializeJournal, readJournal } from './journalDocument.ts';
import { applyPlannerEdits, plannerEntries, type SourceRange } from './markdownPlanner.ts';
import { assertPassageOwnership, prepareMarkdownLinks, type MarkdownLinkPreparation } from './markdownNavigation.ts';

export function editMarkdownPassage(source: string, range: SourceRange, markdown: string, links: MarkdownLinkPreparation[] = []) {
  const before = readJournal(source);
  let prepared = before.model, shift = 0;
  if (links.length) {
    const document = structuredClone(before.document);
    prepareMarkdownLinks(document, source, links);
    prepared = journalModel(materializeJournal(document));
    const original = new Map(plannerEntries(before.model).map(entry => [`entry:${entry.id ?? `source:${entry.range.start}`}`, entry]));
    const updated = new Map(plannerEntries(prepared).filter(entry => entry.id).map(entry => [entry.id!, entry]));
    const seen = new Set<string>();
    for (const link of links) {
      if (seen.has(link.entryRef)) continue;
      seen.add(link.entryRef);
      const entry = original.get(link.entryRef)!, next = updated.get(link.id)!;
      if (entry.range.start < range.end && entry.range.end > range.start) throw new Error('Save the target entry first before linking to it from its enclosing source list. Your draft has been kept.');
      if (entry.range.end <= range.start) shift += next.range.end - next.range.start - (entry.range.end - entry.range.start);
    }
  }
  const adjusted = { start: range.start + shift, end: range.end + shift };
  const expected = source.slice(range.start, range.end);
  if (prepared.source.slice(adjusted.start, adjusted.end) !== expected) throw new Error('The passage changed while its link identities were prepared. Keep the draft and review the source.');
  const after = applyPlannerEdits(prepared, prepared.source, [{ range: adjusted, expected, text: markdown }]);
  assertPassageOwnership(prepared, after, adjusted);
  return after;
}
