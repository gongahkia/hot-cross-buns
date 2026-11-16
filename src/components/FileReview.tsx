import styled from 'styled-components';
import { Button, InlineError } from '../styles';
import type { JournalFinding } from '../journalDoctor';
import type { JournalMergeProposal } from '../journalMerge';
import type { MergeChoice } from '../todoMerge';
import { serializeJournal } from '../journalDocument';
import { historyPreview } from '../revisionHistory';
import { downloadTextFile } from '../files';
import { Modal } from './Modal';

export type FileReviewState =
  | { kind: 'doctor'; original: string; checked: string; findings: JournalFinding[] }
  | { kind: 'merge'; raw: string; proposal: JournalMergeProposal; checked?: string };
const Title = styled.h2`font-size:22px;margin-bottom:12px;`;
const Actions = styled.div`display:flex;justify-content:flex-end;flex-wrap:wrap;gap:8px;margin-top:20px;`;
const Panes = styled.div`display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;@media(max-width:550px){grid-template-columns:1fr;}`;
const Pane = styled.div`min-width:0;padding:10px;border-radius:8px;background:var(--paper);font-size:13px;`;
const Label = styled.strong`display:block;margin-bottom:7px;color:var(--muted);font-size:11px;text-transform:uppercase;`;
const Text = styled.pre`max-height:250px;margin:0;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,monospace;`;
const Editor = styled.textarea`width:100%;min-height:240px;padding:10px;border:0;border-radius:8px;background:var(--field);color:var(--ink);font:12px/1.5 ui-monospace,monospace;resize:vertical;@media(pointer:coarse){font-size:16px;}`;
const Note = styled.p`font-size:12px;color:var(--muted);`;
const Choices = styled.div`display:flex;gap:12px;flex-wrap:wrap;margin:12px 0;font-size:12px;label{display:inline-flex;align-items:center;gap:6px;min-height:44px;cursor:pointer;}`;

export function FileReview({ review, rawEdit, choices, busy, onClose, onRawEdit, onChoice, onReparse, onApply, linked = false, error }: {
  error?: string; linked?: boolean; review: FileReviewState | null; rawEdit: string; choices: Record<string, MergeChoice>; busy: boolean;
  onClose: () => void; onRawEdit: (value: string) => void; onChoice: (key: string, choice: MergeChoice) => void;
  onReparse: () => void; onApply: () => void;
}) {
  const doctor = review?.kind === 'doctor' ? review : null;
  const merge = review?.kind === 'merge' ? review : null;
  const local = merge ? serializeJournal(merge.proposal.local) : '';
  const file = doctor?.original ?? merge?.raw ?? '';
  const preview = historyPreview(local, file);
  const manual = !!merge && choices.source === 'both';
  const unchecked = !!doctor && rawEdit !== doctor.checked || manual && rawEdit !== merge?.checked;
  const blocking = doctor?.findings.some(finding => finding.level === 'review') ?? false;
  return <Modal journalEditor open={!!review} onClose={onClose} title="Review Planner.md import" wide>
    <Title>{doctor ? 'Check Markdown import' : 'Review Markdown changes'}</Title>
    {error && <InlineError role="alert">{error}</InlineError>}
    <Note>The complete document includes dated entries, undated lists, notes and the scratchpad. Both observed sources stay available for download.</Note>
    {linked && <Note>Applying this review resumes saving the chosen document to the linked target.</Note>}
    {doctor ? <>
      <div aria-label="Markdown findings">{doctor.findings.slice(0,100).map((finding,index) => <Note key={index}>Line {finding.line} · {finding.level}: {finding.message}</Note>)}</div>
      {doctor.findings.length > 100 && <Note>Showing 100 of {doctor.findings.length} findings.</Note>}
      <details><summary>Original file</summary><Text aria-label="Original imported Planner.md">{file.slice(0,24000)}</Text>{file.length > 24000 && <Note>Preview shortened; download the complete original.</Note>}</details>
    </> : <>
      <Panes><Pane><Label>Browser journal</Label><Text aria-label="Browser version">{preview.before.text}</Text></Pane><Pane><Label>File version</Label><Text aria-label="File version">{preview.after.text}</Text></Pane></Panes>
      {(preview.before.truncated || preview.after.truncated) && <Note>Changed-region previews are shortened. Downloads contain the complete sources.</Note>}
      <Choices>{(['local','file','both'] as const).map(choice => <label key={choice}><input type="radio" name="source" checked={choices.source === choice} onChange={() => onChoice('source',choice)}/>{choice === 'local' ? 'keep browser version' : choice === 'file' ? 'use file' : 'merge manually'}</label>)}</Choices>
    </>}
    {(doctor || manual) && <><Label>{doctor ? 'Working import' : 'Combined Markdown source'}</Label><Editor aria-label={doctor ? 'Edit imported Planner.md' : 'Edit merged Markdown'} value={rawEdit} onChange={event => onRawEdit(event.target.value)}/>{unchecked && <Note>Check the edited source before applying it.</Note>}</>}
    <Actions>
      {merge && <Button onClick={() => downloadTextFile(local,'Planner-browser-before-review.md')}>Download browser version</Button>}
      <Button onClick={() => downloadTextFile(file,'Planner-file-before-review.md')}>Download original file</Button>
      <Button onClick={onClose}>cancel</Button>
      {(doctor || manual) && <Button disabled={busy} onClick={onReparse}>{doctor ? 'check file' : 'check merge'}</Button>}
      <Button $primary disabled={busy || unchecked || blocking || !!merge && !choices.source} onClick={onApply}>apply import</Button>
    </Actions>
  </Modal>;
}
