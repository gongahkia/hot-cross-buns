import { createElement, useContext, useId, useMemo, useState, type ReactNode } from 'react';
import styled from 'styled-components';
import { Pencil } from 'lucide-react';
import { headingSlug, parseMarkdownPreview, safeMarkdownUrl, type MarkdownNode } from '../markdown';
import { MarkdownDocumentContext } from '../markdownContext';
import type { TodoBody } from '../todoText';

const Content = styled.div`font-size:14px;line-height:1.6;overflow-wrap:anywhere;min-width:0;p,ul,ol,blockquote,pre,table{margin:8px 0;}ul,ol{padding-left:22px;}blockquote{padding-left:12px;border-left:1px solid var(--line);color:var(--muted);}pre{max-width:100%;overflow:auto;white-space:pre-wrap;font:12px/1.6 var(--raw-font);}code{font-family:var(--raw-font);}table{display:block;max-width:100%;overflow:auto;border-collapse:collapse;}td,th{padding:5px 8px;border:1px solid var(--line);}a{color:var(--link);text-decoration:underline;text-underline-offset:3px;}h1,h2,h3,h4,h5,h6{font-size:1em;margin:12px 0 6px;scroll-margin-top:80px;}img{display:block;max-width:100%;max-height:480px;object-fit:contain;}[data-footnotes]{margin-top:16px;padding-top:8px;border-top:1px solid var(--line);font-size:12px;}[data-footnotes] li{scroll-margin-top:80px;}sup a{padding:2px;}`;
const ImageButton = styled.button`min-height:36px;padding:4px 0;border:0;background:transparent;color:var(--link);font:inherit;text-align:left;text-decoration:underline;text-underline-offset:3px;@media(pointer:coarse){min-height:44px;}`;
const Block = styled.div`position:relative;min-width:0;padding-right:32px;[data-block-edit]{opacity:0;}&:hover [data-block-edit],&:focus-within [data-block-edit]{opacity:1;}@media(hover:none){[data-block-edit]{opacity:1;}}@media(pointer:coarse){padding-right:44px;}`;
const BlockEdit = styled.button`position:absolute;right:0;top:4px;display:grid;place-items:center;width:28px;min-height:32px;padding:4px;border:0;border-radius:4px;background:transparent;color:var(--muted);&:hover,&:focus-visible{background:var(--soft);color:var(--ink);}@media(pointer:coarse){width:44px;min-height:44px;}`;

function MarkdownImage({ url, alt, title }: { url?: string; alt?: string; title?: string }) {
  const [loaded, setLoaded] = useState(false), [failed, setFailed] = useState(false);
  const href = url && safeMarkdownUrl(url), description = alt || 'no description';
  if (!href || !/^https?:\/\//i.test(href)) return <span>[Image: {description}]</span>;
  if (!loaded || failed) return <ImageButton type="button" onClick={() => { setLoaded(true); setFailed(false); }}>{failed ? 'Retry image' : 'Load image'}: {description}</ImageButton>;
  return <img src={href} alt={alt ?? ''} title={title} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)}/>;
}

export function MarkdownBody({ markdown, body, label, onEditBlock, activeBlock, editor }: { markdown: string; body?: TodoBody[]; label?: string; onEditBlock?: (index: number) => void; activeBlock?: number | null; editor?: ReactNode }) {
  const context = useContext(MarkdownDocumentContext), scope = useId();
  const content = useMemo(() => {
    const saved = body?.map(block => block.sourceRef ? context.bodyViews?.[block.sourceRef] : undefined);
    const preview = saved?.length && saved.every(Boolean) && context.index ? { nodes: saved as MarkdownNode[], index: context.index } : parseMarkdownPreview(markdown, context.index);
    const source = saved?.length && saved.every(Boolean) ? context.source : markdown;
    const definitions = preview.index.definitions, references = new Map<string, string[]>(), footnotes: string[] = [];
    let remaining = 2000;
    const footnoteId = (identifier: string) => `${scope}-note-${encodeURIComponent(identifier)}`;
    const scrollTo = (id: string) => {
      const target = document.getElementById(id);
      target?.scrollIntoView({ block: 'nearest' }); target?.focus({ preventScroll: true });
    };
    const render = (node: MarkdownNode, key: number, depth = 0, nodeSource = source): ReactNode => {
      if (--remaining < 0 || depth > 32) return <pre key={key}>{nodeSource.slice(node.range.start, node.range.end)}</pre>;
      const children = () => node.children?.map((child, index) => render(child, index, depth + 1, nodeSource));
      switch (node.type) {
        case 'source': return <pre key={key}>{nodeSource.slice(node.range.start, node.range.end)}</pre>;
        case 'text': return node.value;
        case 'paragraph': return <p key={key}>{children()}</p>;
        case 'heading': {
          const heading = preview.index.headings.find(heading => heading.range.start === node.range.start);
          const anchor = heading?.id ?? headingSlug(nodeSource.slice(node.range.start, node.range.end));
          return createElement(`h${node.depth}`, { key, tabIndex: -1, 'data-markdown-anchor': anchor }, children());
        }
        case 'strong': return <strong key={key}>{children()}</strong>;
        case 'emphasis': return <em key={key}>{children()}</em>;
        case 'delete': return <del key={key}>{children()}</del>;
        case 'inlineCode': return <code key={key}>{node.value}</code>;
        case 'code': return <pre key={key}><code>{node.value}</code></pre>;
        case 'html': return <pre key={key}>{node.value}</pre>;
        case 'break': return <br key={key}/>;
        case 'thematicBreak': return <hr key={key}/>;
        case 'blockquote': return <blockquote key={key}>{children()}</blockquote>;
        case 'list': return node.ordered ? <ol key={key} start={node.start}>{children()}</ol> : <ul key={key}>{children()}</ul>;
        case 'listItem': return <li key={key}>{typeof node.checked === 'boolean' && <input type="checkbox" checked={node.checked} disabled aria-label="Checkbox in body preview"/>}{children()}</li>;
        case 'link': case 'linkReference': {
          const definition = node.identifier && Object.hasOwn(definitions, node.identifier) ? definitions[node.identifier] : undefined;
          const url = node.type === 'link' ? node.url : definition?.url, href = url && safeMarkdownUrl(url);
          return href ? <a key={key} href={href} title={node.title ?? definition?.title} target={href.startsWith('#') ? undefined : '_blank'} rel="noreferrer" onClick={event => {
            if (href.startsWith('#') && context.navigate && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); context.navigate(href); }
          }}>{children()}</a> : <span key={key}>{children()}</span>;
        }
        case 'image': case 'imageReference': {
          const definition = node.identifier && Object.hasOwn(definitions, node.identifier) ? definitions[node.identifier] : undefined;
          return <MarkdownImage key={key} url={node.url ?? definition?.url} alt={node.alt} title={node.title ?? definition?.title}/>;
        }
        case 'table': return <table key={key}><thead><tr>{node.children?.[0]?.children?.map((cell, index) => <th key={index} style={{ textAlign: node.align?.[index] ?? 'left' }}>{cell.children?.map((child, index) => render(child, index, depth + 1, nodeSource))}</th>)}</tr></thead><tbody>{node.children?.slice(1).map((row, index) => <tr key={index}>{row.children?.map((cell, column) => <td key={column} style={{ textAlign: node.align?.[column] ?? 'left' }}>{cell.children?.map((child, index) => render(child, index, depth + 1, nodeSource))}</td>)}</tr>)}</tbody></table>;
        case 'footnoteReference': {
          const identifier = node.identifier!;
          if (!Object.hasOwn(preview.index.footnotes, identifier)) return <sup key={key}>{node.label ?? identifier}</sup>;
          const refs = references.get(identifier) ?? [], id = `${footnoteId(identifier)}-ref-${refs.length}`;
          if (!references.has(identifier)) { references.set(identifier, refs); footnotes.push(identifier); }
          refs.push(id);
          return <sup key={key}><a id={id} href={`#${footnoteId(identifier)}`} aria-label={`Footnote ${footnotes.indexOf(identifier) + 1}`} onClick={event => { event.preventDefault(); scrollTo(footnoteId(identifier)); }}>{footnotes.indexOf(identifier) + 1}</a></sup>;
        }
        case 'footnoteDefinition': case 'definition': case 'yaml': return null;
        default: return <span key={key}>{children()}</span>;
      }
    };
    const nodes = preview.nodes.map((node, index) => activeBlock === index && editor ? <div key={index}>{editor}</div> : onEditBlock && body?.length === preview.nodes.length ? <Block key={index} tabIndex={-1} data-markdown-start={node.range.start} data-markdown-end={node.range.end}><div>{render(node, index)}</div><BlockEdit data-block-edit data-block-index={index} type="button" aria-label={`Edit block ${index + 1} in ${label ?? 'notes'}`} onClick={() => onEditBlock(index)}><Pencil size={14}/></BlockEdit></Block> : render(node, index));
    const notes: ReactNode[] = [];
    for (let index = 0; index < Math.min(footnotes.length, 100); index++) {
      const identifier = footnotes[index], note = preview.index.footnotes[identifier];
      const nodeSource = context.index?.footnotes[identifier] === note ? context.source : source;
      notes.push(<li key={identifier} id={footnoteId(identifier)} tabIndex={-1}>{note.type === 'source' ? <pre>{nodeSource.slice(note.range.start, note.range.end)}</pre> : note.children?.map((child, index) => render(child, index, 0, nodeSource))}{references.get(identifier)?.map((id, index) => <a key={id} href={`#${id}`} aria-label={`Back to footnote ${footnotes.indexOf(identifier) + 1} reference ${index + 1}`} onClick={event => { event.preventDefault(); scrollTo(id); }}>Back{index ? ` ${index + 1}` : ''}</a>)}</li>);
    }
    return <>{nodes}{!!notes.length && <section data-footnotes aria-label="Footnotes"><ol>{notes}</ol></section>}</>;
  }, [markdown, body, context, scope, label, onEditBlock, activeBlock, editor]);
  return <Content>{content}</Content>;
}
