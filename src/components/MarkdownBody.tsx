import { createElement, useMemo, type ReactNode } from 'react';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Nodes } from 'mdast';
import styled from 'styled-components';

const parser = unified().use(remarkParse).use(remarkGfm);
const Content = styled.div`font-size:14px;line-height:1.6;overflow-wrap:anywhere;min-width:0;p,ul,ol,blockquote,pre,table{margin:8px 0;}ul,ol{padding-left:22px;}blockquote{padding-left:12px;border-left:1px solid var(--line);color:var(--muted);}pre{max-width:100%;overflow:auto;white-space:pre-wrap;font:12px/1.6 var(--raw-font);}code{font-family:var(--raw-font);}table{display:block;max-width:100%;overflow:auto;border-collapse:collapse;}td,th{padding:5px 8px;border:1px solid var(--line);text-align:left;}a{color:var(--link);text-decoration:underline;text-underline-offset:3px;}h1,h2,h3,h4,h5,h6{font-size:1em;margin:12px 0 6px;}img{display:none;}`;
const safeUrl = (url: string) => /^(?:https?:\/\/|mailto:|#[a-z0-9-])/i.test(url) ? url : undefined;

export function MarkdownBody({ markdown }: { markdown: string }) {
  const content = useMemo(() => {
    if (markdown.length > 40_000) return <pre>{markdown}</pre>;
    const root = parser.parse(markdown);
    const definitions = new Map(root.children.flatMap(node => node.type === 'definition' ? [[node.identifier, node.url] as const] : []));
    let remaining = 2000;
    const render = (node: Nodes, key: number, depth = 0): ReactNode => {
      if (--remaining < 0 || depth > 32) return <pre key={key}>{markdown.slice(node.position?.start.offset, node.position?.end.offset)}</pre>;
      const children = () => 'children' in node ? node.children.map((child, index) => render(child, index, depth + 1)) : null;
      switch (node.type) {
        case 'text': return node.value;
        case 'paragraph': return <p key={key}>{children()}</p>;
        case 'heading': return createElement(`h${node.depth}`, { key }, children());
        case 'strong': return <strong key={key}>{children()}</strong>;
        case 'emphasis': return <em key={key}>{children()}</em>;
        case 'delete': return <del key={key}>{children()}</del>;
        case 'inlineCode': return <code key={key}>{node.value}</code>;
        case 'code': return <pre key={key}><code>{node.value}</code></pre>;
        case 'html': return <pre key={key}>{node.value}</pre>;
        case 'break': return <br key={key}/>;
        case 'thematicBreak': return <hr key={key}/>;
        case 'blockquote': return <blockquote key={key}>{children()}</blockquote>;
        case 'list': return node.ordered ? <ol key={key} start={node.start ?? undefined}>{children()}</ol> : <ul key={key}>{children()}</ul>;
        case 'listItem': return <li key={key}>{typeof node.checked === 'boolean' && <input type="checkbox" checked={node.checked} disabled aria-label="Checkbox in body preview"/>}{children()}</li>;
        case 'link': case 'linkReference': {
          const url = node.type === 'link' ? node.url : definitions.get(node.identifier);
          const href = url && safeUrl(url);
          return href ? <a key={key} href={href} target={href.startsWith('#') ? undefined : '_blank'} rel="noreferrer">{children()}</a> : <span key={key}>{children()}</span>;
        }
        case 'image': case 'imageReference': return <span key={key}>[Image: {node.alt || 'no description'}]</span>;
        case 'table': return <table key={key}><thead><tr>{node.children[0]?.children.map((cell, index) => <th key={index}>{cell.children.map((child, index) => render(child, index, depth + 1))}</th>)}</tr></thead><tbody>{node.children.slice(1).map((row, index) => render(row, index, depth + 1))}</tbody></table>;
        case 'tableRow': return <tr key={key}>{children()}</tr>;
        case 'tableCell': return <td key={key}>{children()}</td>;
        case 'footnoteReference': return <sup key={key}>{node.label ?? node.identifier}</sup>;
        case 'footnoteDefinition': return <div key={key}><sup>{node.label ?? node.identifier}</sup>{children()}</div>;
        case 'definition': return null;
        default: return <span key={key}>{children()}</span>;
      }
    };
    return root.children.map((node, index) => render(node, index));
  }, [markdown]);
  return <Content>{content}</Content>;
}
