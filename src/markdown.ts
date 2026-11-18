import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import type { Nodes, Root } from 'mdast';

export type MarkdownRange = { start: number; end: number };
export type MarkdownNode = {
  type: string; range: MarkdownRange; children?: MarkdownNode[];
  value?: string; url?: string; title?: string; identifier?: string; label?: string;
  depth?: number; ordered?: boolean; start?: number; checked?: boolean;
  lang?: string; align?: Array<'left' | 'right' | 'center' | null>; alt?: string;
};
export type MarkdownHeading = { id: string; text: string; range: MarkdownRange };
export type MarkdownLink = { url: string; text: string; range: MarkdownRange };
export type MarkdownIndex = {
  definitions: Record<string, { url: string; title?: string }>;
  footnotes: Record<string, MarkdownNode>;
  headings: MarkdownHeading[]; links: MarkdownLink[];
  blocks: Record<string, MarkdownNode>;
  context: string; truncated: boolean;
};

export const MARKDOWN_RENDER_LIMITS = { nodes: 2000, depth: 32, characters: 40_000, modelNodes: 20_000, modelBlocks: 2000 } as const;
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter);
export const markdownRange = (node: Nodes): MarkdownRange => ({ start: node.position!.start.offset!, end: node.position!.end.offset! });
export const markdownKey = (range: MarkdownRange) => `${range.start}:${range.end}`;
const children = (node: Nodes): Nodes[] => 'children' in node ? node.children : [];
const pushChildren = (pending: Nodes[], node: Nodes) => {
  const nested = children(node);
  for (let index = nested.length - 1; index >= 0; index--) pending.push(nested[index]);
};

export function markdownText(node: Nodes): string {
  const parts: string[] = [], pending: Nodes[] = [node];
  while (pending.length) {
    const next = pending.pop()!;
    if ('value' in next) parts.push(next.value);
    else if ('alt' in next) parts.push(next.alt ?? '');
    else if (next.type === 'break') parts.push('\n');
    else pushChildren(pending, next);
  }
  return parts.join('');
}

/** one grammar for planner semantics, saved rendering and local draft previews. */
export function parseMarkdownTree(source: string): Root {
  const bom = source.startsWith('\uFEFF');
  const root = parser.parse(bom ? source.slice(1) : source);
  if (bom) {
    const pending: Nodes[] = [root];
    while (pending.length) {
      const node = pending.pop()!;
      if (node.position) { node.position.start.offset!++; node.position.end.offset!++; }
      pushChildren(pending, node);
    }
  }
  return root;
}

export function headingSlug(text: string): string {
  return `heading-${text.normalize('NFC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/[\s_]+/g, '-') || 'section'}`;
}

export function safeMarkdownUrl(url: string): string | undefined {
  return /^(?:https?:\/\/|mailto:|#[^\s\u0000-\u001f]+)/i.test(url) && !/[\u0000-\u001f\u007f]/.test(url) ? url : undefined;
}

type Budget = { remaining: number };
function compactNode(node: Nodes, budget: Budget, depth = 0): MarkdownNode {
  const range = markdownRange(node);
  if (--budget.remaining < 0 || depth > MARKDOWN_RENDER_LIMITS.depth || range.end - range.start > MARKDOWN_RENDER_LIMITS.characters || children(node).length > budget.remaining) return { type: 'source', range };
  const result: MarkdownNode = { type: node.type, range };
  if ('children' in node) result.children = node.children.map(child => compactNode(child, budget, depth + 1));
  for (const key of ['value', 'url', 'title', 'identifier', 'label', 'depth', 'ordered', 'start', 'checked', 'lang', 'align', 'alt'] as const) {
    if (key in node && node[key as keyof typeof node] !== null && node[key as keyof typeof node] !== undefined) Object.assign(result, { [key]: node[key as keyof typeof node] });
  }
  return result;
}

/** retain bounded render trees for selected blocks, never a second full Markdown AST. */
export function indexMarkdown(root: Root, selected: MarkdownRange[] = [], source = ''): MarkdownIndex {
  const definitions: MarkdownIndex['definitions'] = Object.create(null), footnotes: MarkdownIndex['footnotes'] = Object.create(null);
  const blocks: MarkdownIndex['blocks'] = Object.create(null), headings: MarkdownHeading[] = [], links: MarkdownLink[] = [];
  const wanted = new Set(selected.map(markdownKey)), slugs = new Map<string, number>();
  const budget = { remaining: MARKDOWN_RENDER_LIMITS.modelNodes };
  const context: string[] = [];
  let contextLength = 0, blockCount = 0, truncated = false;
  const pending: Nodes[] = [root], references: Array<Extract<Nodes, { type: 'linkReference' }>> = [];
  while (pending.length) {
    const node = pending.pop()!, range = markdownRange(node), key = markdownKey(range);
    if (node.type === 'definition' && !Object.hasOwn(definitions, node.identifier)) definitions[node.identifier] = { url: node.url, ...(node.title ? { title: node.title } : {}) };
    if (node.type === 'footnoteDefinition' && !Object.hasOwn(footnotes, node.identifier)) footnotes[node.identifier] = compactNode(node, budget);
    if (node.type === 'definition' || node.type === 'footnoteDefinition') {
      const raw = source.slice(range.start, range.end);
      if (contextLength + raw.length <= MARKDOWN_RENDER_LIMITS.characters) { context.push(raw); contextLength += raw.length + 2; }
      else truncated = true;
    }
    if (node.type === 'heading') {
      const text = markdownText(node), base = headingSlug(text), count = slugs.get(base) ?? 0;
      slugs.set(base, count + 1);
      headings.push({ id: count ? `${base}-${count}` : base, text, range });
    }
    if (node.type === 'link') links.push({ url: node.url, text: markdownText(node), range });
    if (node.type === 'linkReference') references.push(node);
    if (wanted.has(key) && blockCount++ < MARKDOWN_RENDER_LIMITS.modelBlocks) { blocks[key] = compactNode(node, budget); wanted.delete(key); }
    pushChildren(pending, node);
  }
  for (const node of references) {
    const definition = definitions[node.identifier];
    if (definition) links.push({ url: definition.url, text: markdownText(node), range: markdownRange(node) });
  }
  links.sort((a, b) => a.range.start - b.range.start);
  return { definitions, footnotes, blocks, headings, links, context: context.join('\n\n'), truncated: truncated || wanted.size > 0 || budget.remaining < 0 };
}

export function parseMarkdownPreview(source: string, context?: Pick<MarkdownIndex, 'definitions' | 'footnotes' | 'context'>): { nodes: MarkdownNode[]; index: MarkdownIndex } {
  if (source.length > MARKDOWN_RENDER_LIMITS.characters) return { nodes: [{ type: 'source', range: { start: 0, end: source.length } }], index: { definitions: context?.definitions ?? {}, footnotes: context?.footnotes ?? {}, blocks: {}, headings: [], links: [], context: '', truncated: true } };
  const root = parseMarkdownTree(source), index = indexMarkdown(root, [], source);
  const budget = { remaining: MARKDOWN_RENDER_LIMITS.nodes };
  let nodes = root.children;
  if (context?.context) {
    const augmented = parseMarkdownTree(`${source}\n\n${context.context}`);
    // an unfinished fence/HTML block must not swallow appended reference definitions.
    nodes = augmented.children.filter(node => markdownRange(node).start < source.length).map(node => markdownRange(node).end <= source.length ? node : root.children.find(original => markdownRange(original).start === markdownRange(node).start) ?? node);
  }
  if (context) {
    index.definitions = { ...context.definitions, ...index.definitions };
    // outside definitions keep document coordinates and are rendered against the saved source.
    index.footnotes = { ...context.footnotes, ...index.footnotes };
  }
  return { nodes: nodes.map(node => compactNode(node, budget)), index };
}
