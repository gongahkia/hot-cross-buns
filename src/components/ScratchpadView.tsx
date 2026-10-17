import { useEffect, useRef, useState, type MouseEvent } from 'react';
import styled from 'styled-components';
import { createPortal } from 'react-dom';
import { ArrowRight, Copy, LockKeyhole } from 'lucide-react';
import { Button, Field, Muted } from '../styles';
import { getScratchpadMapping, getScratchpadMoveMode } from '../preferences';
import { mapScratchpadSelection } from '../scratchpad';
import { convertScratchpadSelection, loadScratchpadState, saveScratchpadText, subscribeStore, type ScratchpadState, type ScratchpadUndo, type TodoState } from '../todoStore';
import { validDate } from '../todoText';
import { Modal } from './Modal';

const Wrap = styled.section`display:flex;flex-direction:column;height:100%;min-height:0;`;
const Editor = styled.textarea`display:block;width:100%;flex:1;min-height:220px;padding:4px 2px;resize:none;border:0;border-radius:0;background:transparent;color:var(--ink);caret-color:var(--ink);font:inherit;font-size:16px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;&:focus{outline:none;}&:read-only{opacity:.8;}`;
const ContextMenu = styled.div`position:fixed;z-index:80;display:grid;gap:2px;width:222px;padding:5px;border:1px solid var(--line);border-radius:10px;background:var(--surface);box-shadow:0 10px 30px #0003;`;
const MenuAction = styled.button`display:flex;align-items:center;gap:9px;width:100%;min-height:40px;padding:7px 9px;border:0;border-radius:5px;background:transparent;color:var(--ink);font:inherit;font-size:13px;text-align:left;&:hover,&:focus-visible{background:var(--soft);}&:focus-visible{outline:2px solid var(--focus);outline-offset:-2px;}svg{width:15px;height:15px;}@media(pointer:coarse){min-height:44px;}`;
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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; keyboard: boolean } | null>(null);
  const [destination, setDestination] = useState<Destination>(null);
  const [date, setDate] = useState(today);
  const [list, setList] = useState(listNames[0] ?? 'Inbox');
  const [newList, setNewList] = useState('');
  const [copyMode, setCopyMode] = useState<'cut' | 'copy'>('cut');
  const [message, setMessage] = useState('');
  const editor = useRef<HTMLTextAreaElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const current = useRef<ScratchpadState>({ text: '', revision: 0 });
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pendingSaves = useRef(0);
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
  useEffect(() => { if (editable) editor.current?.focus(); }, [editable]);
  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) setContextMenu(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setContextMenu(null); editor.current?.focus(); } };
    const scroll = () => setContextMenu(null);
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', scroll);
    if (contextMenu.keyboard) menu.current?.querySelector('button')?.focus();
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', scroll); };
  }, [contextMenu]);
  useEffect(() => {
    const guardPendingSave = (event: BeforeUnloadEvent) => {
      if (!pendingSaves.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guardPendingSave);
    return () => window.removeEventListener('beforeunload', guardPendingSave);
  }, []);
  const save = (text: string) => {
    setDraft(text);
    setSelection(null);
    setContextMenu(null);
    pendingSaves.current++;
    queue.current = queue.current.then(async () => {
      const next = await saveScratchpadText(current.current.revision, text);
      current.current = next;
    }).catch(async error => {
      setMessage(String(error));
      await refresh();
    }).finally(() => { pendingSaves.current--; });
  };
  const rememberSelection = () => {
    const field = editor.current;
    if (!field) return;
    const { selectionStart: start, selectionEnd: end } = field;
    setSelection(start < end ? { start, end, text: field.value.slice(start,end) } : null);
  };
  const openContextMenu = (event: MouseEvent<HTMLTextAreaElement>) => {
    const field = event.currentTarget;
    const { selectionStart: start, selectionEnd: end } = field;
    if (!editable || start >= end) return;
    event.preventDefault();
    setSelection({ start, end, text: field.value.slice(start,end) });
    const bounds = field.getBoundingClientRect();
    setContextMenu({
      x: Math.max(8, Math.min(event.clientX || bounds.left + 20, window.innerWidth - 230)),
      y: Math.max(8, Math.min(event.clientY || bounds.top + 20, window.innerHeight - 150)),
      keyboard: event.clientX === 0 && event.clientY === 0,
    });
  };
  const openDestination = (next: Exclude<Destination, null>) => {
    setContextMenu(null);
    setCopyMode('cut');
    if (next === 'dated') setDate(today);
    else { setList(listNames[0] ?? 'Inbox'); setNewList(''); }
    setDestination(next);
  };
  const copySelection = async () => {
    if (!selection) return;
    try { await navigator.clipboard.writeText(selection.text); }
    catch {
      const field = editor.current;
      field?.focus();
      field?.setSelectionRange(selection.start, selection.end);
      if (!document.execCommand('copy')) setMessage('Could not copy the selection.');
    }
    setContextMenu(null);
    editor.current?.focus();
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
    {!editable && loaded && <Note><LockKeyhole size={14}/> {waiting ? 'Taking over the scratchpad…' : 'The scratchpad is open for editing in another window.'} {!waiting && <Button onClick={() => requestEdit(true)}>Take over editing</Button>}</Note>}
    <Editor ref={editor} aria-label="Scratchpad text" value={draft} readOnly={!editable} onChange={event => save(event.target.value)} onSelect={rememberSelection} onKeyUp={rememberSelection} onMouseUp={rememberSelection} onContextMenu={openContextMenu}/>
    {contextMenu && createPortal(<ContextMenu ref={menu} role="menu" aria-label="Scratchpad selection actions" style={{ left: contextMenu.x, top: contextMenu.y }}>
      <MenuAction type="button" role="menuitem" onClick={() => void copySelection()}><Copy aria-hidden="true"/>Copy selection</MenuAction>
      <MenuAction type="button" role="menuitem" onClick={() => openDestination('dated')}><ArrowRight aria-hidden="true"/>Move to dated</MenuAction>
      <MenuAction type="button" role="menuitem" onClick={() => openDestination('undated')}><ArrowRight aria-hidden="true"/>Move to undated</MenuAction>
    </ContextMenu>, document.body)}
    {message && <Note role="status">{message}</Note>}
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
