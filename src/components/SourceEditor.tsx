import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { Button, InlineError, Muted } from '../styles';
import { readJournal } from '../journalDocument';
import { downloadTextFile } from '../files';
import { Modal } from './Modal';

const Editor = styled.textarea`display:block;width:100%;min-height:min(60dvh,600px);padding:8px 2px;resize:vertical;border:0;background:transparent;color:var(--ink);font:14px/1.55 ui-monospace,monospace;tab-size:2;@media(pointer:coarse){font-size:16px;}`;
const Actions = styled.div`display:flex;justify-content:flex-end;flex-wrap:wrap;gap:8px;margin-top:16px;`;

export function SourceEditor({ open, source, onClose, onSave }: { open: boolean; source: string; onClose: () => void; onSave: (source: string, expected: string) => Promise<void> }) {
  const [draft,setDraft] = useState(source), [error,setError] = useState(''), [busy,setBusy] = useState(false);
  const [renderContents,setRenderContents] = useState(open);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const current = useRef({ draft: source, expected: source, key: '', open: false });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const checkpoint = () => {
    clearTimeout(timer.current);
    const value = current.current;
    if (!value.key || value.draft === value.expected) return;
    try { sessionStorage.setItem(value.key, JSON.stringify({ protocol: 1, base: value.expected, source: value.draft })); }
    catch { if (value.open) setError('Could not checkpoint this source draft. Keep this dialog open or download the draft before leaving.'); }
  };
  useEffect(() => {
    if (!open) return;
    setRenderContents(true);
    const key = `hot-cross-buns-markdown-draft:${readJournal(source).model.documentId}`;
    let recovered: string | null = null;
    try { recovered = sessionStorage.getItem(key); } catch { /* the in-memory draft remains usable. */ }
    let draft = source, expected = source, warning = '';
    if (recovered !== null) {
      try {
        const saved = JSON.parse(recovered) as { protocol?: number; base?: string; source?: string };
        if (saved.protocol !== 1 || typeof saved.base !== 'string' || typeof saved.source !== 'string' || readJournal(saved.base).model.documentId !== readJournal(source).model.documentId) throw new Error('Unsupported draft checkpoint.');
        draft = saved.source; expected = saved.base;
        if (draft !== source) warning = expected === source ? 'A previous source draft was recovered. Review it before saving.' : 'The saved journal changed since this draft. Download the draft for review, or discard it to use the current source.';
      } catch { draft = recovered; warning = 'The draft checkpoint is unreadable. Its raw contents are shown for download and recovery; the saved journal has not changed.'; }
    }
    current.current = { draft, expected, key, open: true };
    setDraft(draft); setError(warning);
    const unload = (event: BeforeUnloadEvent) => { if (current.current.draft !== current.current.expected) { checkpoint(); event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload',unload);
    return () => { checkpoint(); current.current.open = false; window.removeEventListener('beforeunload',unload); };
  }, [open]);
  useEffect(() => {
    const dialog = dialogRef.current!;
    const closed = () => setRenderContents(false);
    dialog.addEventListener('close',closed);
    return () => dialog.removeEventListener('close',closed);
  }, []);
  const save = async () => {
    setBusy(true); setError(''); checkpoint();
    try {
      await onSave(current.current.draft,current.current.expected);
      current.current.expected = current.current.draft;
      try { sessionStorage.removeItem(current.current.key); } catch { /* a recovered draft can be reviewed again. */ }
      onClose();
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  };
  return <Modal journalEditor dialogRef={dialogRef} open={open} onClose={() => { if (!busy) { checkpoint(); onClose(); } }} title="Edit Markdown source" wide>{(open || renderContents) && <>
    <h2>Markdown source</h2>
    <p><Muted>This is the complete document, including notes and scratchpad. Structured views and syncing use the same saved source.</Muted></p>
    {error && <InlineError role="alert">{error}</InlineError>}
    <Editor aria-label="Markdown source" spellCheck={false} value={draft} readOnly={busy} onChange={event => {
      const text = event.target.value; current.current.draft = text; setDraft(text);
      clearTimeout(timer.current); timer.current = setTimeout(checkpoint,250);
    }}/>
    <Actions><Button onClick={() => downloadTextFile(current.current.draft,'Planner-source-draft.md')}>Download draft</Button><Button disabled={busy} onClick={() => { try { sessionStorage.removeItem(current.current.key); } catch { /* keep the saved source visible. */ } current.current = { draft: source, expected: source, key: `hot-cross-buns-markdown-draft:${readJournal(source).model.documentId}`, open: true }; setDraft(source); setError(''); }}>Discard source draft</Button><Button disabled={busy} onClick={() => { checkpoint(); onClose(); }}>Close</Button><Button $primary disabled={busy} onClick={() => void save()}>Save Markdown</Button></Actions>
  </>}</Modal>;
}
