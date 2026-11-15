import { useEffect, useState } from 'react';
import { Button, Field, InlineError, Muted } from '../styles';
import { downloadTextFile } from '../files';
import { Modal } from './Modal';

export function SaveRecovery({ error, text, kind, onRetry, onDiscard }: {
  error: string | null; text: string; kind: 'journal' | 'scratchpad';
  onRetry: () => void; onDiscard: () => Promise<void>;
}) {
  const [notice, setNotice] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  useEffect(() => { setNotice(''); setConfirmDiscard(false); }, [error]);
  return <Modal journalEditor={kind === 'journal'} open={error !== null} onClose={() => {}} title={'Unsaved ' + kind} wide>
    <h2>Unsaved {kind}</h2>
    <InlineError role="alert">{error}</InlineError>
    <Muted>Your edits are still here. Retry saving, or copy or download them before discarding.</Muted>
    <Field as="textarea" readOnly aria-label={'Unsaved ' + kind + ' text'} value={text} rows={8} style={{ margin: '12px 0', resize: 'vertical', fontFamily: 'var(--raw-font)' }}/>
    {notice && <Muted role="status">{notice}</Muted>}
    {confirmDiscard ? <>
      <Muted>Discard all unsaved {kind} edits in this tab and return to the saved version?</Muted>
      <Button type="button" disabled={discarding} onClick={() => setConfirmDiscard(false)}>Keep unsaved edits</Button>
      <Button type="button" disabled={discarding} onClick={() => {
        setDiscarding(true);
        void onDiscard().catch(cause => setNotice('Could not reopen saved data: ' + String(cause))).finally(() => setDiscarding(false));
      }}>Confirm discard</Button>
    </> : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <Button $primary type="button" autoFocus onClick={onRetry}>Retry saving</Button>
      <Button type="button" onClick={async () => {
        try { await navigator.clipboard.writeText(text); setNotice('Unsaved text copied.'); }
        catch { setNotice('Clipboard access was denied. Download the unsaved text instead.'); }
      }}>Copy unsaved text</Button>
      <Button type="button" onClick={() => {
        try { downloadTextFile(text, kind === 'journal' ? 'TODO-unsaved.txt' : 'scratchpad-unsaved.txt'); setNotice('Unsaved text download started.'); }
        catch (cause) { setNotice('Could not download: ' + String(cause)); }
      }}>Download unsaved text</Button>
      <Button type="button" onClick={() => setConfirmDiscard(true)}>Discard unsaved edits</Button>
    </div>}
  </Modal>;
}
