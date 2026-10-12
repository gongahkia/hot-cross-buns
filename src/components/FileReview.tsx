import styled from 'styled-components';
import { Button, InlineError } from '../styles';
import type { ParseIssue, TodoItem } from '../todoText';
import type { MergeChoice, MergeProposal } from '../todoMerge';
import type { TodoFileHandle } from '../todoStore';
import { Modal } from './Modal';

export type FileReviewState = { raw: string; proposal: MergeProposal; handle: TodoFileHandle | null; mode: 'import' | 'save'; observedText: string | null };

const Title = styled.h2`font-size: 22px; margin-bottom: 12px;`;
const Actions = styled.div`display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-top: 20px;`;
const Panes = styled.div`display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 10px; @media(max-width:550px){grid-template-columns: 1fr;}`;
const Pane = styled.div`min-width: 0; min-height: 75px; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere;`;
const PaneLabel = styled.strong`display: block; margin-bottom: 7px; color: var(--muted); font-size: 11px; letter-spacing: .05em; text-transform: uppercase;`;
const ReviewRow = styled.div`padding: 13px 0; border-bottom: 1px solid var(--line);`;
const ReviewChoices = styled.div`display: flex; gap: 12px; flex-wrap: wrap; margin-top: 8px; font-size: 12px;`;
const ChoiceLabel = styled.label`display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 4px 8px; border: 1px solid var(--line); border-radius: 6px; cursor: pointer; @media(pointer:coarse){min-height:44px;}`;
const RawText = styled.textarea`width: 100%; min-height: 200px; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--field); font: 12px/1.5 ui-monospace,monospace; resize: vertical;`;
const Note = styled.p`font-size: 12px; color: var(--muted);`;

const itemLabel = (item: TodoItem | null) => item ? `${item.completed ? 'done' : 'upcoming'}  ${item.text}${item.details.map(detail => `\n  - ${detail}`).join('')}` : '(deleted / absent)';

export function FileReview({ review, issues, rawEdit, choices, busy, onClose, onRawEdit, onChoice, onReparse, onApply }: {
  review: FileReviewState | null; issues: ParseIssue[]; rawEdit: string; choices: Record<string, MergeChoice>; busy: boolean;
  onClose: () => void; onRawEdit: (value: string) => void; onChoice: (key: string, choice: MergeChoice) => void;
  onReparse: () => void; onApply: () => void;
}) {
  return <Modal open={!!review} onClose={onClose} title="Review TODO.txt import" wide>
    <Title>{review?.mode === 'save' ? 'Review file changes' : 'Review TODO.txt import'}</Title>
    {!!issues.length ? <>
      <InlineError>{issues.length} format issue{issues.length === 1 ? '' : 's'} need correction before import.</InlineError>
      {issues.map(issue => <Note key={`${issue.line}-${issue.message}`}>Line {issue.line}: {issue.message}</Note>)}
      <RawText aria-label="Edit imported TODO.txt" value={rawEdit} onChange={event => onRawEdit(event.target.value)}/>
      <Actions><Button onClick={onClose}>cancel</Button><Button $primary onClick={onReparse}>check file</Button></Actions>
    </> : <>
      <Note>{review?.proposal.conflicts.length ?? 0} item{review?.proposal.conflicts.length === 1 ? '' : 's'} need a decision. Clear changes will merge automatically.</Note>
      {review?.proposal.conflicts.map(row => <ReviewRow key={row.key}>
        <Note>{row.date}{row.reorderConflict ? ' · order changed on both sides' : ''}</Note>
        <Panes>
          <Pane><PaneLabel>Jing</PaneLabel>{row.reorderConflict && `position ${row.localOrder + 1}\n`}{itemLabel(row.local)}</Pane>
          <Pane><PaneLabel>TODO.txt</PaneLabel>{row.reorderConflict && `position ${row.fileOrder + 1}\n`}{itemLabel(row.file)}</Pane>
        </Panes>
        <ReviewChoices>{(['local','file','both'] as const).map(choice => <ChoiceLabel key={choice}>
          <input type="radio" name={row.key} checked={(choices[row.key] ?? '') === choice} onChange={() => onChoice(row.key, choice)}/>
          {choice === 'local' ? 'keep Jing' : choice === 'file' ? 'use file' : 'keep both'}
        </ChoiceLabel>)}</ReviewChoices>
      </ReviewRow>)}
      <Actions><Button onClick={onClose}>cancel</Button><Button $primary disabled={busy || (review?.proposal.conflicts.some(row => !choices[row.key]) ?? false)} onClick={onApply}>{review?.mode === 'save' ? 'merge and save' : 'apply import'}</Button></Actions>
    </>}
  </Modal>;
}
