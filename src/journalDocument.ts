import { applyPlannerEdits, parseMarkdownPlanner, plannerEntries, plannerWritable, type MarkdownPlanner, type PlannerDetail, type PlannerEntry, type PlannerGroup, type SourcePatch, type SourceRange } from './markdownPlanner.ts';
import { formatRecurrence } from './recurrence.ts';
import { formatSpan, type TodoBody, type TodoDetail, type TodoDocument, type TodoItem } from './todoText.ts';
import { markdownKey, type MarkdownNode } from './markdown.ts';

export const JOURNAL_FILE_NAME = 'Planner.md';
export const JOURNAL_FORMAT = 'hcb-markdown-1';
const cache = new Map<string, { model: MarkdownPlanner; document: TodoDocument }>();
const assignedIds = new WeakMap<TodoItem, string>();
const canonical = new WeakSet<TodoDocument>();
// models live only as long as their immutable documents; the source cache stays bounded.
const models = new WeakMap<TodoDocument, MarkdownPlanner>();
const bodyViews = new WeakMap<TodoDocument, Record<string, MarkdownNode>>();
export const isCanonicalJournal = (document: TodoDocument) => canonical.has(document);
export const cachedJournal = (source: string) => cache.get(source);
const textAt = (source: string, range: SourceRange) => source.slice(range.start, range.end);
const nlOf = (source: string) => /\r\n|\r|\n/.exec(source)?.[0] ?? '\n';
const fields = ['repeat', 'completedOn', 'span', 'skips', 'replaces'] as const;
const entryId = (entry: PlannerEntry) => entry.id ?? `source:${entry.range.start}`;
const entryRef = (entry: PlannerEntry) => `entry:${entryId(entry)}`;
const value = (item: TodoItem) => JSON.stringify([item.text, item.completed, item.details, item.body, ...fields.map(key => item[key])]);
const bodyFrom = (node: PlannerDetail, ref: string): TodoBody[] | undefined => node.body?.map((block, index) => ({
  markdown: adjustIndent(block.markdown, block.column, 0, nlOf(block.markdown)), sourceRef: `${ref}:body:${index}`,
}));
const detailFrom = (detail: PlannerDetail, ref: string): TodoDetail => ({
  text: detail.markdown, completed: detail.completed, sourceRef: ref,
  ...(detail.kind ? { kind: detail.kind } : {}),
  ...(detail.children?.length ? { children: detail.children.map((child, index) => detailFrom(child, `${ref}:detail:${index}`)) } : {}),
  ...(detail.body?.length ? { body: bodyFrom(detail, ref) } : {}),
});
const itemFrom = (entry: PlannerEntry): TodoItem => ({
  id: entryId(entry), sourceRef: entryRef(entry), text: entry.markdown, completed: entry.completed,
  details: entry.details.map((detail, index) => detailFrom(detail, `${entryRef(entry)}:detail:${index}`)),
  ...(entry.body?.length ? { body: bodyFrom(entry, entryRef(entry)) } : {}),
  ...Object.fromEntries(fields.filter(key => entry[key] !== undefined).map(key => [key, entry[key]])),
});

export function readJournal(source: string): { model: MarkdownPlanner; document: TodoDocument } {
  const cached = cache.get(source);
  if (cached) return cached;
  return projectJournal(parseMarkdownPlanner(source));
}

export function journalModel(document: TodoDocument): MarkdownPlanner {
  return models.get(document) ?? readJournal(serializeJournal(document)).model;
}

export function journalBodyViews(document: TodoDocument): Record<string, MarkdownNode> {
  const cached = bodyViews.get(document);
  if (cached) return cached;
  const model = journalModel(document), views: Record<string, MarkdownNode> = Object.create(null);
  const visit = (node: PlannerDetail, ref: string) => {
    node.body?.forEach((block, index) => {
      const view = model.markdown.blocks[markdownKey(block.range)];
      if (view) views[`${ref}:body:${index}`] = view;
    });
    ('details' in node ? (node as PlannerEntry).details : node.children)?.forEach((child, index) => visit(child, `${ref}:detail:${index}`));
  };
  for (const entry of plannerEntries(model)) visit(entry, entryRef(entry));
  for (const passage of model.markdown.passages) {
    const key = markdownKey(passage.range), view = model.markdown.blocks[key];
    if (view) views[`document:${key}`] = view;
  }
  Object.freeze(views);
  bodyViews.set(document, views);
  return views;
}

function projectJournal(model: MarkdownPlanner): { model: MarkdownPlanner; document: TodoDocument } {
  const source = model.source;
  const document: TodoDocument = {
    source, scratchpad: model.scratchpad ? textAt(source, model.scratchpad) : '',
    days: model.days.map(group => ({ date: group.name, items: group.entries.map(itemFrom), keepEmpty: true })),
    ...(model.undated.length ? { undated: model.undated.map(group => ({ name: group.name, sourceRef: `list:${group.range.start}`, items: group.entries.map(itemFrom) })) } : {}),
  };
  const pending: object[] = [document, model];
  while (pending.length) {
    const value = pending.pop()!;
    if (Object.isFrozen(value)) continue;
    for (const child of Object.values(value)) if (child && typeof child === 'object') pending.push(child);
    Object.freeze(value);
  }
  if (plannerWritable(model)) canonical.add(document);
  const result = { model, document };
  models.set(document, model);
  cache.set(source, result);
  if (cache.size > 2) cache.delete(cache.keys().next().value!);
  return result;
}

export const journalFromPlanner = projectJournal;

export function parseJournal(source: string) {
  const { model, document } = readJournal(source);
  return { document, issues: model.issues.filter(issue => issue.severity === 'error').map(issue => ({
    line: source.slice(0, issue.range.start).split(/\r\n|\r|\n/).length, message: issue.message,
  })) };
}

export function createJournal(documentId: string = crypto.randomUUID(), format: 1 | 2 = 1): TodoDocument {
  return readJournal(`---\nhcb-format: ${format}\ndocument-id: ${documentId}\n---\n\n# Hot Cross Buns\n\n## Dated\n\n## Undated\n\n### Inbox\n\n## Scratchpad\n`).document;
}

function assertModel(model: MarkdownPlanner) {
  if (!plannerWritable(model)) throw new Error(model.issues.filter(issue => issue.severity === 'error').map(issue => issue.message).join(' '));
}

function metadata(item: TodoItem, id: string, dated: boolean): string[] {
  const lines = [`id: ${id}`];
  if (dated) {
    if (item.repeat) lines.push(`repeat: ${formatRecurrence(item.repeat)}`);
    if (item.span) lines.push(`span: ${formatSpan(item.span)}`);
    if (item.skips?.length) lines.push(`skip: ${item.skips.join(', ')}`);
    if (item.replaces) lines.push(`replaces: ${item.replaces.series} on ${item.replaces.on}`);
    if (item.completedOn) lines.push(`completed: ${item.completedOn}`);
  }
  return lines;
}

type Original = { node: PlannerDetail | PlannerEntry; entry?: PlannerEntry; column: number };
function adjustIndent(raw: string, from: number, to: number, nl: string) {
  if (from === to) return raw;
  return raw.split(/\r\n|\r|\n/).map((line, index) => {
    if (!index || !line.trim()) return line;
    let width = 0, consumed = 0;
    while (consumed < line.length && width < from && /[ \t]/.test(line[consumed])) { width += line[consumed++] === '\t' ? 4 - width % 4 : 1; }
    return ' '.repeat(to + Math.max(0, width - from)) + line.slice(consumed);
  }).join(nl);
}

/** the arrays are editable projections; only this adapter commits their changes back to source. */
export function materializeJournal(document: TodoDocument): TodoDocument {
  if (canonical.has(document)) return document;
  if (document.source === undefined) throw new Error('The journal has no Markdown source. Explicitly convert or create a Markdown workspace.');
  const { model, document: before } = readJournal(document.source);
  assertModel(model);
  const source = model.source, nl = nlOf(source);
  const patches: SourcePatch[] = [];
  const add = (range: SourceRange, text: string) => { if (textAt(source, range) !== text) patches.push({ range, expected: textAt(source, range), text }); };
  const originals = new Map<string, Original>();
  const bodies = new Map<string, NonNullable<PlannerDetail['body']>[number]>();
  const remember = (node: PlannerDetail, ref: string) => {
    node.body?.forEach((block, index) => bodies.set(`${ref}:body:${index}`, block));
    node.children?.forEach((child, index) => {
      const childRef = `${ref}:detail:${index}`;
      originals.set(childRef, { node: child, column: child.column });
      remember(child, childRef);
    });
  };
  for (const entry of plannerEntries(model)) {
    originals.set(entryRef(entry), { node: entry, entry, column: entry.column });
    remember(entry, entryRef(entry));
    entry.details.forEach((node, index) => {
      const ref = `${entryRef(entry)}:detail:${index}`;
      originals.set(ref, { node, column: node.column });
      remember(node, ref);
    });
  }
  const localPatch = (raw: string, owner: SourceRange, edits: Array<{ range: SourceRange; text: string }>) => {
    for (const edit of edits.sort((a, b) => b.range.start - a.range.start)) raw = raw.slice(0, edit.range.start - owner.start) + edit.text + raw.slice(edit.range.end - owner.start);
    return raw;
  };
  const title = (text: string, indent: number, dated: boolean) => {
    if (!dated && /^\d+[.)]\s/.test(text)) text = text.replace(/^(\d+)([.)])/,'$1\\$2');
    else if (!dated && /^(?:[+*-]\s|#{1,6}\s|>|\[[ xX]\]\s|`{3}|~{3}|<(?!(?:https?:\/\/))|(?:[-*_]\s*){3,}$)/.test(text)) text = '\\' + text;
    return text.replace(/\r\n|\r|\n/g, `${nl}${' '.repeat(indent)}`);
  };
  const render = (item: TodoDetail | TodoItem, dated: boolean, column: number, asEntry: boolean): string => {
    const original = item.sourceRef ? originals.get(item.sourceRef) : undefined;
    const node = original?.node;
    const checked = dated && !('kind' in item && item.kind === 'note');
    const marker = `- ${checked ? `[${item.completed ? 'x' : ' '}] ` : ''}`;
    const childColumn = column + 2;
    const children = asEntry ? (item as TodoItem).details : (item as TodoDetail).children ?? [];
    const renderBody = (block: TodoBody, indent: number) => {
      const original = block.sourceRef ? bodies.get(block.sourceRef) : undefined;
      if (original && block.markdown === adjustIndent(original.markdown, original.column, 0, nlOf(original.markdown))) return adjustIndent(original.markdown, original.column, indent, nl);
      return block.markdown.replace(/\r\n|\r|\n/g, `${nl}${' '.repeat(indent)}`);
    };
    if (!node) {
      let raw = marker + title(item.text, childColumn, dated);
      if (asEntry) {
        const entry = item as TodoItem;
        if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(entry.id)) throw new Error('New entries require a stable ID.');
        raw += `${nl}${' '.repeat(childColumn)}\`\`\`hcb${nl}${metadata(entry, entry.id, dated).map(line => ' '.repeat(childColumn) + line).join(nl)}${nl}${' '.repeat(childColumn)}\`\`\``;
      }
      for (const block of item.body ?? []) raw += `${nl}${nl}${' '.repeat(childColumn)}${renderBody(block, childColumn)}`;
      children.forEach((child, index) => { raw += `${index === 0 && item.body?.length ? nl + nl : nl}${' '.repeat(childColumn)}${render(child, dated, childColumn, false)}`; });
      return raw;
    }
    const edits: Array<{ range: SourceRange; text: string }> = [];
    const prefix = textAt(source, { start: node.range.start, end: node.titleRange.start });
    const originalDated = !!node.checkbox;
    if (originalDated !== checked) edits.push({ range: { start: node.range.start, end: node.titleRange.start }, text: marker });
    else if (node.checkbox && item.completed !== node.completed) edits.push({ range: node.checkbox, text: item.completed ? 'x' : ' ' });
    if (item.text !== node.markdown) edits.push({ range: node.titleRange, text: title(item.text, original!.column + (prefix.match(/^[-+*][ \t]+/)?.[0].length ?? 2), dated) });
    if (model.format === 2 && JSON.stringify(item.body) !== JSON.stringify(bodyFrom(node, item.sourceRef!))) {
      const oldBody = node.body ?? [], nextBody = item.body ?? [], indent = original!.column + 2;
      const references = oldBody.map((_, index) => `${item.sourceRef}:body:${index}`);
      const positions = new Map(references.map((ref, index) => [ref, index]));
      const desiredByRef = new Map(nextBody.map(block => [block.sourceRef, block]));
      const retained = nextBody.map(block => block.sourceRef ? positions.get(block.sourceRef) ?? -1 : -1);
      const sameOrder = retained.every((index, position) => index >= 0 && (!position || index > retained[position - 1]));
      oldBody.forEach((block, index) => {
        const desired = sameOrder ? desiredByRef.get(references[index]) : nextBody[index];
        edits.push({ range: block.range, text: desired ? renderBody(desired, indent) : '' });
      });
      const extra = nextBody.slice(oldBody.length);
      if (extra.length) {
        const offset = oldBody.at(-1)?.range.end ?? node.titleRange.end;
        edits.push({ range: { start: offset, end: offset }, text: extra.map(block => `${nl}${nl}${' '.repeat(indent)}${renderBody(block, indent)}`).join('') });
      }
    }
    if (asEntry) {
      const entry = item as TodoItem, old = original!.entry;
      const oldValue = old && itemFrom(old);
      const changed = !old || value(entry) !== value(oldValue!) || entry.id !== entryId(old);
      const changedMetadata = !old || !!old.id && entry.id !== old.id || !!old.date !== dated || JSON.stringify(fields.map(key => entry[key])) !== JSON.stringify(fields.map(key => old[key]));
      if (changedMetadata || !old?.id && changed) {
        let id = entry.id;
        if (/^source:/.test(id)) {
          id = assignedIds.get(entry) ?? crypto.randomUUID();
          assignedIds.set(entry, id);
        }
        const indent = old?.indent ?? ' '.repeat(original!.column + 2);
        const block = `\`\`\`hcb${nl}${metadata(entry, id, dated).map(line => indent + line).join(nl)}${nl}${indent}\`\`\``;
        if (old?.metadata) edits.push({ range: old.metadata, text: block });
        else edits.push({ range: { start: node.titleRange.end, end: node.titleRange.end }, text: `${nl}${indent}${block}` });
      }
      const oldDetails = old?.details ?? node.children ?? [];
      const detailColumn = old?.indent.length ?? original!.column + 2;
      if (!old || !!old.date !== dated || JSON.stringify(entry.details) !== JSON.stringify(oldValue!.details)) {
        oldDetails.forEach((detail, index) => edits.push({ range: detail.range, text: entry.details[index] ? render(entry.details[index], dated, detailColumn, false) : '' }));
        const extra = entry.details.slice(oldDetails.length);
        if (extra.length) {
          const offset = oldDetails.at(-1)?.range.end ?? node.range.end;
          const text = extra.map((detail, index) => `${index === 0 && !oldDetails.length ? nl + nl : nl}${' '.repeat(detailColumn)}${render(detail, dated, detailColumn, false)}`).join('');
          const existing = edits.find(edit => edit.range.end === offset && edit.range.start !== edit.range.end);
          if (existing) existing.text += text;
          else edits.push({ range: { start: offset, end: offset }, text });
        }
      }
    } else if (model.format === 2) {
      const oldChildren = original!.entry?.details ?? node.children ?? [];
      const oldDetails = oldChildren.map((child, index) => detailFrom(child, `${item.sourceRef}:detail:${index}`));
      if (original!.entry?.metadata) edits.push({ range: original!.entry.metadata, text: '' });
      if (originalDated !== checked || JSON.stringify(children) !== JSON.stringify(oldDetails)) {
        const indent = original!.column + 2;
        oldChildren.forEach((child, index) => edits.push({ range: child.range, text: children[index] ? render(children[index], dated, indent, false) : '' }));
        const extra = children.slice(oldChildren.length);
        if (extra.length) {
          const offset = oldChildren.at(-1)?.range.end ?? node.range.end;
          const text = extra.map((child, index) => `${index === 0 && !oldChildren.length ? nl + nl : nl}${' '.repeat(indent)}${render(child, dated, indent, false)}`).join('');
          const existing = edits.find(edit => edit.range.end === offset && edit.range.start !== edit.range.end);
          if (existing) existing.text += text;
          else edits.push({ range: { start: offset, end: offset }, text });
        }
      }
    } else if (original!.entry) {
      // demotion flattens planning details into sibling details; retain the rest of the body once.
      for (const child of original!.entry.details) edits.push({ range: child.range, text: '' });
      if (original!.entry.metadata) edits.push({ range: original!.entry.metadata, text: '' });
    }
    return adjustIndent(localPatch(textAt(source, node.range), node.range, edits), original!.column, column, nl);
  };
  const groupText = (group: PlannerGroup, items: TodoItem[], dated: boolean) => {
    let output = '', cursor = group.content.start;
    group.entries.forEach((entry, index) => {
      output += source.slice(cursor, entry.range.start);
      if (items[index]) output += render(items[index], dated, originals.get(entryRef(entry))!.column, true);
      cursor = entry.range.end;
    });
    const extra = items.slice(group.entries.length);
    if (extra.length) {
      if (!group.entries.length) { output += source.slice(cursor, group.content.end); cursor = group.content.end; }
      output += `${output.endsWith(nl + nl) ? '' : nl + nl}${extra.map(item => render(item, dated, 0, true)).join(nl + nl)}${nl}${nl}`;
    }
    return output + source.slice(cursor, group.content.end);
  };
  const heading = (name: string) => name.replace(/[\\`*_{}[\]()<>!|~#]/g, '\\$&');
  const updateGroups = (groups: PlannerGroup[], desired: Array<{ name: string; items: TodoItem[]; sourceRef?: string }>, dated: boolean) => {
    const prior = new Map(groups.map(group => [group.name, group]));
    const references = new Set(groups.map(group => `list:${group.range.start}`));
    const byName = new Map(desired.map(group => [group.name, group]));
    const byReference = new Map(desired.filter(group => group.sourceRef).map(group => [group.sourceRef!, group]));
    if (byName.size !== desired.length) throw new Error('Planner group names must be unique.');
    if (byReference.size !== desired.filter(group => group.sourceRef).length) throw new Error('A planner group cannot appear more than once.');
    for (const group of groups) {
      const next = (!dated && byReference.get(`list:${group.range.start}`)) || byName.get(group.name);
      if (!next) add({ start: group.range.start, end: group.content.end }, '');
      else {
        if (next.name !== group.name) add(group.range, `### ${heading(next.name)}`);
        const previousItems = group.entries.map(itemFrom);
        if (JSON.stringify(previousItems) !== JSON.stringify(next.items)) add(group.content, groupText(group, next.items, dated));
      }
    }
    const additions = desired.filter(group => !prior.has(group.name) && (dated || !group.sourceRef || !references.has(group.sourceRef)));
    if (additions.length) {
      const offset = model.sectionEnds[dated ? 'Dated' : 'Undated']!;
      const text = additions.map(group => `### ${heading(group.name)}${nl}${nl}${group.items.map(item => render(item, dated, 0, true)).join(nl + nl)}${nl}${nl}`).join('');
      add({ start: offset, end: offset }, text);
    }
  };
  updateGroups(model.days, document.days.map(day => ({ name: day.date, items: day.items })), true);
  updateGroups(model.undated, document.undated ?? [], false);
  if (document.scratchpad !== undefined && document.scratchpad !== before.scratchpad) add(model.scratchpad!, document.scratchpad);
  if (!patches.length) return before;
  // a group ending at the insertion boundary and a new group may share that boundary.
  const merged: SourcePatch[] = [];
  for (const patch of patches.sort((a, b) => a.range.start - b.range.start || b.range.end - a.range.end)) {
    const previous = merged.at(-1);
    if (previous && patch.range.start === patch.range.end && patch.range.start === previous.range.end) previous.text += patch.text;
    else merged.push(patch);
  }
  const next = applyPlannerEdits(model, source, merged);
  return projectJournal(next).document;
}

export const serializeJournal = (document: TodoDocument): string => materializeJournal(document).source!;
export const validateJournal = (document: TodoDocument): void => { materializeJournal(document); };
export const withScratchpad = (document: TodoDocument, text: string) => materializeJournal({ ...document, scratchpad: text });
export const isEmptyJournal = (document: TodoDocument) => document.source?.trim() === createJournal(journalModel(document).documentId, journalModel(document).format === 2 ? 2 : 1).source!.trim();

/** one explicit workspace conversion, not a reader for legacy files in the running app. */
export function journalFromModel(model: TodoDocument, scratchpad = '', documentId: string = crypto.randomUUID()): TodoDocument {
  const empty = createJournal(documentId);
  const items = (entries: TodoItem[]) => entries.map(item => ({ ...item, id: /^[a-z0-9][a-z0-9-]{0,79}$/.test(item.id) ? item.id : crypto.randomUUID(), sourceRef: undefined,
    text: escapeMarkdownText(item.text), details: item.details.map(detail => ({ text: escapeMarkdownText(detail.text), completed: detail.completed })) }));
  return materializeJournal({ ...empty, scratchpad,
    days: model.days.map(day => ({ ...day, items: items(day.items) })),
    undated: (model.undated ?? []).map(list => ({ ...list, items: items(list.items) })),
  });
}

export function escapeMarkdownText(text: string): string {
  return text.replace(/[\\`*_{}[\]()<>!|~]/g, '\\$&').replace(/^([#-])(?=\s|-)/, '\\$1').replace(/^([+])(?=\s)/, '\\$1').replace(/^(\d+)\. /, '$1\\. ');
}
