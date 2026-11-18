import { readJournal } from './journalDocument.ts';
import { editMarkdownPassage } from './markdownPassage.ts';
import { applyPlannerEdits, plannerEntries, plannerWritable, type MarkdownPlanner, type PlannerGroup, type SourcePatch, type SourceRange } from './markdownPlanner.ts';
import type { MarkdownLinkPreparation } from './markdownNavigation.ts';
import { validDate } from './todoText.ts';

export type WritingDestination = { kind: 'dated'; date: string } | { kind: 'undated'; list: string };
export type WritingLocation = WritingDestination | { kind: 'scratchpad' };
export type WritingBlock = { type: 'entry' | 'markdown'; range: SourceRange; entryId?: string };
export type WritingCapture = { start: number; end: number; selected: string; destination: WritingDestination; cut: boolean };
export type WritingOperation = { kind: 'fragment'; location: WritingLocation; range: SourceRange; markdown: string; links?: MarkdownLinkPreparation[] } | { kind: 'append'; destination: WritingDestination; markdown: string } | { kind: 'capture'; capture: WritingCapture };
const nlOf = (source: string) => /\r\n|\r|\n/.exec(source)?.[0] ?? '\n';

function assertWriting(model: MarkdownPlanner): void {
  if (!plannerWritable(model)) throw new Error('Correct the Markdown source before editing this document.');
  if (model.format !== 3) throw new Error('Enable unified writing before editing this document. The original source has been kept.');
}

export function writingGroup(model: MarkdownPlanner, location: WritingDestination): PlannerGroup | undefined {
  return location.kind === 'dated' ? model.days.find(group => group.name === location.date) : model.undated.find(group => group.name === location.list);
}

export function writingRange(model: MarkdownPlanner, location: WritingLocation): SourceRange | undefined {
  return location.kind === 'scratchpad' ? model.scratchpad : writingGroup(model, location)?.content;
}

/** entries and ordinary blocks retain their source order; no view-only reserialization. */
export function writingBlocks(model: MarkdownPlanner, location: WritingLocation): WritingBlock[] {
  const range = writingRange(model, location);
  if (!range) return [];
  const entries = location.kind === 'scratchpad' ? [] : writingGroup(model, location)?.entries ?? [];
  const blocks: WritingBlock[] = [];
  let index = 0;
  for (const passage of model.markdown.passages) {
    if (passage.range.start < range.start || passage.range.end > range.end) continue;
    if (['definition', 'footnoteDefinition'].includes(passage.type)) continue;
    while (entries[index] && entries[index].range.start < passage.range.start) index++;
    if (passage.type === 'list' && entries[index] && entries[index].range.start < passage.range.end) {
      while (entries[index] && entries[index].range.start < passage.range.end) {
        const entry = entries[index++];
        blocks.push({ type: 'entry', range: entry.range, entryId: entry.id ?? `source:${entry.range.start}` });
      }
    } else blocks.push({ type: 'markdown', range: passage.range });
  }
  return blocks;
}

const groupNames = (model: MarkdownPlanner) => [model.days.map(group => group.name), model.undated.map(group => group.name)];

function assertGroups(before: MarkdownPlanner, after: MarkdownPlanner, addition?: WritingDestination): void {
  const expected = groupNames(before);
  if (addition && !writingGroup(before, addition)) expected[addition.kind === 'dated' ? 0 : 1].push(addition.kind === 'dated' ? addition.date : addition.list);
  if (JSON.stringify(expected) !== JSON.stringify(groupNames(after))) throw new Error('This Markdown would change document boundaries. Keep the draft and use date or list controls to organize it.');
}

function assertUnchangedEntries(before: MarkdownPlanner, after: MarkdownPlanner, patches: SourcePatch[]): void {
  const candidates = new Map(plannerEntries(after).map(entry => [entry.range.start, entry]));
  for (const entry of plannerEntries(before)) {
    if (patches.some(patch => patch.range.start < entry.range.end && patch.range.end > entry.range.start)) continue;
    const shift = patches.reduce((sum, patch) => sum + (patch.range.end <= entry.range.start ? patch.text.length - patch.expected.length : 0), 0);
    const candidate = candidates.get(entry.range.start + shift);
    if (!candidate || candidate.date !== entry.date || candidate.list !== entry.list || candidate.range.end !== entry.range.end + shift || after.source.slice(candidate.range.start, candidate.range.end) !== before.source.slice(entry.range.start, entry.range.end)) throw new Error('This edit would change content outside the selected block. Keep the draft and review its indentation or document boundaries.');
  }
}

export function editWritingFragment(source: string, location: WritingLocation, range: SourceRange, markdown: string, links: MarkdownLinkPreparation[] = []): MarkdownPlanner {
  const before = readJournal(source).model;
  assertWriting(before);
  const owner = writingRange(before, location);
  if (!owner || range.start < owner.start || range.end > owner.end) throw new Error('This block is outside the current document. Keep the draft and reopen its document.');
  const after = editMarkdownPassage(source, range, markdown, links);
  assertGroups(before, after);
  return after;
}

function insertion(model: MarkdownPlanner, location: WritingDestination, markdown: string): SourcePatch {
  if (!markdown.trim()) throw new Error('Write some content before adding it to a document.');
  const name = location.kind === 'dated' ? location.date : location.list;
  if (location.kind === 'dated' ? !validDate(name) : !name.trim() || name !== name.trim() || /[\r\n]/.test(name)) throw new Error('Choose a valid date or a nonempty list name on one line.');
  const group = writingGroup(model, location), nl = nlOf(model.source);
  const offset = group?.content.end ?? model.sectionEnds[location.kind === 'dated' ? 'Dated' : 'Undated'];
  if (offset === undefined) throw new Error('This document section is unavailable. Keep the original source for recovery.');
  const pad = (text: string) => text.endsWith(nl + nl) ? '' : text.endsWith(nl) ? nl : nl + nl;
  const heading = group ? '' : `### ${name.replace(/[\\`*_{}[\]()<>!|~#]/g, '\\$&')}${nl}${nl}`;
  return { range: { start: offset, end: offset }, expected: '', text: pad(model.source.slice(Math.max(0, offset - nl.length * 2), offset)) + heading + markdown + pad(markdown) };
}

export function appendWritingMarkdown(source: string, destination: WritingDestination, markdown: string): MarkdownPlanner {
  const before = readJournal(source).model;
  assertWriting(before);
  const patch = insertion(before, destination, markdown);
  const after = applyPlannerEdits(before, source, [patch]);
  assertGroups(before, after, destination);
  assertUnchangedEntries(before, after, [patch]);
  return after;
}

/** capture removal and destination insertion share one validated source transaction. */
export function transferWritingCapture(source: string, capture: WritingCapture): MarkdownPlanner {
  const before = readJournal(source).model;
  assertWriting(before);
  const scratchpad = before.scratchpad;
  if (!scratchpad || !Number.isSafeInteger(capture.start) || !Number.isSafeInteger(capture.end) || capture.start < 0 || capture.end <= capture.start || capture.end > scratchpad.end - scratchpad.start || source.slice(scratchpad.start + capture.start, scratchpad.start + capture.end) !== capture.selected) throw new Error('The scratchpad selection changed. Select the content again; the original has been kept.');
  const patches = [insertion(before, capture.destination, capture.selected)];
  if (capture.cut) patches.push({ range: { start: scratchpad.start + capture.start, end: scratchpad.start + capture.end }, expected: capture.selected, text: '' });
  const after = applyPlannerEdits(before, source, patches);
  assertGroups(before, after, capture.destination);
  assertUnchangedEntries(before, after, patches);
  return after;
}

export function runWritingOperation(source: string, operation: WritingOperation): MarkdownPlanner {
  if (operation.kind === 'fragment') return editWritingFragment(source, operation.location, operation.range, operation.markdown, operation.links);
  if (operation.kind === 'append') return appendWritingMarkdown(source, operation.destination, operation.markdown);
  return transferWritingCapture(source, operation.capture);
}
