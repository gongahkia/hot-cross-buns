import { useState } from 'react';
import styled from 'styled-components';
import type { TodoDocument } from '../todoText';
import { Button, InlineError, Muted } from '../styles';
import { Modal } from './Modal';
import { downloadTextFile } from '../files';

const Preview = styled.pre`max-height:40dvh;overflow:auto;margin:16px 0;padding:12px;background:var(--paper);border:1px solid var(--line);border-radius:6px;color:var(--ink);font:12px/1.6 var(--raw-font);white-space:pre-wrap;overflow-wrap:anywhere;`;
const Actions = styled.div`display:flex;justify-content:flex-end;gap:8px;margin-top:16px;button{min-height:44px;}`;

export function OutlineUpgrade({ preview, onClose, onApply }: { preview: { document: TodoDocument; expected: string; checkboxChanges: number; writing?: boolean } | null; onClose: () => void; onApply: (document: TodoDocument, expected: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const title = preview?.writing ? 'Enable unified writing' : 'Enable deeper outlines';
  return <Modal journalEditor open={!!preview} onClose={() => { if (!busy) { setError(''); onClose(); } }} title={title} wide>{preview && <>
    <h2>{title}</h2>
    <p><Muted>{preview.writing ? 'Write paragraphs and rich content directly in dates and undated documents. Plain dated bullets become outline items, and checkboxes can be used in either view. Existing attached content stays with its item. ' : 'Nested tasks will participate in their parent’s completion. Plain notes stay separate. '}This updates the Markdown format; older app versions cannot edit the upgraded file. You can undo this change.</Muted></p>
    <p>{preview.checkboxChanges ? `${preview.checkboxChanges} ancestor ${preview.checkboxChanges === 1 ? 'checkbox changes' : 'checkboxes change'} to match the existing descendants.` : 'Existing checkbox states stay the same.'}</p>
    <Preview aria-label={preview.writing ? 'Unified writing upgrade preview' : 'Outline upgrade preview'}>{preview.document.source}</Preview>
    {error && <InlineError role="alert">{error}</InlineError>}
    <Actions>{preview.writing && <Button onClick={() => downloadTextFile(preview.expected, 'Planner-before-unified-writing.md')}>Download original</Button>}<Button disabled={busy} onClick={() => { setError(''); onClose(); }}>Cancel</Button><Button $primary disabled={busy} onClick={() => { setBusy(true); setError(''); void onApply(preview.document, preview.expected).then(() => onClose(), error => setError(String(error))).finally(() => setBusy(false)); }}>{busy ? 'Saving…' : title}</Button></Actions>
  </>}</Modal>;
}
