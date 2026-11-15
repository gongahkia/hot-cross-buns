import { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { Button } from '../styles';
import { downloadTextFile } from '../files';
import { historyPreview, historyRows, type HistorySnapshot } from '../revisionHistory';
import { Modal } from './Modal';

const Title = styled.h2`margin-bottom:8px;font-size:23px;font-weight:600;`;
const Note = styled.p`margin:8px 0 16px;color:var(--muted);font-size:13px;line-height:1.6;overflow-wrap:anywhere;`;
const Label = styled.label`display:grid;gap:8px;font-size:13px;`;
const Select = styled.select`width:100%;min-width:0;min-height:44px;padding:8px;border:0;border-radius:7px;background:var(--field);color:var(--ink);font-size:13px;@media(pointer:coarse){font-size:16px;}`;
const Comparison = styled.div`display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:16px 0;section{min-width:0;}h3{margin-bottom:8px;font-size:13px;font-weight:500;}pre{max-height:32dvh;min-height:90px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;border-radius:8px;background:var(--paper);font:12px/1.6 var(--raw-font);}@media(max-width:500px){grid-template-columns:minmax(0,1fr);pre{max-height:22dvh;}}`;
const Actions = styled.div`display:flex;justify-content:flex-end;flex-wrap:wrap;gap:8px;margin-top:16px;button{min-height:44px;}`;
const ErrorText = styled(Note)`color:var(--ink);`;

export function HistoryRecovery({ open, currentText, onClose, onSettings, onLoad, onRestore, onReview }: {
  open: boolean; currentText: string; onClose: () => void; onSettings: () => void;
  onLoad: () => Promise<HistorySnapshot | null>;
  onRestore: (snapshot: HistorySnapshot, id: string) => Promise<void>;
  onReview: (snapshot: HistorySnapshot, id: string) => Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState<HistorySnapshot | null>(null);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState(''), [confirm, setConfirm] = useState(false);
  const callbacks = useRef({ onLoad, onRestore, onReview }); callbacks.current = { onLoad, onRestore, onReview };
  const sequence = useRef(0);
  const refresh = async () => {
    const token = ++sequence.current; setBusy(true); setError(''); setConfirm(false);
    try { const value = await callbacks.current.onLoad(); if (sequence.current === token) { setSnapshot(value); setSelected(value ? historyRows(value)[0]?.record.id ?? '' : ''); } }
    catch (error) { if (sequence.current === token) { setSnapshot(null); setError(String(error)); } }
    finally { if (sequence.current === token) setBusy(false); }
  };
  useEffect(() => {
    if (open) { setSnapshot(null); void refresh(); }
    else { setSnapshot(null); setSelected(''); setConfirm(false); setError(''); }
    return () => { sequence.current++; };
  }, [open]);
  const rows = useMemo(() => snapshot ? historyRows(snapshot) : [], [snapshot]);
  const row = rows.find(row => row.record.id === selected);
  const preview = useMemo(() => row ? historyPreview(currentText, row.record.text) : null, [currentText, row]);
  const stale = !!snapshot && currentText !== snapshot.documentText;
  const blocked = busy || stale || snapshot?.pending || snapshot?.needsReview || rows.some(row => row.status === 'Needs review');
  const action = async (restore: boolean) => {
    if (!snapshot || !row) return;
    setBusy(true); setSaving(true); setError('');
    try { await (restore ? callbacks.current.onRestore : callbacks.current.onReview)(snapshot, row.record.id); }
    catch (error) { setError(String(error)); setConfirm(false); }
    finally { setBusy(false); setSaving(false); }
  };
  return <Modal open={open} title="History and recovery" wide onClose={() => { if (!saving) onClose(); }}>
    <Title data-history-recovery>History and recovery</Title>
    <Note>Browse saved versions without changing your journal. Restoring adds a new version and keeps existing history.</Note>
    {busy && <Note role="status">{snapshot ? 'Checking history and saving your choice…' : 'Loading history…'}</Note>}
    {error && <ErrorText role="alert">{error}</ErrorText>}
    {!busy && !error && !rows.length && <Note>{snapshot ? 'History is enabled, but no versions have been published yet. Close this view to let file saving finish, then open it again.' : 'Shared history needs a linked sync folder or a Google Drive link with revision history enabled. Open Settings to link or upgrade a target. Browser-only journals and individual file links do not have shared version history.'}</Note>}
    {!!rows.length && <>
      <Label>Saved version<Select aria-label="Saved version" disabled={busy} value={selected} onChange={event => { setSelected(event.target.value); setConfirm(false); setError(''); }}>{rows.map((row, index) => <option key={row.record.id} value={row.record.id}>{index + 1}. {row.status} · {row.source} · {row.record.id.slice(0, 8)}</option>)}</Select></Label>
      <Note>{rows.length} saved {rows.length === 1 ? 'version' : 'versions'}. Ordered by ancestry; concurrent versions have no time order. {row && <>Version {row.record.id.slice(0, 8)} · {row.source}.</>}</Note>
      {stale && <Note role="status">The journal changed. Refresh history before restoring.</Note>}
      {(snapshot?.pending || snapshot?.needsReview || rows.some(row => row.status === 'Needs review')) && <Note>Close this view to finish file saving, or review incoming branches, before restoring an earlier version.</Note>}
      {preview?.same ? <Note>This version matches the journal.</Note> : preview && <>
        <Note>Changed region, with nearby lines for context.</Note>
        <Comparison><section><h3>Current journal</h3><pre aria-label="Current journal comparison">{preview.before.text || '(empty)'}</pre></section><section><h3>Selected version</h3><pre aria-label="Selected version comparison">{preview.after.text || '(empty)'}</pre></section></Comparison>
        {(preview.before.truncated || preview.after.truncated) && <Note>Preview shortened. Download the version for its complete text.</Note>}
      </>}
      {confirm && <div role="group" aria-label="Confirm restoration"><Note>Replace the entire journal with this version? Your current version stays in history. Scratchpad and preferences are kept. File saving follows after this view closes.</Note><Actions><Button disabled={busy} onClick={() => setConfirm(false)}>Cancel restoration</Button><Button $primary disabled={!!blocked} onClick={() => void action(true)}>Restore as new version</Button></Actions></div>}
    </>}
    <Actions>
      {row && <Button disabled={busy} onClick={() => downloadTextFile(row.record.text, `TODO-version-${row.record.id.slice(0, 8)}.txt`)}>Download version</Button>}
      {row?.status === 'Needs review' && <Button disabled={busy || stale || snapshot?.pending} onClick={() => void action(false)}>Review this branch</Button>}
      {row && !confirm && <Button disabled={!!blocked || preview?.same} onClick={() => setConfirm(true)}>Restore version</Button>}
      <Button disabled={busy} onClick={() => void refresh()}>Refresh history</Button>
      {(!rows.length || error) && <Button disabled={saving} onClick={onSettings}>Sync settings</Button>}
      <Button disabled={saving} onClick={onClose}>Close</Button>
    </Actions>
  </Modal>;
}
