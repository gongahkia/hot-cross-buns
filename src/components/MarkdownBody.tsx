import { createElement, useContext, useId, useMemo, useState, type ReactNode } from 'react';
import styled from 'styled-components';
import { ArrowRight, MoreHorizontal, Pencil } from 'lucide-react';
import { headingSlug, markdownKey, MARKDOWN_RENDER_LIMITS, parseMarkdownPreview, safeMarkdownUrl, type MarkdownNode } from '../markdown';
import { MarkdownDocumentContext } from '../markdownContext';
import type { TodoBody } from '../todoText';
import { MarkdownCode, MarkdownMath } from './MarkdownRich';
import { MarkdownBacklinks } from './MarkdownBacklinks';
import { MarkdownDiagram } from './MarkdownDiagram';

const Content = styled.div<{ $document?: boolean }>`font-size:14px;line-height:1.6;overflow-wrap:anywhere;min-width:0;strong{font-weight:600;}em{font-style:italic;}&& ul{list-style:disc;padding-left:22px;}&& ol{list-style:decimal;padding-left:22px;}&& ul ul{list-style-type:circle;}li:has(>input[type=checkbox]){list-style:none;}li:has(>input[type=checkbox])>p:first-of-type{display:inline;}input[type=checkbox]{margin-right:6px;accent-color:var(--link);}p,ul,ol,blockquote,pre,table{margin:8px 0;}ul,ol{padding-left:22px;}blockquote{padding-left:12px;border-left:1px solid var(--line);color:var(--muted);}pre{max-width:100%;overflow:auto;white-space:pre-wrap;font:12px/1.6 var(--raw-font);}code{font-family:var(--raw-font);}table{display:block;max-width:100%;overflow:auto;border-collapse:collapse;}td,th{padding:5px 8px;border:1px solid var(--line);}a{color:var(--link);text-decoration:underline;text-underline-offset:3px;}h1,h2,h3,h4,h5,h6{font-size:1em;margin:12px 0 6px;scroll-margin-top:80px;}img{display:block;max-width:100%;max-height:480px;object-fit:contain;}[data-footnotes]{margin-top:16px;padding-top:8px;border-top:1px solid var(--line);font-size:12px;}[data-footnotes] li{scroll-margin-top:80px;}sup a{padding:2px;}li:has(>[data-task-control]){list-style:none;}li:has(>[data-task-control])>p:first-of-type{display:inline;}[data-task-control]{display:inline-flex;align-items:center;min-width:32px;min-height:36px;vertical-align:middle;}@media(pointer:coarse){[data-task-control]{min-width:44px;min-height:44px;}}${({ $document }) => $document ? "h1{font-size:1.4em;font-weight:600;margin-top:18px;}h2{font-size:1.2em;font-weight:600;margin-top:16px;}h3,h4,h5,h6{font-weight:600;}&& :is(ul,ol) :is(ul,ol) :is(ul,ol) :is(ul,ol) :is(ul,ol) :is(ul,ol){padding-left:8px;}&& :is(ul,ol) :is(ul,ol) :is(ul,ol) :is(ul,ol) :is(ul,ol) :is(ul,ol) :is(ul,ol) :is(ul,ol) :is(ul,ol){padding-left:0;}" : ""}`;
const ImageButton = styled.button`min-height:36px;padding:4px 0;border:0;background:transparent;color:var(--link);font:inherit;text-align:left;text-decoration:underline;text-underline-offset:3px;@media(pointer:coarse){min-height:44px;}`;
const Block = styled.div<{ $move?: boolean; $editable?: boolean }>`position:relative;min-width:0;padding-right:${({ $move }) => $move ? '64px' : '32px'};${({ $editable }) => $editable ? 'cursor:text;' : ''}[data-block-edit]{opacity:0;}&:hover [data-block-edit],&:focus-within [data-block-edit]{opacity:1;}@media(hover:none){[data-block-edit]{opacity:1;}}@media(pointer:coarse){padding-right:${({ $move }) => $move ? '88px' : '44px'};}`;
const BlockEdit = styled.button`position:absolute;right:0;top:4px;display:grid;place-items:center;width:28px;min-height:32px;padding:4px;border:0;border-radius:4px;background:transparent;color:var(--muted);&:hover,&:focus-visible{background:var(--soft);color:var(--ink);}@media(pointer:coarse){width:44px;min-height:44px;}`;
const BlockMove = styled(BlockEdit)`right:32px;@media(pointer:coarse){right:44px;}`;
const Callout = styled.aside`margin:8px 0;padding:8px 12px;border-radius:6px;background:var(--soft);color:var(--ink);&>strong{display:block;font-weight:600;}&>details>summary{min-height:36px;font-weight:600;cursor:pointer;}@media(pointer:coarse){&>details>summary{min-height:44px;}}`;

const NodeAction = styled.button`float:right;display:inline-grid;place-items:center;width:28px;min-height:32px;margin-left:4px;padding:4px;border:0;border-radius:4px;background:transparent;color:var(--muted);opacity:0;li:hover>&,li:focus-within>&{opacity:1;}&:hover,&:focus-visible{background:var(--soft);color:var(--ink);}@media(hover:none){opacity:1;}@media(pointer:coarse){width:44px;min-height:44px;}`;

function MarkdownImage({ url, alt, title }: { url?: string; alt?: string; title?: string }) {
  const [loaded, setLoaded] = useState(false), [failed, setFailed] = useState(false);
  const href = url && safeMarkdownUrl(url), description = alt || 'no description';
  if (!href || !/^https?:\/\//i.test(href)) return <span>[Image: {description}]</span>;
  if (!loaded || failed) return <ImageButton type="button" onClick={() => { setLoaded(true); setFailed(false); }}>{failed ? 'Retry image' : 'Load image'}: {description}</ImageButton>;
  return <img src={href} alt={alt ?? ''} title={title} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)}/>;
}

export function MarkdownBody({ markdown, body, label, onEditBlock, activeBlock, editor, onToggleTask, documentMode = false, onMoveBlock, onNodeAction }: { onNodeAction?: (start:number,anchor:HTMLButtonElement)=>void; markdown: string; body?: TodoBody[]; label?: string; onEditBlock?: (index: number) => void; activeBlock?: number | null; editor?: ReactNode; onToggleTask?: (start: number) => void; documentMode?: boolean; onMoveBlock?: (index: number, anchor: HTMLButtonElement) => void }) {
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
      if (nodeSource === context.source && context.hiddenMetadata?.has(markdownKey(node.range))) return null;
      if (--remaining < 0 || depth > 32) return <pre key={key}>{nodeSource.slice(node.range.start, node.range.end)}</pre>;
      const children = () => node.children?.map((child, index) => render(child, index, depth + 1, nodeSource));
      switch (node.type) {
        case 'source': return <pre key={key}>{nodeSource.slice(node.range.start, node.range.end)}</pre>;
        case 'text': return node.value;
        case 'paragraph': return <p key={key} tabIndex={nodeSource===context.source ? -1 : undefined} data-markdown-start={nodeSource===context.source ? node.range.start : undefined} data-markdown-end={nodeSource===context.source ? node.range.end : undefined}>{children()}</p>;
        case 'group': return <div key={key}>{children()}</div>;
        case 'heading': {
          const heading = preview.index.headings.find(heading => heading.range.start === node.range.start);
          const anchor = heading?.id ?? headingSlug(nodeSource.slice(node.range.start, node.range.end));
          return createElement(`h${node.depth}`, { key, tabIndex: -1, 'data-markdown-anchor': anchor }, children());
        }
        case 'strong': return <strong key={key}>{children()}</strong>;
        case 'emphasis': return <em key={key}>{children()}</em>;
        case 'delete': return <del key={key}>{children()}</del>;
        case 'inlineCode': return <code key={key}>{node.value}</code>;
        case 'code': return node.lang?.toLowerCase() === 'mermaid' ? <MarkdownDiagram key={key} source={node.value ?? ''}/> : ['math', 'latex', 'tex'].includes(node.lang?.toLowerCase() ?? '') ? <MarkdownMath key={key} source={node.value ?? ''} display fallback={node.value ?? ''}/> : <MarkdownCode key={key} source={node.value ?? ''} language={node.lang}/>;
        case 'math': case 'inlineMath': return <MarkdownMath key={key} source={node.value ?? ''} display={node.type === 'math'} fallback={nodeSource.slice(node.range.start, node.range.end)}/>;
        case 'html': return <pre key={key}>{node.value}</pre>;
        case 'break': return <br key={key}/>;
        case 'thematicBreak': return <hr key={key}/>;
        case 'blockquote': return <blockquote key={key}>{children()}</blockquote>;
        case 'callout': return <Callout key={key} data-callout={node.callout?.kind}>{node.callout?.fold ? <details open={node.callout.fold === 'open'}><summary>{node.callout.title}</summary>{children()}</details> : <><strong>{node.callout?.title}</strong>{children()}</>}</Callout>;
        case 'list': return node.ordered ? <ol key={key} start={node.start}>{children()}</ol> : <ul key={key}>{children()}</ul>;
        case 'listItem': {
          const title = node.children?.[0], text = title?.children?.map(child => child.value ?? nodeSource.slice(child.range.start, child.range.end)).join('') || 'task';
          const toggle = nodeSource === context.source ? onToggleTask : undefined;
          const checkbox = typeof node.checked === 'boolean' ? <input type="checkbox" checked={node.checked} disabled={!toggle} aria-label={toggle ? `${node.checked ? 'Reopen' : 'Complete'} ${text.slice(0, 120)}` : 'Checkbox in body preview'} onChange={() => toggle?.(node.range.start)}/> : null;
          return <li key={key} data-outline-start={node.range.start} data-search-item-id={nodeSource === context.source ? context.entryIds?.[node.range.start] : undefined} tabIndex={nodeSource === context.source && context.entryIds?.[node.range.start] ? -1 : undefined}>{nodeSource===context.source && onNodeAction && context.isOutlineItem?.(node.range.start) && <NodeAction data-writing-node type="button" aria-label={`Actions for ${text.slice(0,120)}`} onClick={event=>onNodeAction(node.range.start,event.currentTarget)}><MoreHorizontal size={15}/></NodeAction>}{checkbox && toggle ? <label data-task-control>{checkbox}</label> : checkbox} {children()}{nodeSource===context.source && context.entryIds?.[node.range.start] && <MarkdownBacklinks itemId={context.entryIds[node.range.start]}/>}</li>;
        }
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
          if (!Object.hasOwn(preview.index.footnotes, identifier) || !references.has(identifier) && footnotes.length >= MARKDOWN_RENDER_LIMITS.footnotes) return <sup key={key} title="Footnote preview limit; open the Markdown source for this note.">{node.label ?? identifier}</sup>;
          const refs = references.get(identifier) ?? [], id = `${footnoteId(identifier)}-ref-${refs.length}`;
          if (!references.has(identifier)) { references.set(identifier, refs); footnotes.push(identifier); }
          refs.push(id);
          return <sup key={key}><a id={id} href={`#${footnoteId(identifier)}`} aria-label={`Footnote ${footnotes.indexOf(identifier) + 1}`} onClick={event => { event.preventDefault(); scrollTo(footnoteId(identifier)); }}>{footnotes.indexOf(identifier) + 1}</a></sup>;
        }
        case 'footnoteDefinition': case 'definition': case 'yaml': return null;
        default: return <span key={key}>{children()}</span>;
      }
    };
    const nodes = preview.nodes.map((node, index) => activeBlock === index && editor ? <div key={index}>{editor}</div> : onEditBlock && body?.length === preview.nodes.length ? <Block key={index} $move={!!onMoveBlock} $editable={documentMode} tabIndex={documentMode ? 0 : -1}
      role={documentMode ? 'group' : undefined} aria-label={documentMode ? `Writing block ${index + 1} in ${label ?? 'document'}` : undefined}
      aria-description={documentMode ? 'Click text or press Enter to edit.' : undefined} aria-keyshortcuts={documentMode ? 'Enter' : undefined}
      data-writing-block={documentMode ? index : undefined} data-markdown-start={node.range.start} data-markdown-end={node.range.end}
      onClick={documentMode ? event => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || window.getSelection()?.isCollapsed === false) return;
        const target = event.target;
        if (!(target instanceof Element) || target.closest('a,button,input,textarea,select,label,summary,[role="button"],[role="link"],[contenteditable],[data-footnotes]')) return;
        onEditBlock(index);
      } : undefined}
      onKeyDown={documentMode ? event => {
        if (event.target !== event.currentTarget || event.nativeEvent.isComposing || event.key !== 'Enter' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
        event.preventDefault(); event.stopPropagation(); onEditBlock(index);
      } : undefined}
    ><div>{render(node, index)}</div>{!documentMode && !(onNodeAction && context.entryIds?.[node.range.start]) && <BlockEdit data-block-edit data-block-index={index} type="button" aria-label={`Edit block ${index + 1} in ${label ?? 'notes'}`} onClick={() => onEditBlock(index)}><Pencil size={14}/></BlockEdit>}{onMoveBlock && <BlockMove data-block-edit type="button" aria-label={`Move block ${index + 1} from ${label ?? 'document'}`} onClick={event => onMoveBlock(index, event.currentTarget)}><ArrowRight size={14}/></BlockMove>}</Block> : render(node, index));
    const notes: ReactNode[] = [];
    for (let index = 0; index < footnotes.length; index++) {
      const identifier = footnotes[index], note = preview.index.footnotes[identifier];
      const nodeSource = context.index?.footnotes[identifier] === note ? context.source : source;
      notes.push(<li key={identifier} id={footnoteId(identifier)} tabIndex={-1}>{note.type === 'source' ? <pre>{nodeSource.slice(note.range.start, note.range.end)}</pre> : note.children?.map((child, index) => render(child, index, 0, nodeSource))}{references.get(identifier)?.map((id, index) => <a key={id} href={`#${id}`} aria-label={`Back to footnote ${footnotes.indexOf(identifier) + 1} reference ${index + 1}`} onClick={event => { event.preventDefault(); scrollTo(id); }}>Back{index ? ` ${index + 1}` : ''}</a>)}</li>);
    }
    return <>{nodes}{!!notes.length && <section data-footnotes aria-label="Footnotes"><ol>{notes}</ol></section>}</>;
  }, [markdown, body, context, scope, label, onEditBlock, activeBlock, editor, onToggleTask, onMoveBlock, onNodeAction]);
  return <Content $document={documentMode}>{content}</Content>;
}
