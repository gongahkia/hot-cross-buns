import { plannerEntries, type MarkdownPlanner, type PlannerEntry, type SourceRange } from './markdownPlanner.ts';
import type { TodoDocument, TodoItem } from './todoText.ts';
import { parseMarkdownPreview } from './markdown.ts';

export type MarkdownTarget = {
  kind: 'entry' | 'heading' | 'passage'; label: string; fragment?: string; range: SourceRange;
  itemId?: string; entryRef?: string; date?: string; list?: string;
};
export type MarkdownBacklink = { target: MarkdownTarget; range: SourceRange; label: string };
export type MarkdownNavigation = {
  targets: MarkdownTarget[]; byFragment: Map<string, MarkdownTarget>;
  backlinks: Map<string, MarkdownBacklink[]>;
  incomingByItem: Map<string, MarkdownBacklink[]>;
};
export type MarkdownLinkPreparation = { entryRef: string; id: string };
const cache = new WeakMap<MarkdownPlanner, MarkdownNavigation>();
const preparations = new WeakMap<Function, { source: string; links: MarkdownLinkPreparation[] }>();
const itemId = (entry: PlannerEntry) => entry.id ?? `source:${entry.range.start}`;

export function withMarkdownPreparation<T extends Function>(change: T, source?: string, links: MarkdownLinkPreparation[] = []): T {
  if (source !== undefined) preparations.set(change, { source, links });
  return change;
}

export function prepareMarkdownChange(change: Function, document: TodoDocument): void {
  const preparation = preparations.get(change);
  if (preparation) prepareMarkdownLinks(document, preparation.source, preparation.links);
}

export function markdownFragment(url: string): string | undefined {
  if (!url.startsWith('#')) return;
  try { return decodeURIComponent(url.slice(1)); } catch { return; }
}

export function markdownNavigation(model: MarkdownPlanner): MarkdownNavigation {
  const cached = cache.get(model);
  if (cached) return cached;
  const entries = plannerEntries(model).sort((a, b) => a.range.start - b.range.start);
  const ownerAt = (offset: number): PlannerEntry | undefined => {
    let low = 0, high = entries.length;
    while (low < high) { const mid = (low + high) >>> 1; if (entries[mid].range.start <= offset) low = mid + 1; else high = mid; }
    const entry = entries[low - 1];
    return entry && offset < entry.range.end ? entry : undefined;
  };
  const owner = (entry?: PlannerEntry) => entry ? { itemId: itemId(entry), entryRef: `entry:${itemId(entry)}`, ...(entry.date ? { date: entry.date } : { list: entry.list }) } : {};
  const entryTargets = new Map(entries.map(entry => [itemId(entry), { kind: 'entry' as const, label: entry.text, range: entry.range, ...(entry.id ? { fragment: `hcb-${entry.id}` } : {}), ...owner(entry) }]));
  const targets: MarkdownTarget[] = [...entryTargets.values(), ...model.markdown.headings.map(heading => ({ kind: 'heading' as const, label: heading.text, fragment: heading.id, range: heading.range, ...owner(ownerAt(heading.range.start)) }))];
  targets.sort((a, b) => a.range.start - b.range.start);
  const byFragment = new Map(targets.filter(target => target.fragment).map(target => [target.fragment!, target]));
  const backlinks = new Map<string, MarkdownBacklink[]>();
  for (const link of model.markdown.links) {
    const fragment = markdownFragment(link.url);
    if (!fragment || !byFragment.has(fragment)) continue;
    const entry = ownerAt(link.range.start);
    // prose and scratchpad links can still be reached by their exact source range.
    const target: MarkdownTarget = entry ? entryTargets.get(itemId(entry))! : { kind: 'heading', label: link.text || 'Document passage', range: link.range };
    const incoming = backlinks.get(fragment) ?? [];
    incoming.push({ target, range: link.range, label: link.text }); backlinks.set(fragment, incoming);
  }
  const incomingByItem = new Map<string, MarkdownBacklink[]>();
  for (const [fragment, incoming] of backlinks) {
    const id = byFragment.get(fragment)?.itemId;
    if (id) incomingByItem.set(id, [...(incomingByItem.get(id) ?? []), ...incoming]);
  }
  const result = { targets, byFragment, backlinks, incomingByItem };
  cache.set(model, result);
  return result;
}

export function suggestMarkdownLinks(navigation: MarkdownNavigation, query: string, limit = 20): MarkdownTarget[] {
  const needle = query.normalize('NFC').toLocaleLowerCase('en-US').trim();
  return navigation.targets.filter(target => !needle || target.label.normalize('NFC').toLocaleLowerCase('en-US').includes(needle)).slice(0, Math.max(0, Math.min(limit, 50)));
}

export function markdownLink(label: string, fragment: string): string {
  const text = label.replace(/\\/g, '\\\\').replace(/([\[\]`*_~<>])/g, '\\$1').replace(/[\r\n]+/g, ' ');
  return `[${text}](#${encodeURIComponent(fragment)})`;
}

export function usedMarkdownPreparations(markdown: string, pending: MarkdownLinkPreparation[]): MarkdownLinkPreparation[] {
  if (!pending.length) return [];
  const targets = new Set(parseMarkdownPreview(markdown).index.links.map(link => markdownFragment(link.url)));
  return pending.filter(link => targets.has(`hcb-${link.id}`));
}

export function assertPassageOwnership(before: MarkdownPlanner, after: MarkdownPlanner, range: SourceRange): void {
  const delta = after.source.length - before.source.length;
  const candidates = new Map(plannerEntries(after).map(entry => [entry.range.start, entry]));
  for (const entry of plannerEntries(before)) {
    if (entry.range.start < range.end && entry.range.end > range.start) continue;
    const offset = entry.range.start >= range.end ? delta : 0, candidate = candidates.get(entry.range.start + offset);
    if (!candidate || candidate.date !== entry.date || candidate.list !== entry.list || candidate.range.end !== entry.range.end + offset) throw new Error('This block edit would reinterpret entries outside the edited block. Use journal controls or the full source editor to review that change.');
  }
}

/** persist missing entry identities in the same source transaction as the new link. */
export function prepareMarkdownLinks(document: TodoDocument, expectedSource: string, preparations: MarkdownLinkPreparation[]): void {
  if (document.source !== expectedSource) throw new Error('The document changed while this link draft was open. Keep your draft and review the latest source.');
  const items = new Map<string, TodoItem>();
  for (const group of [...document.days, ...(document.undated ?? [])]) for (const item of group.items) if (item.sourceRef) items.set(item.sourceRef, item);
  const ids = new Set([...items.values()].map(item => item.id));
  const seen = new Map<string, string>();
  for (const preparation of preparations) {
    const item = items.get(preparation.entryRef);
    if (!item || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(preparation.id)) throw new Error('A link target is no longer available. Keep the draft and choose its target again.');
    const prior = seen.get(preparation.entryRef);
    if (prior && prior !== preparation.id || !item.id.startsWith('source:') && item.id !== preparation.id || ids.has(preparation.id) && item.id !== preparation.id) throw new Error('A link target identity changed or is duplicated. Keep the draft and choose its target again.');
    seen.set(preparation.entryRef, preparation.id); ids.add(preparation.id); item.id = preparation.id;
  }
}
