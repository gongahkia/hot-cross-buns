import { decodeString } from 'micromark-util-decode-string';
import remarkMath from 'remark-math';
import type { Nodes, Root } from 'mdast';
import { createMarkdownParser, markdownText, type MarkdownNode, type MarkdownRange } from './markdown.ts';

function continuationOffset(line: string, column: number, quotes: number): number {
  let index = 0, width = 0;
  while (index < line.length && width < column) {
    const char = line[index];
    if (char === ' ' || char === '\t') { width += char === '\t' ? 4 - width % 4 : 1; index++; }
    else if (char === '>' && quotes > 0) { width++; index++; quotes--; }
    else break;
  }
  return index;
}

/** retain original UTF-16 coordinates while removing Markdown container prefixes. */
function literal(source: string, range: MarkdownRange, column: number, quotes: number) {
  const raw = source.slice(range.start, range.end), starts: number[] = [], ends: number[] = [], parts: string[] = [];
  for (let index = 0; index < raw.length; index++) {
    const start = index, char = raw[index];
    if (char === '\r' || char === '\n') {
      if (char === '\r' && raw[index + 1] === '\n') index++;
      parts.push('\n'); starts.push(range.start + start); ends.push(range.start + index + 1);
      index += continuationOffset(raw.slice(index + 1), column, quotes);
    } else { parts.push(char); starts.push(range.start + index); ends.push(range.start + index + 1); }
  }
  return { text: parts.join(''), range: (start: number, end: number): MarkdownRange => ({ start: starts[start] ?? range.end, end: ends[end - 1] ?? range.end }) };
}

type MathParagraph = { root: Root; input: ReturnType<typeof literal>; context: string };
const mathCache = new WeakMap<Nodes, MathParagraph | null>();
let mathParser: { parse: (source: string) => Root } | undefined;
function mathParagraph(node: Nodes, source: string, quotes: number, context = ''): MathParagraph | undefined {
  if (node.type !== 'paragraph') return;
  const cached = mathCache.get(node);
  if (cached === null || cached?.context === context) return cached ?? undefined;
  const range = { start: node.position!.start.offset!, end: node.position!.end.offset! };
  if (range.end - range.start > 40_000 || !source.slice(range.start, range.end).includes('$$')) { mathCache.set(node, null); return; }
  const input = literal(source, range, node.position!.start.column - 1, quotes);
  mathParser ??= createMarkdownParser().use(remarkMath, { singleDollarTextMath: false });
  const root = mathParser.parse(context ? `${input.text}\n\n${context}` : input.text);
  if (context) {
    let fallback: Root | undefined;
    root.children = root.children.filter(child => child.position!.start.offset! < input.text.length).map(child => {
      if (child.position!.end.offset! <= input.text.length) return child;
      fallback ??= mathParser!.parse(input.text);
      return fallback.children.find(original => original.position!.start.offset === child.position!.start.offset) ?? child;
    });
  }
  const result = { input, root, context };
  const pending: Nodes[] = [...result.root.children];
  let found = false;
  while (pending.length) { const child = pending.pop()!; if (child.type === 'math' || child.type === 'inlineMath') found = true; if ('children' in child) for (const nested of child.children) pending.push(nested); }
  mathCache.set(node, found ? result : null);
  return found ? result : undefined;
}

export function markdownMathRanges(node: Nodes, source: string, quotes = 0, context = ''): MarkdownRange[] {
  const parsed = mathParagraph(node, source, quotes, context);
  if (!parsed) return [];
  const ranges: MarkdownRange[] = [], pending: Nodes[] = [parsed.root];
  while (pending.length) { const child = pending.pop()!; if (child.type === 'math' || child.type === 'inlineMath') ranges.push(parsed.input.range(child.position!.start.offset!, child.position!.end.offset!)); if ('children' in child) for (const nested of child.children) pending.push(nested); }
  return ranges;
}

function afterHeader(node: MarkdownNode, end: number, source: string, column: number, quotes: number): MarkdownNode | undefined {
  if (node.range.end <= end) return;
  if (node.range.start >= end) return node;
  if (node.children) {
    const children = node.children.flatMap(child => { const next = afterHeader(child, end, source, column, quotes); return next ? [next] : []; });
    return children.length ? { ...node, range: { start: children[0].range.start, end: node.range.end }, children } : undefined;
  }
  if (node.type === 'text') {
    const start = end + continuationOffset(source.slice(end, node.range.end), column, quotes);
    return start < node.range.end ? { type: 'text', value: decodeString(literal(source, { start, end: node.range.end }, column, quotes).text), range: { start, end: node.range.end } } : undefined;
  }
}

/** render-only extensions leave planning semantics and exact Markdown source untouched. */
export function extendMarkdownNode(original: Nodes, node: MarkdownNode, source: string, quotes: number, compact: (node: Nodes) => MarkdownNode, context = ''): MarkdownNode {
  if (!source) return node;
  const math = mathParagraph(original, source, quotes, context);
  if (math) {
    const children = math.root.children.map(child => compact(child));
    const pending = [...children];
    while (pending.length) { const child = pending.pop()!; child.range = math.input.range(child.range.start, child.range.end); if (child.children) for (const nested of child.children) pending.push(nested); }
    return children.length === 1 ? children[0] : { type: 'group', range: node.range, children };
  }
  if (original.type === 'blockquote' && original.children[0]?.type === 'paragraph') {
    const paragraph = original.children[0], raw = literal(source, { start: paragraph.position!.start.offset!, end: paragraph.position!.end.offset! }, paragraph.position!.start.column - 1, quotes + 1);
    const header = /^\[!([a-z][a-z0-9-]*)\]([+-])?(?:[ \t]+([^\n]*))?(?:\n|$)/i.exec(raw.text);
    if (header) {
      const kind = header[1].toLowerCase(), first = node.children?.[0];
      const end = raw.range(0, header[0].length).end;
      const remaining = first && afterHeader(first, end, source, paragraph.position!.start.column - 1, quotes + 1);
      const title = markdownText(paragraph).split('\n')[0].replace(/^\[![a-z][a-z0-9-]*\][+-]?[ \t]*/i, '').trim();
      return { ...node, type: 'callout', callout: { kind, title: title || kind[0].toUpperCase() + kind.slice(1), ...(header[2] ? { fold: header[2] === '+' ? 'open' : 'closed' } : {}) }, children: [...(remaining ? [remaining] : []), ...(node.children?.slice(1) ?? [])] };
    }
  }
  return node;
}
