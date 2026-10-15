import { useState } from 'react';
import styled from 'styled-components';
import { Button, InlineError } from '../styles';
import type { DoctorAction, DoctorFinding } from '../todoDoctor';
import type { TodoItem } from '../todoText';
import type { MergeChoice, MergeProposal } from '../todoMerge';
import { Modal } from './Modal';

export type FileReviewState =
  | { kind: 'doctor'; original: string; checked: string; findings: DoctorFinding[] }
  | { kind: 'merge'; raw: string; proposal: MergeProposal };

const Title = styled.h2`font-size: 22px; margin-bottom: 12px;`;
const Actions = styled.div`display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-top: 20px;`;
const Panes = styled.div`display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 10px; @media(max-width:550px){grid-template-columns: 1fr;}`;
const Pane = styled.div`min-width: 0; min-height: 75px; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere;`;
const PaneLabel = styled.strong`display: block; margin-bottom: 7px; color: var(--muted); font-size: 11px; letter-spacing: .05em; text-transform: uppercase;`;
const ReviewRow = styled.div`padding: 13px 0; border-bottom: 1px solid var(--line);`;
const ReviewChoices = styled.div`display: flex; gap: 12px; flex-wrap: wrap; margin-top: 8px; font-size: 12px;`;
const ChoiceLabel = styled.label`display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 4px 8px; border: 1px solid var(--line); border-radius: 6px; cursor: pointer; @media(pointer:coarse){min-height:44px;}`;
const RawText = styled.textarea`width: 100%; min-height: 200px; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--field); font: 12px/1.5 ui-monospace,monospace; resize: vertical; @media(pointer:coarse){font-size:16px;}`;
const Note = styled.p`font-size: 12px; color: var(--muted);`;
const Original = styled.pre`max-height: 250px; margin: 0; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.5 ui-monospace,monospace;`;
const Finding = styled.div`padding: 9px 0; border-bottom: 1px solid var(--line); font-size: 12px;`;
const FindingActions = styled.div`display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 7px;`;
const DateInput = styled.input`min-height: 40px; padding: 6px; border: 1px solid var(--line); border-radius: 6px; background: var(--field); color: var(--ink); @media(pointer:coarse){min-height:44px;font-size:16px;}`;
const SmallButton = styled(Button)`min-height: 40px; padding: 6px 9px;`;

const itemLabel = (item: TodoItem | null) => item ? `${item.completed ? 'done' : 'upcoming'}  ${item.text}${item.details.map(detail => `\n  - [${detail.completed ? 'x' : ' '}] ${detail.text}`).join('')}` : '(deleted / absent)';

export function FileReview({ review, rawEdit, choices, busy, onClose, onRawEdit, onChoice, onReparse, onApply, onDoctorAction }: {
  review: FileReviewState | null; rawEdit: string; choices: Record<string, MergeChoice>; busy: boolean;
  onClose: () => void; onRawEdit: (value: string) => void; onChoice: (key: string, choice: MergeChoice) => void;
  onReparse: () => void; onApply: () => void; onDoctorAction: (finding: DoctorFinding, action: DoctorAction, value?: string) => void;
}) {
  const [completionDates, setCompletionDates] = useState<Record<string, string>>({});
  const doctor = review?.kind === 'doctor' ? review : null;
  const merge = review?.kind === 'merge' ? review : null;
  const unchecked = !!doctor && rawEdit !== doctor.checked;
  const blocking = doctor?.findings.some(finding => finding.level === 'review') ?? false;
  return <Modal open={!!review} onClose={onClose} title="Review TODO.txt import" wide>
    <Title>{doctor ? 'Check TODO.txt import' : 'Review TODO.txt import'}</Title>
    {doctor ? <>
      <Note>The original file remains unchanged. Review the proposed repairs and edit the working text before applying it to Hito.</Note>
      {unchecked && <InlineError>Text changed. Check the file again before importing.</InlineError>}
      {blocking && <InlineError>{doctor.findings.filter(finding => finding.level === 'review').length} issue{doctor.findings.filter(finding => finding.level === 'review').length === 1 ? '' : 's'} need a decision.</InlineError>}
      <div aria-label="TODO.txt doctor findings">{doctor.findings.map((finding, index) => {
        const key = `${finding.code}-${finding.line}-${index}`;
        return <Finding key={key}>
          <strong>Line {finding.line} · {finding.level === 'repaired' ? 'proposed repair' : 'review'}:</strong> {finding.message}
          {finding.before !== undefined && <div><code>{finding.before}</code> → <code>{finding.after}</code></div>}
          {finding.code === 'divider' && <FindingActions><SmallButton type="button" onClick={() => onDoctorAction(finding, 'mark-upcoming')}>mark this day upcoming</SmallButton><SmallButton type="button" onClick={() => onDoctorAction(finding, 'mark-done')}>mark this day done</SmallButton></FindingActions>}
          {finding.code === 'completion-date' && <FindingActions><DateInput aria-label={`Completion date for line ${finding.line}`} type="date" value={completionDates[key] ?? ''} onChange={event => setCompletionDates(current => ({ ...current, [key]: event.target.value }))}/><SmallButton type="button" disabled={!completionDates[key]} onClick={() => onDoctorAction(finding, 'set-completion-date', completionDates[key])}>set completion date</SmallButton></FindingActions>}
          {finding.code === 'series-id' && <FindingActions><SmallButton type="button" onClick={() => onDoctorAction(finding, 'start-series')}>start a new series here</SmallButton><Note>To link existing occurrences, edit their series name and occurrence number in the working text.</Note></FindingActions>}
        </Finding>;
      })}</div>
      <Panes><Pane><PaneLabel>Original file</PaneLabel><Original aria-label="Original imported TODO.txt">{doctor.original}</Original></Pane><div><PaneLabel>Working import</PaneLabel><RawText aria-label="Edit imported TODO.txt" value={rawEdit} onChange={event => onRawEdit(event.target.value)}/></div></Panes>
      <Actions><Button onClick={onClose}>cancel</Button><Button onClick={onReparse}>check file</Button><Button $primary disabled={busy || unchecked || blocking} onClick={onApply}>apply import</Button></Actions>
    </> : <>
      <Note>{merge?.proposal.conflicts.length ?? 0} item{merge?.proposal.conflicts.length === 1 ? '' : 's'} need a decision. Clear changes will merge automatically.</Note>
      {merge?.proposal.conflicts.map(row => <ReviewRow key={row.key}>
        <Note>{row.date}{row.reorderConflict ? ' · order changed on both sides' : ''}</Note>
        <Panes>
          <Pane><PaneLabel>Hito</PaneLabel>{row.reorderConflict && `position ${row.localOrder + 1}\n`}{itemLabel(row.local)}</Pane>
          <Pane><PaneLabel>TODO.txt</PaneLabel>{row.reorderConflict && `position ${row.fileOrder + 1}\n`}{itemLabel(row.file)}</Pane>
        </Panes>
        <ReviewChoices>{(['local','file','both'] as const).map(choice => <ChoiceLabel key={choice}>
          <input type="radio" name={row.key} checked={(choices[row.key] ?? '') === choice} onChange={() => onChoice(row.key, choice)}/>
          {choice === 'local' ? 'keep Hito' : choice === 'file' ? 'use file' : 'keep both'}
        </ChoiceLabel>)}</ReviewChoices>
      </ReviewRow>)}
      <Actions><Button onClick={onClose}>cancel</Button><Button $primary disabled={busy || (merge?.proposal.conflicts.some(row => !choices[row.key]) ?? false)} onClick={onApply}>apply import</Button></Actions>
    </>}
  </Modal>;
}
