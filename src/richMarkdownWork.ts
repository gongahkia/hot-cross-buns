import type { Root } from 'hast';

export type RichMarkdownWork = { kind: 'math'; source: string; display: boolean } | { kind: 'highlight'; source: string; language: string };
export type RichMarkdownResult = { kind: 'math'; html: string } | { kind: 'highlight'; tree: Root };
export const RICH_MARKDOWN_LIMITS = { math: 2000, code: 12_000, output: 500_000, nodes: 3000, timeout: 3000, outstanding: 8 } as const;
let highlighter: ReturnType<typeof import('lowlight')['createLowlight']> | undefined;

export async function runRichMarkdownWork(work: RichMarkdownWork): Promise<RichMarkdownResult> {
  if (work.kind === 'math') {
    if (work.source.length > RICH_MARKDOWN_LIMITS.math) throw new Error('This formula exceeds the rendering limit; its source is available.');
    const { renderToString } = await import('katex');
    const html = renderToString(work.source, { displayMode: work.display, throwOnError: true, trust: false, strict: 'error', maxExpand: 100, maxSize: 10, macros: Object.create(null) });
    if (html.length > RICH_MARKDOWN_LIMITS.output) throw new Error('This formula produced too much output; its source is available.');
    return { kind: 'math', html };
  }
  if (work.source.length > RICH_MARKDOWN_LIMITS.code) throw new Error('This code block exceeds the highlighting limit; its source is available.');
  if (!highlighter) { const { common, createLowlight } = await import('lowlight'); highlighter = createLowlight(common); }
  if (!highlighter.registered(work.language)) return { kind: 'highlight', tree: { type: 'root', children: [{ type: 'text', value: work.source }] } };
  const tree = highlighter.highlight(work.language, work.source), pending: Array<{ node: object; depth: number }> = [{ node: tree, depth: 0 }];
  let nodes = 0;
  while (pending.length) { const { node, depth } = pending.pop()!; if (++nodes > RICH_MARKDOWN_LIMITS.nodes || depth > 32) throw new Error('This code block produced too much highlighting; its source is available.'); if ('children' in node) for (const child of node.children as object[]) pending.push({ node: child, depth: depth + 1 }); }
  if (JSON.stringify(tree).length > RICH_MARKDOWN_LIMITS.output) throw new Error('This code block produced too much output; its source is available.');
  return { kind: 'highlight', tree };
}
