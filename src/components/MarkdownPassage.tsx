import { useContext, useMemo, useRef } from 'react';
import styled from 'styled-components';
import { MarkdownDocumentContext } from '../markdownContext';
import { markdownKey } from '../markdown';
import type { MarkdownLinkPreparation, MarkdownTarget } from '../markdownNavigation';
import type { SourceRange } from '../markdownPlanner';
import { Button, Muted } from '../styles';
import { Modal } from './Modal';
import { MarkdownBodyEditor } from './OutlineEditor';

const Passage = styled.div`min-width:0;&>details{margin:0;}&>details>summary{display:none;}`;
const Actions = styled.div`display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:16px;`;

export function MarkdownPassage({ target, onClose, onSave, onSource }: { target: MarkdownTarget; onClose: () => void; onSave: (markdown: string, expected: string, range: SourceRange, links: MarkdownLinkPreparation[]) => Promise<void>; onSource: () => void }) {
  const context = useContext(MarkdownDocumentContext), dialog = useRef<HTMLDialogElement>(null);
  const passages = useMemo(() => {
    const roots = context.index?.passages ?? [];
    const start = roots.findIndex(root => root.range.start <= target.range.start && root.range.end > target.range.start);
    if (start < 0) return [];
    const first = roots[start], depth = context.index?.headings.find(heading => heading.range.start === first.range.start);
    let end = start + 1;
    if (depth) while (end < roots.length && end - start < 20 && roots[end].type !== 'heading' && roots[end].range.end - first.range.start < 40_000) end++;
    return roots.slice(start, end).filter(root => !['definition', 'footnoteDefinition'].includes(root.type));
  }, [context.index, target]);
  const body = useMemo(() => passages.map(passage => ({ markdown: context.source.slice(passage.range.start, passage.range.end), sourceRef: `document:${markdownKey(passage.range)}` })), [passages, context.source]);
  return <Modal open title={target.label || 'Markdown passage'} onClose={onClose} dialogRef={dialog} wide journalEditor>
    <Passage>{body.length ? <MarkdownBodyEditor key={target.fragment ?? target.range.start} expanded blockOnly label={target.label || 'Document passage'} body={body} draftKey={`hcb-passage-draft:${context.id}:${target.fragment ?? target.range.start}`} onSave={async (markdown, block, expected, links) => {
      if (block === undefined || !passages[block] || !expected || expected !== context.source) throw new Error('This passage changed. Download the draft and review the latest source.');
      const { start, end } = passages[block].range;
      await onSave(markdown, expected, { start, end }, links ?? []);
      return true;
    }}/> : <Muted>This passage is no longer available. Open the source to review it.</Muted>}</Passage>
    <Actions><Button type="button" onClick={onSource}>Edit source</Button><Button type="button" onClick={onClose}>Close</Button></Actions>
  </Modal>;
}
