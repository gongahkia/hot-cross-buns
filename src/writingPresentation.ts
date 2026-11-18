import { markdownKey, MARKDOWN_RENDER_LIMITS, parseMarkdownPreview, type MarkdownNode } from './markdown.ts';
import type { MarkdownPlanner, PlannerDetail, PlannerEntry } from './markdownPlanner.ts';
import type { TodoBody } from './todoText.ts';
import { writingBlocks, writingGroup, type WritingLocation } from './journalWriting.ts';

const previews = new WeakMap<MarkdownPlanner, Map<string, { node: MarkdownNode; characters: number; nodes: number }>>();
type WritingTarget = { entry: PlannerEntry; node: PlannerDetail; path: number[] };
const targets = new WeakMap<MarkdownPlanner, Map<number, WritingTarget>>();

export function writingTarget(model: MarkdownPlanner, start: number): WritingTarget | undefined {
  let index = targets.get(model);
  if (!index) {
    index = new Map();
    const visit = (entry: PlannerEntry, node: PlannerDetail, path: number[]) => {
      index!.set(node.range.start, { entry, node, path });
      (path.length ? node.children : entry.details)?.forEach((child, position) => visit(entry, child, [...path, position]));
    };
    for (const group of [...model.days, ...model.undated]) for (const entry of group.entries) visit(entry, entry, []);
    targets.set(model, index);
  }
  return index.get(start);
}

function blockView(model: MarkdownPlanner, range: { start: number; end: number }): MarkdownNode {
  const key = markdownKey(range), saved = model.markdown.blocks[key];
  if (saved) return saved.type === 'listItem' ? { type: 'list', range, ordered: false, children: [saved] } : saved;
  let cache = previews.get(model);
  if (!cache) { cache = new Map(); previews.set(model, cache); }
  const cached = cache.get(key);
  if (cached) return cached.node;
  const source = model.source.slice(range.start, range.end);
  const preview = parseMarkdownPreview(source, model.markdown);
  let nodes = 0;
  const shift = (node: MarkdownNode): MarkdownNode => {
    nodes++;
    return { ...node, range: { start: node.range.start + range.start, end: node.range.end + range.start }, ...(node.children ? { children: node.children.map(shift) } : {}) };
  };
  const node: MarkdownNode = { type: 'group', range, children: preview.nodes.map(shift) };
  cache.set(key, { node, characters: source.length, nodes });
  let characters = 0, count = 0;
  for (const preview of [...cache.values()].reverse()) { characters += preview.characters; count += preview.nodes; }
  while (cache.size && (cache.size > 100 || characters > 500_000 || count > MARKDOWN_RENDER_LIMITS.modelNodes)) {
    const key = cache.keys().next().value!, removed = cache.get(key)!;
    cache.delete(key); characters -= removed.characters; count -= removed.nodes;
  }
  return node;
}

/** only the visible document's missing trees are derived; fallback parsing shares global references. */
export function writingPresentation(model: MarkdownPlanner, location: WritingLocation, limit = 200): { body: TodoBody[]; views: Record<string, MarkdownNode>; total: number; hiddenMetadata: Set<string>; entryIds: Record<number, string> } {
  const blocks = writingBlocks(model, location), visible = blocks.slice(0, Math.max(0, Math.min(limit, 5000)));
  const body: TodoBody[] = [], views: Record<string, MarkdownNode> = Object.create(null), hiddenMetadata = new Set<string>();
  const entryIds: Record<number, string> = Object.create(null);
  for (const block of visible) {
    const key = `writing:${markdownKey(block.range)}`;
    body.push({ markdown: model.source.slice(block.range.start, block.range.end), sourceRef: key });
    views[key] = blockView(model, block.range);
    if (block.entryId) entryIds[block.range.start] = block.entryId;
  }
  if (location.kind !== 'scratchpad') for (const entry of writingGroup(model, location)?.entries ?? []) if (entry.metadata) hiddenMetadata.add(markdownKey(entry.metadata));
  return { body, views, total: blocks.length, hiddenMetadata, entryIds };
}
