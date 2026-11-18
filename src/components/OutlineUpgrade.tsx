import { useState } from 'react';
import styled from 'styled-components';
import type { TodoDocument } from '../todoText';
import { Button, InlineError, Muted } from '../styles';
import { Modal } from './Modal';

const Preview = styled.pre`max-height:40dvh;overflow:auto;margin:16px 0;padding:12px;background:var(--paper);border:1px solid var(--line);border-radius:6px;color:var(--ink);font:12px/1.6 var(--raw-font);white-space:pre-wrap;overflow-wrap:anywhere;`;
const Actions = styled.div`display:flex;justify-content:flex-end;gap:8px;margin-top:16px;button{min-height:44px;}`;

export function OutlineUpgrade({ preview, onClose, onApply }: { preview: { document: TodoDocument; expected: string; checkboxChanges: number } | null; onClose: () => void; onApply: (document: TodoDocument, expected: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <Modal journalEditor open={!!preview} onClose={() => { if (!busy) { setError(''); onClose(); } }} title="Enable deeper outlines" wide>{preview && <>
    <h2>Enable deeper outlines</h2>
    <p><Muted>Nested tasks will participate in their parent’s completion. Plain notes stay separate. This updates the Markdown format; older app versions cannot edit the upgraded file. You can undo this change.</Muted></p>
    <p>{preview.checkboxChanges ? `${preview.checkboxChanges} ancestor ${preview.checkboxChanges === 1 ? 'checkbox changes' : 'checkboxes change'} to match the existing descendants.` : 'Existing checkbox states stay the same.'}</p>
    <Preview aria-label="Outline upgrade preview">{preview.document.source}</Preview>
    {error && <InlineError role="alert">{error}</InlineError>}
    <Actions><Button disabled={busy} onClick={() => { setError(''); onClose(); }}>Cancel</Button><Button $primary disabled={busy} onClick={() => { setBusy(true); setError(''); void onApply(preview.document, preview.expected).then(() => onClose(), error => setError(String(error))).finally(() => setBusy(false)); }}>{busy ? 'Saving…' : 'Enable deeper outlines'}</Button></Actions>
  </>}</Modal>;
}
