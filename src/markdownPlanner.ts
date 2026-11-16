import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import type { Node } from 'unist';
import type { Code, ListItem } from 'mdast';
import { parseRecurrence, type RecurrenceRule } from './recurrence.ts';
import { parseSpan, validDate, type TodoReplacement, type TodoSpan } from './todoText.ts';
import { parseTimeBlock } from './timeBlock.ts';
import { MAX_IMPORT_BYTES, MAX_IMPORT_LINES } from './importLimits.ts';

export type SourceRange = { start: number; end: number };
export type PlannerIssue = { code: string; message: string; range: SourceRange; severity: 'error' | 'warning' };
export type PlannerDetail = {
  range: SourceRange; titleRange: SourceRange; markdown: string; text: string;
  completed: boolean; checkbox?: SourceRange;
};
export type PlannerEntry = PlannerDetail & {
  id?: string; date?: string; list?: string; details: PlannerDetail[];
  metadata?: SourceRange; indent: string;
  timeBlock?: { start: string; end: string };
  repeat?: RecurrenceRule; completedOn?: string; span?: TodoSpan;
  skips?: string[]; replaces?: TodoReplacement;
};
export type PlannerGroup = { name: string; range: SourceRange; entries: PlannerEntry[] };
export type MarkdownPlanner = {
  source: string; documentId?: string; format?: number; issues: PlannerIssue[];
  days: PlannerGroup[]; undated: PlannerGroup[]; scratchpad?: SourceRange;
};
export type SourcePatch = { range: SourceRange; expected: string; text: string };

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter);
const identity = /^[a-z0-9][a-z0-9-]{0,79}$/;
const rangeOf = (node: Node): SourceRange => ({ start: node.position!.start.offset!, end: node.position!.end.offset! });
const slice = (source: string, range: SourceRange) => source.slice(range.start, range.end);
const newline = (source: string) => /\r\n|\r|\n/.exec(source)?.[0] ?? '\n';
const childrenOf = (node: Node) => 'children' in node ? (node as Node & { children: Node[] }).children : [];
function plainText(node: Node): string {
  const parts: string[] = [];
  const pending = [node];
  while (pending.length) {
    const child = pending.pop()!;
    if ('value' in child) parts.push(String(child.value));
    else if ('alt' in child) parts.push(String(child.alt ?? ''));
    else if (child.type === 'break') parts.push('\n');
    else {
      const children = childrenOf(child);
      for (let index = children.length - 1; index >= 0; index--) pending.push(children[index]);
    }
  }
  return parts.join('');
}

function assertSize(source: string) {
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(source)) {
    throw new Error('Markdown source must be valid Unicode before UTF-8 storage.');
  }
  if (source.length > MAX_IMPORT_BYTES || new TextEncoder().encode(source).byteLength > MAX_IMPORT_BYTES) {
    throw new Error('Markdown planners are limited to 5 MiB of UTF-8 text.');
  }
  let lines = source.length ? 1 : 0;
  for (let index = 0; index < source.length; index++) {
    if (source[index] !== '\r' && source[index] !== '\n') continue;
    if (source[index] === '\r' && source[index + 1] === '\n') index++;
    if (index < source.length - 1 && ++lines > MAX_IMPORT_LINES) throw new Error('Markdown planners are limited to 100,000 lines.');
  }
}

/** project planning semantics without serializing or normalizing the original Markdown. */
export function parseMarkdownPlanner(source: string): MarkdownPlanner {
  assertSize(source);
  // remark removes a leading BOM before calculating offsets; retain our original-source coordinates.
  const bom = source.startsWith('\uFEFF');
  const root = parser.parse(bom ? source.slice(1) : source);
  if (bom) {
    const pending: Node[] = [root];
    while (pending.length) {
      const node = pending.pop()!;
      if (node.position) {
        node.position.start.offset!++;
        node.position.end.offset!++;
      }
      for (const child of childrenOf(node)) pending.push(child);
    }
  }
  const model: MarkdownPlanner = { source, issues: [], days: [], undated: [] };
  const issue = (code: string, message: string, range: SourceRange, severity: 'error' | 'warning' = 'error') => {
    model.issues.push({ code, message, range, severity });
  };
  const fields = (value: string, range: SourceRange, known: Set<string>) => {
    const result = new Map<string, string>();
    for (const line of value.split(/\r\n|\r|\n/)) {
      if (!line.trim()) continue;
      const match = /^([a-z][a-z0-9-]*): (\S.*)$/.exec(line);
      if (!match) { issue('metadata-syntax', 'Metadata uses unquoted key: value lines, not general YAML.', range); continue; }
      const [, key, raw] = match;
      if (!known.has(key)) issue('unknown-field', `Unsupported planning field: ${key}. Keep the source for a compatible reader.`, range);
      if (result.has(key)) issue('duplicate-field', `Repeated planning field: ${key}.`, range);
      result.set(key, raw.trimEnd());
    }
    return result;
  };
  const header = root.children[0];
  if (header?.type !== 'yaml') issue('missing-header', 'A planner starts with hcb-format and document-id frontmatter.', { start: 0, end: 0 });
  else {
    const values = fields(header.value, rangeOf(header), new Set(['hcb-format', 'document-id']));
    if (values.get('hcb-format') !== '1') issue('format-version', 'Only hcb-format: 1 is supported. Source remains available for recovery.', rangeOf(header));
    else model.format = 1;
    const id = values.get('document-id');
    if (!id || !identity.test(id)) issue('document-id', 'document-id must be 1–80 lowercase letters, digits or hyphens, starting with a letter or digit.', rangeOf(header));
    else model.documentId = id;
  }
  const detail = (item: ListItem): PlannerDetail | undefined => {
    const paragraph = item.children[0];
    if (paragraph?.type !== 'paragraph' || !plainText(paragraph).trim()) {
      issue('missing-title', 'Planner entries and details need a nonempty first paragraph.', rangeOf(item));
      return;
    }
    const range = rangeOf(item);
    const prefix = /^[-+*][ \t]+(?:\[([ xX])\][ \t]+)/.exec(slice(source, range));
    const checkbox = prefix && typeof item.checked === 'boolean'
      ? { start: range.start + prefix[0].indexOf('[') + 1, end: range.start + prefix[0].indexOf('[') + 2 } : undefined;
    if (typeof item.checked === 'boolean' && !checkbox) issue('checkbox-syntax', 'A planning checkbox needs its title on the same first line.', range);
    // task-list parsing can leave the paragraph start before its removed checkbox (e.g. bold first).
    const titleRange = { start: Math.max(rangeOf(paragraph).start, prefix ? range.start + prefix[0].length : 0), end: rangeOf(paragraph).end };
    return { range, titleRange, markdown: slice(source, titleRange),
      text: plainText(paragraph).replace(/\r\n|\r|\n/g, ' '), completed: item.checked === true, ...(checkbox ? { checkbox } : {}) };
  };
  const metadata = (entry: PlannerEntry, code: Code) => {
    entry.metadata = rangeOf(code);
    // CommonMark accepts unclosed fences; planning data must have an actual closing delimiter.
    const raw = slice(source, entry.metadata);
    const opening = /^(`{3,}|~{3,})hcb[ \t]*(?:\r\n|\r|\n)/.exec(raw);
    const last = raw.split(/\r\n|\r|\n/).at(-1)!.trim();
    if (!opening || code.meta || !new RegExp(`^${opening[1][0]}{${opening[1].length},}$`).test(last)) {
      issue('metadata-fence', 'Planning metadata needs a closed hcb fence without extra arguments.', entry.metadata);
    }
    const values = fields(code.value, entry.metadata, new Set(['id', 'repeat', 'span', 'completed', 'skip', 'replaces']));
    const id = values.get('id');
    if (id !== undefined) {
      if (!identity.test(id)) issue('entry-id', 'Entry IDs use the same spelling rules as document-id.', entry.metadata);
      else entry.id = id;
    }
    if (!entry.date && [...values.keys()].some(key => key !== 'id')) {
      issue('undated-metadata', 'Undated entries only use identity metadata; date an entry before scheduling it.', entry.metadata);
      return;
    }
    const repeat = values.get('repeat');
    if (repeat !== undefined) {
      const parsed = parseRecurrence(repeat);
      if (!parsed || !parsed.series || (parsed.kind === 'after' && !parsed.occurrence)) {
        issue('repeat', 'Repeat rules need a valid rule and explicit series; after-completion rules also need an occurrence.', entry.metadata);
      } else entry.repeat = parsed;
    }
    const span = values.get('span');
    if (span !== undefined) {
      const parsed = parseSpan(span, entry.date!);
      if (!parsed || entry.timeBlock) issue('span', 'Span is invalid or conflicts with the title time block.', entry.metadata);
      else entry.span = parsed;
    }
    const completed = values.get('completed');
    if (completed !== undefined) {
      if (!entry.completed || !validDate(completed)) issue('completed', 'A completion date needs a completed entry and YYYY-MM-DD.', entry.metadata);
      else entry.completedOn = completed;
    }
    const skips = values.get('skip');
    if (skips !== undefined) {
      const dates = skips.split(', ');
      if (dates.some(date => !validDate(date)) || new Set(dates).size !== dates.length || !entry.repeat || entry.repeat.kind === 'after') {
        issue('skip', 'skip is a unique comma-space-separated date collection on a scheduled series.', entry.metadata);
      } else entry.skips = dates;
    }
    const replaces = values.get('replaces');
    if (replaces !== undefined) {
      const match = /^([a-z0-9][a-z0-9-]{0,79}) on (\d{4}-\d{2}-\d{2})$/.exec(replaces);
      if (!match || !validDate(match[2]) || entry.repeat) issue('replaces', 'A replacement needs a series and original date, and cannot also repeat.', entry.metadata);
      else entry.replaces = { series: match[1], on: match[2] };
    }
  };
  let section: 'Dated' | 'Undated' | undefined;
  let group: PlannerGroup | undefined;
  let groupDepth = 0;
  const seen: string[] = [];
  const recognizedMetadata = new Set<Code>();
  for (const node of root.children) {
    const range = rangeOf(node);
    if (node.type === 'heading') {
      const name = plainText(node);
      const literal = node.children.every(child => child.type === 'text');
      if (node.depth <= 2) {
        group = undefined;
        section = undefined;
        if (node.depth === 2 && literal && ['Dated', 'Undated', 'Scratchpad'].includes(name)) {
          if (seen.includes(name)) issue('duplicate-section', `Repeated ${name} section.`, range);
          seen.push(name);
          if (name === 'Scratchpad') {
            const lineEnd = /\r\n|\r|\n/.exec(source.slice(range.end));
            model.scratchpad = { start: lineEnd ? range.end + lineEnd.index + lineEnd[0].length : source.length, end: source.length };
            break;
          }
          section = name as 'Dated' | 'Undated';
        }
      } else if (section && node.depth === 3) {
        group = undefined;
        if (!literal) continue;
        if (section === 'Dated' && !validDate(name)) {
          if (/^\d{4}-\d{2}-\d{2}$/.test(name)) issue('date', 'Invalid date heading.', range);
          continue;
        }
        const groups = section === 'Dated' ? model.days : model.undated;
        if (groups.some(previous => previous.name === name)) issue('duplicate-group', `Repeated ${section} heading: ${name}.`, range);
        group = { name, range, entries: [] };
        groups.push(group);
        groupDepth = node.depth;
      } else if (node.depth > groupDepth) group = undefined;
      continue;
    }
    if (!group || node.type !== 'list' || node.ordered) continue;
    for (const item of node.children) {
      if (section === 'Dated' && typeof item.checked !== 'boolean') continue;
      const base = detail(item);
      if (!base) continue;
      if (section === 'Undated' && typeof item.checked === 'boolean') issue('undated-checkbox', 'Undated lists use plain bullets, without completion state.', base.range);
      const marker = /^[-+*]([ \t]+)/.exec(slice(source, base.range))!;
      let column = item.position!.start.column - 1;
      for (const char of marker[0]) column += char === '\t' ? 4 - column % 4 : 1;
      const entry: PlannerEntry = { ...base, details: [], indent: ' '.repeat(column),
        ...(section === 'Dated' ? { date: group.name } : { list: group.name }) };
      // interpret a literal source prefix, not clock-shaped text inside inline code or emphasis.
      if (entry.date && /^\d{2}:\d{2}-\d{2}:\d{2}(?:\s|$)/.test(entry.markdown)) {
        const block = parseTimeBlock(entry.markdown.replace(/\r\n|\r|\n/g, ' '));
        if (!block) issue('time', 'Title time blocks need valid same-day clocks and an end after the start.', entry.titleRange);
        else entry.timeBlock = { start: block.start, end: block.end };
      }
      let count = 0;
      for (const child of item.children.slice(1)) {
        if (child.type === 'code' && child.lang === 'hcb') {
          recognizedMetadata.add(child);
          if (++count > 1) issue('duplicate-metadata', 'An entry can have only one direct hcb metadata block.', rangeOf(child));
          else metadata(entry, child);
        }
        if (child.type !== 'list' || child.ordered) continue;
        for (const nested of child.children) {
          if (section === 'Dated' && typeof nested.checked !== 'boolean') continue;
          const projected = detail(nested);
          if (!projected) continue;
          if (section === 'Undated' && typeof nested.checked === 'boolean') issue('undated-checkbox', 'Undated details use plain bullets.', projected.range);
          entry.details.push(projected);
        }
      }
      if (entry.details.length && entry.completed !== entry.details.every(child => child.completed)) {
        issue('completion-state', 'Parent completion must agree with its planning details; review the checkboxes.', entry.range);
      }
      if (entry.repeat?.kind === 'after' && entry.completed && !entry.completedOn) issue('completion-date', 'Completed after-completion entries need their actual completion date.', entry.range);
      group.entries.push(entry);
    }
  }
  if (seen.join(',') !== 'Dated,Undated,Scratchpad') issue('sections', 'Use Dated, Undated and final Scratchpad sections once, in that order.', { start: 0, end: source.length });
  const entries = plannerEntries(model);
  const ids = new Map<string, PlannerEntry>();
  const series = new Set<string>();
  const occurrences = new Set<string>();
  const replacements = new Set<string>();
  for (const entry of entries) {
    if (entry.id) {
      if (ids.has(entry.id)) issue('duplicate-id', `Entry ID appears more than once: ${entry.id}.`, entry.range);
      ids.set(entry.id, entry);
    }
    if (entry.repeat?.series) {
      const key = entry.repeat.kind === 'after' ? `${entry.repeat.series}:${entry.repeat.occurrence}` : entry.repeat.series;
      const collection = entry.repeat.kind === 'after' ? occurrences : series;
      if (collection.has(key)) issue('duplicate-series', 'A scheduled series or after-completion occurrence appears more than once.', entry.range);
      collection.add(key);
    }
    if (entry.replaces) {
      const key = `${entry.replaces.series}:${entry.replaces.on}`;
      if (replacements.has(key)) issue('duplicate-replacement', 'An occurrence has multiple replacements.', entry.range);
      replacements.add(key);
    }
  }
  for (const entry of entries) if (entry.replaces && !series.has(entry.replaces.series)) issue('missing-series', 'Replacement refers to a missing scheduled series.', entry.range);
  // inspect iteratively: arbitrary Markdown nesting must not consume our call stack.
  const pending: Node[] = [...root.children];
  while (pending.length) {
    const node = pending.pop()!;
    if (model.scratchpad && rangeOf(node).start >= model.scratchpad.start) continue;
    if (node.type === 'code' && (node as Code).lang === 'hcb' && !recognizedMetadata.has(node as Code)) {
      issue('orphan-metadata', 'An hcb fence outside a direct planner entry is an example, not metadata.', rangeOf(node), 'warning');
    }
    if ((node.type === 'link' || node.type === 'definition') && 'url' in node && typeof node.url === 'string' && node.url.startsWith('#hcb-')) {
      if (!ids.has(node.url.slice(5))) issue('broken-link', `Missing entry target: ${node.url}.`, rangeOf(node), 'warning');
    }
    for (const child of childrenOf(node)) pending.push(child);
  }
  return model;
}

export const plannerEntries = (model: MarkdownPlanner) => [...model.days, ...model.undated].flatMap(group => group.entries);
export const plannerWritable = (model: MarkdownPlanner) => !model.issues.some(issue => issue.severity === 'error');

function assertCurrent(model: MarkdownPlanner, current: string) {
  if (current !== model.source) throw new Error('The Markdown source changed. Reparse before applying this edit.');
  if (!plannerWritable(model)) throw new Error('Resolve planner diagnostics before applying structured edits. The exact source remains available.');
}

/** all offsets and expected fragments refer to one exact source version. */
export function applyPlannerEdits(model: MarkdownPlanner, current: string, patches: SourcePatch[]): MarkdownPlanner {
  assertCurrent(model, current);
  const sorted = [...patches].sort((a, b) => a.range.start - b.range.start);
  let previous: SourceRange | undefined;
  const splitsSurrogate = (offset: number) => offset > 0 && /[\uD800-\uDBFF]/.test(current[offset - 1]) && /[\uDC00-\uDFFF]/.test(current[offset] ?? '');
  for (const patch of sorted) {
    const { start, end } = patch.range;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > current.length || splitsSurrogate(start) || splitsSurrogate(end)) throw new Error('Invalid Markdown source range.');
    if (previous && (start < previous.end || start === previous.start)) throw new Error('Markdown edits overlap.');
    if (slice(current, patch.range) !== patch.expected) throw new Error('The expected Markdown fragment changed.');
    previous = patch.range;
  }
  let source = current;
  for (const patch of sorted.reverse()) source = source.slice(0, patch.range.start) + patch.text + source.slice(patch.range.end);
  const next = parseMarkdownPlanner(source);
  if (!plannerWritable(next)) throw new Error(`Edit would produce invalid planner content: ${next.issues.filter(issue => issue.severity === 'error').map(issue => issue.message).join(' ')}`);
  if (next.documentId !== model.documentId) throw new Error('Structured edits cannot change document identity.');
  return next;
}

function findEntry(model: MarkdownPlanner, start: number): PlannerEntry {
  const entry = plannerEntries(model).find(entry => entry.range.start === start);
  if (!entry) throw new Error('Entry is not part of this source version.');
  return entry;
}

const patchFor = (model: MarkdownPlanner, range: SourceRange, text: string): SourcePatch => ({ range, expected: slice(model.source, range), text });
const entryStructure = (entry: PlannerEntry) => JSON.stringify([
  entry.id, entry.date, entry.list, entry.completed, entry.repeat, entry.completedOn,
  entry.span, entry.skips, entry.replaces, entry.details.map(detail => [detail.markdown, detail.completed]),
]);

/** persist identity only when an operation needs it; untouched captures stay terse. */
export function ensurePlannerEntryId(model: MarkdownPlanner, current: string, start: number, newId = () => crypto.randomUUID()): { model: MarkdownPlanner; id: string } {
  assertCurrent(model, current);
  const entry = findEntry(model, start);
  if (entry.id) return { model, id: entry.id };
  const id = newId();
  if (!identity.test(id) || plannerEntries(model).some(entry => entry.id === id)) throw new Error('A new unique planner entry ID is required.');
  const nl = newline(current);
  let offset = entry.titleRange.end;
  let text = `${nl}${entry.indent}\`\`\`hcb${nl}${entry.indent}id: ${id}${nl}${entry.indent}\`\`\``;
  if (entry.metadata) {
    const openingEnd = /\r\n|\r|\n/.exec(slice(current, entry.metadata))!;
    offset = entry.metadata.start + openingEnd.index + openingEnd[0].length;
    text = `${entry.indent}id: ${id}${openingEnd[0]}`;
  }
  return { model: applyPlannerEdits(model, current, [patchFor(model, { start: offset, end: offset }, text)]), id };
}

export function renamePlannerEntry(model: MarkdownPlanner, current: string, start: number, markdown: string): MarkdownPlanner {
  assertCurrent(model, current);
  const entry = findEntry(model, start);
  const inline = parser.parse(markdown);
  if (/[\r\n]/.test(markdown) || inline.children.length !== 1 || inline.children[0].type !== 'paragraph' || !plainText(inline.children[0]).trim()) throw new Error('An entry title needs one nonempty Markdown paragraph on one line.');
  const next = applyPlannerEdits(model, current, [patchFor(model, entry.titleRange, markdown)]);
  const changed = findEntry(next, start);
  if (entryStructure(changed) !== entryStructure(entry) || changed.markdown !== markdown) throw new Error('Title changed the entry structure.');
  return next;
}

export function setPlannerCompletion(model: MarkdownPlanner, current: string, start: number, completed: boolean, detailIndex?: number): MarkdownPlanner {
  assertCurrent(model, current);
  const entry = findEntry(model, start);
  if (!entry.date || !entry.checkbox) throw new Error('Undated entries have no completion state.');
  if (entry.repeat || entry.replaces || entry.completedOn) throw new Error('This entry requires an occurrence-aware completion operation.');
  const changes = new Map<SourceRange, boolean>();
  if (detailIndex === undefined) {
    changes.set(entry.checkbox, completed);
    entry.details.forEach(detail => changes.set(detail.checkbox!, completed));
  } else {
    const detail = entry.details[detailIndex];
    if (!detail?.checkbox) throw new Error('Detail is not part of this entry.');
    changes.set(detail.checkbox, completed);
    changes.set(entry.checkbox, entry.details.every((detail, index) => index === detailIndex ? completed : detail.completed));
  }
  return applyPlannerEdits(model, current, [...changes].map(([range, checked]) => patchFor(model, range, checked ? 'x' : ' ')));
}

export function replacePlannerScratchpad(model: MarkdownPlanner, current: string, text: string): MarkdownPlanner {
  if (!model.scratchpad) throw new Error('The planner has no scratchpad section.');
  return applyPlannerEdits(model, current, [patchFor(model, model.scratchpad, text)]);
}
