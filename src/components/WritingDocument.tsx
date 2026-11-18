import { useContext, useMemo, useState } from 'react';
import { journalModel } from '../journalDocument';
import { writingBlocks, type WritingLocation, type WritingOperation } from '../journalWriting';
import type { SourceRange } from '../markdownPlanner';
import { MarkdownDocumentContext } from '../markdownContext';
import { writingPresentation } from '../writingPresentation';
import type { TodoDocument } from '../todoText';
import { Button, Muted } from '../styles';
import { MarkdownBodyEditor } from './OutlineEditor';

export function WritingDocument({ document, location, label, onWrite, onToggleTask, readOnly = false, onMoveCapture, appendRequest, onOpenEntry }: { onOpenEntry?: (id:string)=>void; appendRequest?: number; document: TodoDocument; location: WritingLocation; label: string; onWrite: (operation: WritingOperation, expected: string) => Promise<void>; onToggleTask?: (start: number) => void; readOnly?: boolean; onMoveCapture?: (range: SourceRange, anchor: HTMLButtonElement) => void }) {
  const parent = useContext(MarkdownDocumentContext), model = journalModel(document), [limit, setLimit] = useState(200);
  const locationKey = JSON.stringify(location);
  const presentation = useMemo(() => writingPresentation(model, location, limit), [model, locationKey, limit]);
  const context = useMemo(() => ({ ...parent, source: model.source, index: model.markdown, bodyViews: presentation.views, hiddenMetadata: presentation.hiddenMetadata, entryIds: presentation.entryIds }), [parent, model, presentation]);
  return <MarkdownDocumentContext.Provider value={context}>
    <MarkdownBodyEditor documentMode onEditRequest={index=>{const block=writingBlocks(model,location)[index];const entry=block?.type==='entry' ? [...model.days,...model.undated].flatMap(group=>group.entries).find(entry=>entry.range.start===block.range.start) : undefined;if(entry && (entry.repeat || entry.replaces) && onOpenEntry){onOpenEntry(entry.id ?? `source:${entry.range.start}`);return true;}return false;}} appendRequest={appendRequest} readOnly={readOnly} label={label} body={presentation.body} draftKey={`hcb-writing-draft:${model.documentId}:${locationKey}`} onToggleTask={onToggleTask} onMoveBlock={onMoveCapture ? (block, anchor) => { const target = writingBlocks(model, location)[block]; if (target) onMoveCapture(target.range, anchor); } : undefined} onSave={async (markdown, block, expected, links) => {
      if (expected !== model.source || block === undefined) throw new Error('This document changed. Download the draft and review the latest content.');
      if (block === presentation.body.length) {
        await onWrite({ kind: 'append', destination: location, markdown, links }, expected);
      } else {
        const target = writingBlocks(model, location)[block];
        if (!target) throw new Error('This block is no longer available. Download the draft and review the document.');
        await onWrite({ kind: 'fragment', location, range: target.range, markdown, links }, expected);
      }
      return true;
    }}/>
    {presentation.total > limit && <p><Muted>{Math.min(limit, presentation.total)} of {presentation.total} blocks shown. </Muted><Button type="button" disabled={limit >= 5000} onClick={() => setLimit(value => Math.min(5000, value + 200))}>Show more</Button></p>}
  </MarkdownDocumentContext.Provider>;
}
