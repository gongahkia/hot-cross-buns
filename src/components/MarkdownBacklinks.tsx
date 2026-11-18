import { useContext } from 'react';
import styled from 'styled-components';
import { MarkdownDocumentContext } from '../markdownContext';

const Mentions = styled.details`margin:6px 0 6px 56px;font-size:12px;color:var(--muted);summary{min-height:36px;cursor:pointer;}button{display:block;min-height:36px;padding:4px 0;border:0;background:transparent;color:var(--link);font:inherit;text-align:left;text-decoration:underline;text-underline-offset:3px;}@media(max-width:540px){margin-left:28px;}@media(pointer:coarse){summary,button{min-height:44px;}}`;

export function MarkdownBacklinks({ itemId }: { itemId: string }) {
  const context = useContext(MarkdownDocumentContext), incoming = context.navigation?.incomingByItem.get(itemId);
  if (!incoming?.length) return null;
  return <Mentions><summary>Linked mentions ({incoming.length})</summary>{incoming.map((link, index) => <button key={index} type="button" onClick={() => context.jump?.({ ...link.target, kind: 'passage', range: link.range })}>{link.target.label}{link.target.date ? ` · ${link.target.date}` : link.target.list ? ` · ${link.target.list}` : ''}</button>)}</Mentions>;
}
