import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { ArrowRight, LockKeyhole, NotebookPen } from 'lucide-react';
import { Button, Field, Muted } from '../styles';
import { getScratchpadMapping, getScratchpadMoveMode } from '../preferences';
import { mapScratchpadSelection } from '../scratchpad';
import { convertScratchpadSelection, loadScratchpadState, saveScratchpadText, subscribeStore, type ScratchpadState, type ScratchpadUndo, type TodoState } from '../todoStore';
import { validDate } from '../todoText';
import { Modal } from './Modal';

const Wrap = styled.section`display:flex;flex-direction:column;height:100%;min-height:0;gap:12px;`;
const Toolbar = styled.div`display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-height:44px;`;
const Count = styled.span`margin-left:auto;color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums;`;
const Editor = styled.textarea`display:block;width:100%;flex:1;min-height:220px;padding:16px 18px;resize:none;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink);font:inherit;font-size:16px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;&:focus{outline:2px solid var(--focus);outline-offset:2px;}&:read-only{opacity:.8;}@media(max-width:600px){padding:13px 14px;}`;
const Row = styled.div`display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0;`;
const Label = styled.label`display:grid;gap:6px;margin:12px 0;font-size:13px;`;
const Select = styled.select`min-height:44px;padding:8px 10px;border:1px solid var(--line);border-radius:7px;background:var(--field);color:var(--ink);font-size:14px;@media(pointer:coarse){font-size:16px;}`;
const DialogActions = styled.div`display:flex;gap:8px;justify-content:flex-end;margin-top:18px;`;
const Note = styled(Muted)`display:flex;align-items:center;gap:6px;`;
type Selection = { start: number; end: number; text: string };
type Destination = 'dated' | 'undated' | null;

export function ScratchpadView({ listNames, today, reloadToken, beforeConvert, onJournalCommitted }: {
  listNames: string[]; today: string; reloadToken: number; beforeConvert: () => Promise<void>; onJournalCommitted: (journal: TodoState, undo: ScratchpadUndo) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState('');
  const [editable, setEditable] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [destination, setDestination] = useState<Destination>(null);
  const [date, setDate] = useState(today);
  const [list, setList] = useState(listNames[0] ?? 'Inbox');
  const [newList, setNewList] = useState('');
  const [copyMode, setCopyMode] = useState<'cut' | 'copy'>('cut');
  const [message, setMessage] = useState('');
  const editor = useRef<HTMLTextAreaElement>(null);
  const current = useRef<ScratchpadState>({ text: '', revision: 0 });
  const queue = useRef<Promise<void>>(Promise.resolve());
  const releaseLock = useRef<(() => void) | null>(null);
  const lockChannel = useRef<BroadcastChannel | null>(null);
  const mounted = useRef(true);

  const refresh = async () => {
    const latest = await loadScratchpadState();
    current.current = latest;
    setDraft(latest.text);
  };
  const requestEdit = (takeover = false) => {
    if (!navigator.locks) { setMessage('This browser cannot coordinate scratchpad editing across windows.'); return; }
    if (takeover) lockChannel.current?.postMessage({ type: 'takeover' });
    setWaiting(true);
    void navigator.locks.request('shio-pan-scratchpad-editor', { ifAvailable: !takeover }, async lock => {
      if (!mounted.current) return;
      if (!lock) { setWaiting(false); return; }
      await refresh();
      setWaiting(false);
      setEditable(true);
      await new Promise<void>(resolve => { releaseLock.current = resolve; });
      await queue.current;
      releaseLock.current = null;
      if (mounted.current) setEditable(false);
    }).catch(error => { if (mounted.current) { setWaiting(false); setMessage(String(error)); } });
  };
  useEffect(() => {
    mounted.current = true;
    void refresh().then(() => setLoaded(true)).catch(error => setMessage(String(error)));
    lockChannel.current = new BroadcastChannel('shio-pan-scratchpad-lock');
    lockChannel.current.onmessage = event => {
      if (event.data?.type === 'takeover' && releaseLock.current) releaseLock.current();
    };
    requestEdit();
    const unsubscribe = subscribeStore('scratchpad', () => { if (!releaseLock.current) void refresh().catch(error => setMessage(String(error))); });
    return () => {
      mounted.current = false;
      releaseLock.current?.();
      lockChannel.current?.close();
      unsubscribe();
    };
  }, []);
  useEffect(() => { if (reloadToken) void refresh().catch(error => setMessage(String(error))); }, [reloadToken]);
  const save = (text: string) => {
    setDraft(text);
    queue.current = queue.current.then(async () => {
      const next = await saveScratchpadText(current.current.revision, text);
      current.current = next;
    }).catch(async error => {
      setMessage(String(error));
      await refresh();
    });
  };
  const rememberSelection = () => {
    const field = editor.current;
    if (!field) return;
    const { selectionStart: start, selectionEnd: end } = field;
    setSelection(start < end ? { start, end, text: field.value.slice(start,end) } : null);
  };
  const convert = async () => {
    if (!destination || !selection || !editable) return;
    await queue.current;
    await beforeConvert();
    const items = mapScratchpadSelection(selection.text, getScratchpadMapping());
    if (!items.length) { setMessage('Select nonempty text to create an item.'); return; }
    const target = destination === 'dated'
      ? validDate(date) ? { kind: 'dated' as const, date } : null
      : { kind: 'undated' as const, list: newList.trim() || list || 'Inbox' };
    if (!target) { setMessage('Choose a valid date.'); return; }
    try {
      const result = await convertScratchpadSelection({ start: selection.start, end: selection.end, selected: selection.text, scratchRevision: current.current.revision, destination: target, items, cut: getScratchpadMoveMode() === 'cut' || copyMode === 'cut' });
      current.current = result.scratchpad;
      setDraft(result.scratchpad.text);
      setSelection(null);
      setDestination(null);
      setMessage('');
      onJournalCommitted(result.journal, result.undo);
    } catch (error) { setMessage(String(error)); }
  };
  return <Wrap aria-label="Scratchpad">
    <Toolbar>
      <Button disabled={!editable || !selection} onClick={() => { setDate(today); setCopyMode('cut'); setDestination('dated'); }}><ArrowRight size={15}/> Move to dated</Button>
      <Button disabled={!editable || !selection} onClick={() => { setList(listNames[0] ?? 'Inbox'); setNewList(''); setCopyMode('cut'); setDestination('undated'); }}><ArrowRight size={15}/> Move to undated</Button>
      <Count>{draft.length.toLocaleString()} characters</Count>
    </Toolbar>
    {!editable && loaded && <Note><LockKeyhole size={14}/> {waiting ? 'Taking over the scratchpad…' : 'The scratchpad is open for editing in another window.'} {!waiting && <Button onClick={() => requestEdit(true)}>Take over editing</Button>}</Note>}
    <Editor ref={editor} aria-label="Scratchpad text" placeholder="Capture thoughts here. Select text to move it into the journal." value={draft} readOnly={!editable} onChange={event => save(event.target.value)} onSelect={rememberSelection} onKeyUp={rememberSelection} onMouseUp={rememberSelection}/>
    {message && <Note role="status"><NotebookPen size={14}/>{message}</Note>}
    <Modal open={destination !== null} onClose={() => setDestination(null)} title={destination === 'dated' ? 'Move text to a date' : 'Move text to an undated list'} compact>
      <Muted>{selection?.text.trim().slice(0,120)}{(selection?.text.trim().length ?? 0) > 120 ? '…' : ''}</Muted>
      {destination === 'dated'
        ? <Label>Date<Field type="date" aria-label="Destination date" value={date} onChange={event => setDate(event.target.value)}/></Label>
        : <><Label>Existing list<Select aria-label="Destination list" value={list} onChange={event => setList(event.target.value)}>{(listNames.length ? listNames : ['Inbox']).map(name => <option key={name}>{name}</option>)}</Select></Label><Label>Or new list<Field aria-label="New destination list" value={newList} onChange={event => setNewList(event.target.value)} placeholder="Optional new list name"/></Label></>}
      {getScratchpadMoveMode() === 'ask' && <Label>After creating<Select aria-label="Keep source text" value={copyMode} onChange={event => setCopyMode(event.target.value as 'cut' | 'copy')}><option value="cut">Remove selected text</option><option value="copy">Keep selected text</option></Select></Label>}
      <Row><Muted>{mapScratchpadSelection(selection?.text ?? '', getScratchpadMapping()).length} {(mapScratchpadSelection(selection?.text ?? '', getScratchpadMapping()).length === 1) ? 'item' : 'items'} will be created.</Muted></Row>
      <DialogActions><Button onClick={() => setDestination(null)}>Cancel</Button><Button $primary onClick={() => void convert()}>Create item</Button></DialogActions>
    </Modal>
  </Wrap>;
}
