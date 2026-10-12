import { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { ArrowDown, ArrowUp, CalendarDays, Check, ChevronLeft, ChevronRight, Download, FileInput, FolderOpen, Moon, MoreHorizontal, Plus, Save, Settings2, Sun, Trash2, X } from 'lucide-react';
import { Button, Field, IconButton, InlineError, Muted, VisuallyHidden } from './styles';
import { Modal } from './components/Modal';
import { getFont, getTheme, setFont, setTheme, type AppFont } from './preferences';
import { cloneDocument, emptyDocument, newId, parseTodoText, serializeTodoText, todayString, validDate, validateDocument, type TodoDocument, type TodoItem, type ParseIssue } from './todoText';
import { fileBaseline, proposeMerge, resolveMerge, type MergeChoice, type MergeProposal } from './todoMerge';
import { emptyState, loadTodoState, pickTodoFile, saveTodoState, supportsDirectFiles, type TodoFileHandle, type TodoState } from './todoStore';

const Page = styled.main`width: min(730px, calc(100% - 40px)); min-height: 100dvh; margin: 0 auto; padding: 35px 0 80px; @media(max-width: 600px){width: calc(100% - 28px); padding-top: 16px;}`;
const Header = styled.header`display: flex; align-items: center; justify-content: flex-end; min-height: 44px; margin-bottom: 20px;`;
const Tools = styled.div`display: flex; align-items: center; gap: 2px;`;
const Icon = styled(IconButton)`width: 44px; height: 44px;`;
const Toolbar = styled.div`display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; @media(max-width: 600px){display: grid; grid-template-columns: 44px minmax(0,1fr) 44px 44px; gap: 6px;}`;
const DatePicker = styled(Field)`width: 155px; min-width: 0; min-height: 44px; font-size: 13px; border-color: transparent; background: var(--date-bg); @media(max-width:600px){width:100%;}`;
const SearchWrap = styled.div`position: relative; flex: 1; min-width: 180px; @media(max-width:600px){grid-column: 1 / -1;}`;
const SearchField = styled(Field)`min-height: 44px; width: 100%; padding-right: 44px; font-size: 13px;`;
const ClearSearch = styled(IconButton)`position: absolute; right: 0; top: 0; width: 44px; height: 44px;`;
const TagRail = styled.nav`display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 24px;`;
const TagPill = styled.button<{ $active: boolean }>`min-height: 36px; border: 1px solid ${({ $active }) => $active ? 'var(--tag-selected)' : 'var(--line)'}; color: ${({ $active }) => $active ? 'var(--tag-selected)' : 'var(--tag-ink)'}; background: var(--tag-bg); padding: 5px 10px; border-radius: 999px; font-size: 12px; @media(pointer:coarse){min-height:44px;}`;
const DaySection = styled.section`margin: 0 0 38px; scroll-margin-top: 20px;`;
const DayTitle = styled.h2`display: flex; align-items: center; gap: 10px; font-size: 15px; margin-bottom: 10px;`;
const DateBadge = styled.time`padding: 4px 8px; background: var(--date-bg); border-radius: 9px;`;
const SectionCaption = styled.p`font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .12em; margin: 10px 0 3px 42px;`;
const Divider = styled.div`height: 1px; margin: 15px 0 13px 42px; background: var(--line);`;
const ItemRow = styled.div`position: relative; display: flex; align-items: flex-start; gap: 4px; min-height: 40px; border-radius: 7px; &:hover { background: var(--soft); }`;
const CheckButton = styled.button<{ $done: boolean }>`width: 40px; height: 40px; display: grid; place-items: center; flex: none; border: 0; background: transparent; color: ${({ $done }) => $done ? 'var(--link)' : 'var(--checkbox)'}; @media(pointer:coarse){width:44px;height:44px;}`;
const Circle = styled.span<{ $done: boolean }>`display: grid; place-items: center; width: 15px; height: 15px; border: 1px solid currentColor; border-radius: 50%; background: ${({ $done }) => $done ? 'var(--link)' : 'transparent'}; color: ${({ $done }) => $done ? 'var(--paper)' : 'var(--checkbox)'};`;
const ItemBody = styled.div`min-width: 0; flex: 1;`;
const ItemInput = styled.input`width: 100%; min-height: 40px; border: 0; border-radius: 4px; padding: 3px 2px; background: transparent; font-size: 15px; line-height: 1.4; color: var(--ink); &:focus { background: var(--field); box-shadow: 0 0 0 1px var(--focus); } @media(pointer:coarse){min-height:44px;}`;
const DetailInput = styled(ItemInput)`font-size: 13px; min-height: 32px; color: var(--muted); @media(pointer:coarse){min-height:44px;}`;
const DetailRow = styled.div`display: flex; align-items: center; gap: 6px; margin-left: 3px; &:hover button { opacity: 1; }`;
const Dash = styled.span`color: var(--muted); font-size: 13px;`;
const Mini = styled.button`display: inline-grid; place-items: center; width: 32px; height: 32px; flex: none; padding: 0; border: 0; border-radius: 5px; color: var(--muted); background: transparent; &:hover { color: var(--link); background: var(--date-bg); } @media(pointer:coarse){width:44px;height:44px;}`;
const ActionWrap = styled.div`position: relative; flex: none;`;
const MoreButton = styled(IconButton)`width: 40px; height: 40px; @media(pointer:coarse){width:44px;height:44px;}`;
const ActionMenu = styled.div`position: absolute; right: 0; top: 40px; z-index: 10; width: 176px; padding: 5px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface); box-shadow: 0 10px 30px #0002;`;
const Action = styled.button`width: 100%; min-height: 40px; display: flex; align-items: center; gap: 9px; padding: 7px 9px; border: 0; border-radius: 5px; background: transparent; color: var(--ink); font-size: 13px; text-align: left; &:hover { background: var(--soft); } @media(pointer:coarse){min-height:44px;}`;
const AddForm = styled.form`display: flex; align-items: center; gap: 4px; margin-left: 40px; max-width: calc(100% - 40px);`;
const AddInput = styled(Field)`min-height: 40px; border-color: transparent; background: transparent; padding-left: 2px; &:focus { background: var(--field); border-color: var(--focus); } @media(pointer:coarse){min-height:44px;}`;
const ModalTitle = styled.h2`font-size: 22px; margin-bottom: 12px;`;
const ModalActions = styled.div`display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-top: 20px;`;
const PaneGrid = styled.div`display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 10px; @media(max-width:550px){grid-template-columns: 1fr;}`;
const Pane = styled.div`min-width: 0; min-height: 75px; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere;`;
const ReviewRow = styled.div`padding: 13px 0; border-bottom: 1px solid var(--line);`;
const ReviewChoices = styled.div`display: flex; gap: 12px; flex-wrap: wrap; margin-top: 8px; font-size: 12px;`;
const RawText = styled.textarea`width: 100%; min-height: 200px; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--field); font: 12px/1.5 ui-monospace,monospace; resize: vertical;`;
const Note = styled.p`font-size: 12px; color: var(--muted);`;

type Review = { raw: string; file: TodoDocument; proposal: MergeProposal; handle: TodoFileHandle | null; mode: 'import' | 'save'; observedText: string | null };
const tagsIn = (text: string) => [...text.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)].map(match => match[1].toLowerCase());
const itemLabel = (item: TodoItem | null) => item ? `${item.completed ? 'done' : 'upcoming'}  ${item.text}${item.details.map(detail => `\n  - ${detail}`).join('')}` : '(deleted / absent)';
const dateLabel = (date: string, today: string) => date === today ? 'Today' : new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const shiftDate = (date: string, amount: number) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + amount); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

export default function App() {
  const [state, setState] = useState<TodoState | null>(null);
  const current = useRef<TodoState>(emptyState());
  const [selectedDate, setSelectedDate] = useState(todayString);
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [theme, setThemeState] = useState(getTheme);
  const [font, setFontState] = useState(getFont);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [choices, setChoices] = useState<Record<string, MergeChoice>>({});
  const [rawEdit, setRawEdit] = useState('');
  const [issues, setIssues] = useState<ParseIssue[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const undoStack = useRef<TodoDocument[]>([]);
  const redoStack = useRef<TodoDocument[]>([]);
  const today = todayString();

  useEffect(() => { loadTodoState().then(loaded => { current.current = loaded; setState(loaded); }).catch(error => setMessage(`Could not open IndexedDB: ${String(error)}`)); }, []);
  const commitState = async (next: TodoState) => { current.current = next; setState(next); await saveTodoState(next); };
  const edit = (change: (document: TodoDocument) => void) => {
    const before = current.current.document;
    const document = cloneDocument(before);
    change(document);
    try { validateDocument(document); } catch (error) { setMessage(String(error)); return; }
    if (serializeTodoText(before) === serializeTodoText(document)) return;
    undoStack.current.push(before);
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
    void commitState({ ...current.current, document }).catch(error => setMessage(`Could not save: ${String(error)}`));
  };
  const undo = () => { const previous = undoStack.current.pop(); if (!previous) return; redoStack.current.push(current.current.document); void commitState({ ...current.current, document: previous }); };
  const redo = () => { const next = redoStack.current.pop(); if (!next) return; undoStack.current.push(current.current.document); void commitState({ ...current.current, document: next }); };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('input,textarea,[contenteditable=true]')) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); document.getElementById('journal-search')?.focus(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  const mutateItem = (date: string, id: string, change: (item: TodoItem, items: TodoItem[]) => void) => edit(document => {
    const items = document.days.find(day => day.date === date)?.items;
    const item = items?.find(item => item.id === id);
    if (items && item) change(item, items);
  });
  const addItem = (date: string, text: string) => { if (!text.trim()) return; edit(document => {
    let day = document.days.find(day => day.date === date);
    if (!day) { day = { date, items: [] }; document.days.push(day); document.days.sort((a,b) => a.date.localeCompare(b.date)); }
    day.items.push({ id: newId(), text: text.trim(), details: [], completed: false });
  }); };
  const moveItem = (date: string, id: string, target: string) => {
    if (!validDate(target) || target === date) return;
    edit(document => {
      const source = document.days.find(day => day.date === date);
      const index = source?.items.findIndex(item => item.id === id) ?? -1;
      if (!source || index < 0) return;
      const [item] = source.items.splice(index, 1);
      let destination = document.days.find(day => day.date === target);
      if (!destination) { destination = { date: target, items: [] }; document.days.push(destination); }
      destination.items.push(item);
      document.days = document.days.filter(day => day.items.length);
      document.days.sort((a,b) => a.date.localeCompare(b.date));
    });
    setSelectedDate(target);
  };
  const imported = async (raw: string, handle: TodoFileHandle | null, mode: 'import' | 'save', observedText: string | null = null) => {
    const parsed = parseTodoText(raw);
    if (parsed.issues.length) { setRawEdit(raw); setIssues(parsed.issues); setReview({ raw, file: parsed.document, proposal: { rows: [], conflicts: [] }, handle, mode, observedText }); return; }
    const proposal = proposeMerge(current.current.document, parsed.document, current.current.baseline);
    if (proposal.conflicts.length) { setChoices({}); setIssues([]); setReview({ raw, file: parsed.document, proposal, handle, mode, observedText }); return; }
    const merged = resolveMerge(proposal, {});
    if (mode === 'save' && handle) await saveToHandle(handle, merged, observedText ?? raw);
    else { await commitState({ ...current.current, document: merged, baseline: fileBaseline(proposal), baselineText: raw, fileHandle: handle }); setMessage('TODO.txt imported.'); }
  };
  const saveToHandle = async (handle: TodoFileHandle, document: TodoDocument, observed: string) => {
    if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted' && await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('File access was not granted.');
    const latest = await (await handle.getFile()).text();
    if (latest !== observed) {
      // Keep the user's completed review as the local side of the next merge.
      await commitState({ ...current.current, document });
      await imported(latest, handle, 'save', latest);
      return;
    }
    const output = serializeTodoText(document);
    const writable = await handle.createWritable();
    await writable.write(output);
    await writable.close();
    await commitState({ ...current.current, document, baseline: cloneDocument(document), baselineText: output, fileHandle: handle });
    setReview(null); setMessage(`Saved ${handle.name}.`);
  };
  const importFile = async (file: File) => { setBusy(true); try { await imported(await file.text(), null, 'import'); } catch (error) { setMessage(String(error)); } finally { setBusy(false); } };
  const openFile = async () => { setBusy(true); try { const handle = await pickTodoFile(); await imported(await (await handle.getFile()).text(), handle, 'import'); } catch (error) { if ((error as Error).name !== 'AbortError') setMessage(String(error)); } finally { setBusy(false); } };
  const download = async () => {
    const output = serializeTodoText(current.current.document);
    const url = URL.createObjectURL(new Blob([output], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'TODO.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (!current.current.fileHandle) await commitState({ ...current.current, baseline: cloneDocument(current.current.document), baselineText: output });
    setMessage('TODO.txt downloaded.');
  };
  const save = async () => {
    const handle = current.current.fileHandle;
    if (!handle) { setMessage('Open a TODO.txt file first, or use Download.'); return; }
    setBusy(true);
    try {
      if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted' && await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('File access was not granted.');
      const raw = await (await handle.getFile()).text();
      if (raw !== current.current.baselineText) await imported(raw, handle, 'save', raw);
      else await saveToHandle(handle, current.current.document, raw);
    } catch (error) { setMessage(String(error)); } finally { setBusy(false); }
  };
  const applyReview = async () => {
    if (!review || issues.length) return;
    setBusy(true);
    try {
      const merged = resolveMerge(review.proposal, choices);
      if (review.mode === 'save' && review.handle) await saveToHandle(review.handle, merged, review.observedText ?? review.raw);
      else {
        await commitState({ ...current.current, document: merged, baseline: fileBaseline(review.proposal), baselineText: review.raw, fileHandle: review.handle });
        setReview(null); setMessage('TODO.txt imported.');
      }
    } catch (error) { setMessage(String(error)); } finally { setBusy(false); }
  };
  const reparse = async () => { setIssues([]); setReview(null); try { await imported(rawEdit, review?.handle ?? null, review?.mode ?? 'import', review?.observedText ?? null); } catch (error) { setMessage(String(error)); } };
  const documentData = state?.document ?? emptyDocument();
  const allTags = useMemo(() => [...new Set(documentData.days.flatMap(day => day.items.flatMap(item => [item.text, ...item.details].flatMap(tagsIn))))].sort(), [documentData]);
  const visibleDays = useMemo(() => {
    const dates = new Set([selectedDate, ...documentData.days.map(day => day.date)]);
    return [selectedDate, ...[...dates].filter(date => date !== selectedDate).sort((a,b) => b.localeCompare(a))].map(date => ({ date, items: documentData.days.find(day => day.date === date)?.items ?? [] }));
  }, [documentData, selectedDate]);
  const matches = (item: TodoItem) => {
    const content = [item.text, ...item.details].join(' ').toLowerCase();
    return (!query || content.includes(query.toLowerCase())) && (!tag || tagsIn(content).includes(tag));
  };
  if (!state) return <Page><Muted role="status">{message || 'Opening journal…'}</Muted></Page>;
  return <Page>
    <a href="#journal-content" className="skip-link">Skip to journal</a>
    <VisuallyHidden as="h1">Jing daily journal</VisuallyHidden>
    <Header><Tools>
      <Icon title="Import TODO.txt" aria-label="Import TODO.txt" onClick={() => importInput.current?.click()}><FileInput size={17}/></Icon>
      {supportsDirectFiles() && <Icon title="Open TODO.txt" aria-label="Open TODO.txt" disabled={busy} onClick={() => void openFile()}><FolderOpen size={17}/></Icon>}
      <Icon title="Download TODO.txt" aria-label="Download TODO.txt" onClick={() => void download()}><Download size={17}/></Icon>
      {supportsDirectFiles() && <Icon title="Save connected TODO.txt" aria-label="Save connected TODO.txt" disabled={busy || !state.fileHandle} onClick={() => void save()}><Save size={17}/></Icon>}
      <Icon title="Jing settings" aria-label="Jing settings" onClick={() => setSettingsOpen(true)}><Settings2 size={17}/></Icon>
    </Tools></Header>
    <input ref={importInput} type="file" accept=".txt,text/plain" hidden aria-label="Import a TODO.txt file" onChange={event => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = ''; }}/>
    <Toolbar>
      <Icon aria-label="Previous day" onClick={() => setSelectedDate(shiftDate(selectedDate,-1))}><ChevronLeft size={17}/></Icon>
      <DatePicker aria-label="Selected date" type="date" value={selectedDate} onChange={event => validDate(event.target.value) && setSelectedDate(event.target.value)}/>
      <Icon aria-label="Next day" onClick={() => setSelectedDate(shiftDate(selectedDate,1))}><ChevronRight size={17}/></Icon>
      <Icon aria-label="Today" title="Today" onClick={() => setSelectedDate(todayString())}><CalendarDays size={17}/></Icon>
      <SearchWrap><SearchField id="journal-search" type="search" aria-label="Search journal" placeholder="Search the text file" value={query} onChange={event => setQuery(event.target.value)}/>
        {query && <ClearSearch aria-label="Clear search" onClick={() => setQuery('')}><X size={15}/></ClearSearch>}
      </SearchWrap>
    </Toolbar>
    {!!allTags.length && <TagRail aria-label="Tags"><TagPill $active={!tag} onClick={() => setTag(null)}>all</TagPill>{allTags.map(name => <TagPill key={name} $active={tag === name} onClick={() => setTag(tag === name ? null : name)}>#{name}</TagPill>)}</TagRail>}
    {message && <Note role="status" style={{ marginBottom: 14 }}>{message} <button aria-label="Dismiss message" onClick={() => setMessage('')} style={{ border: 0, background: 'transparent', color: 'inherit' }}>×</button></Note>}
    <div id="journal-content" tabIndex={-1}>
    {visibleDays.map(day => {
      const completed = day.items.filter(item => item.completed && matches(item));
      const upcoming = day.items.filter(item => !item.completed && matches(item));
      if ((query || tag) && !completed.length && !upcoming.length) return null;
      return <DaySection key={day.date} aria-label={`${dateLabel(day.date,today)}, ${day.date}`}>
        <DayTitle><DateBadge dateTime={day.date}>{day.date}</DateBadge><span>{dateLabel(day.date,today)}</span></DayTitle>
        {(completed.length > 0 || day.date === selectedDate) && <SectionCaption>done</SectionCaption>}
        {completed.map(item => <JournalItem key={item.id} item={item} date={day.date} today={today} onChange={change => mutateItem(day.date,item.id,change)} onMove={target => moveItem(day.date,item.id,target)}/>)}
        <Divider aria-label="Completed and upcoming divider"/>
        {(upcoming.length > 0 || day.date === selectedDate) && <SectionCaption>upcoming</SectionCaption>}
        {upcoming.map(item => <JournalItem key={item.id} item={item} date={day.date} today={today} onChange={change => mutateItem(day.date,item.id,change)} onMove={target => moveItem(day.date,item.id,target)}/>)}
        {day.date < today && upcoming.length > 0 && <Note style={{ margin: '7px 0 5px 42px' }}>{upcoming.length} unfinished on this day</Note>}
        {day.date === selectedDate && !query && !tag && <AddItem onAdd={text => addItem(day.date,text)}/>}
      </DaySection>;
    })}
    </div>
    <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Jing settings" compact>
      <ModalTitle>settings</ModalTitle>
      <p style={{ fontSize: 13, marginBottom: 15 }}>The journal stays in this browser until you export or save TODO.txt.</p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}><Button onClick={() => { const next = theme === 'day' ? 'night' : 'day'; setTheme(next); setThemeState(next); }}>{theme === 'day' ? <Moon size={15}/> : <Sun size={15}/>} {theme === 'day' ? 'night' : 'day'} mode</Button></div>
      <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>Font<select value={font} onChange={event => { const next = event.target.value as AppFont; setFont(next); setFontState(next); }} style={{ minHeight: 38, background: 'var(--field)', border: '1px solid var(--line)', borderRadius: 7 }}><option value="sohne">Sohne</option><option value="dm-sans">DM Sans</option><option value="lora">Lora</option><option value="system">System</option></select></label>
      <ModalActions><Button onClick={() => setSettingsOpen(false)}>close</Button></ModalActions>
    </Modal>
    <Modal open={!!review} onClose={() => { setReview(null); setIssues([]); }} title="Review TODO.txt import" wide>
      <ModalTitle>{review?.mode === 'save' ? 'Review file changes' : 'Review TODO.txt import'}</ModalTitle>
      {!!issues.length ? <><InlineError>{issues.length} format issue{issues.length === 1 ? '' : 's'} need correction before import.</InlineError>{issues.map(issue => <Note key={`${issue.line}-${issue.message}`}>Line {issue.line}: {issue.message}</Note>)}<RawText aria-label="Edit imported TODO.txt" value={rawEdit} onChange={event => setRawEdit(event.target.value)}/><ModalActions><Button onClick={() => setReview(null)}>cancel</Button><Button $primary onClick={() => void reparse()}>check file</Button></ModalActions></> : <>
        <Note>{review?.proposal.conflicts.length ?? 0} item{review?.proposal.conflicts.length === 1 ? '' : 's'} need a decision. Clear changes will merge automatically.</Note>
        <PaneGrid style={{ marginTop: 12 }}><strong style={{ fontSize: 12 }}>Jing</strong><strong style={{ fontSize: 12 }}>TODO.txt</strong></PaneGrid>
        {review?.proposal.conflicts.map(row => <ReviewRow key={row.key}><Note>{row.date}{row.reorderConflict ? ' · order changed on both sides' : ''}</Note><PaneGrid><Pane>{row.reorderConflict && `position ${row.localOrder + 1}\n`}{itemLabel(row.local)}</Pane><Pane>{row.reorderConflict && `position ${row.fileOrder + 1}\n`}{itemLabel(row.file)}</Pane></PaneGrid><ReviewChoices>
          {(['local','file','both'] as const).map(choice => <label key={choice}><input type="radio" name={row.key} checked={(choices[row.key] ?? '') === choice} onChange={() => setChoices(previous => ({ ...previous, [row.key]: choice }))}/> {choice === 'local' ? 'keep Jing' : choice === 'file' ? 'use file' : 'keep both'}</label>)}
        </ReviewChoices></ReviewRow>)}
        <ModalActions><Button onClick={() => setReview(null)}>cancel</Button><Button $primary disabled={busy || (review?.proposal.conflicts.some(row => !choices[row.key]) ?? false)} onClick={() => void applyReview()}>{review?.mode === 'save' ? 'merge and save' : 'apply import'}</Button></ModalActions>
      </>}
    </Modal>
  </Page>;
}

function AddItem({ onAdd }: { onAdd: (text: string) => void }) {
  const [text, setText] = useState('');
  return <AddForm onSubmit={event => { event.preventDefault(); if (text.trim()) { onAdd(text); setText(''); } }}><AddInput aria-label="New daily item" placeholder="Add a line to this day…" value={text} onChange={event => setText(event.target.value)}/><Mini aria-label="Add daily item" type="submit"><Plus size={16}/></Mini></AddForm>;
}

function JournalItem({ item, date, today, onChange, onMove }: { item: TodoItem; date: string; today: string; onChange: (change: (item: TodoItem, items: TodoItem[]) => void) => void; onMove: (date: string) => void }) {
  const [text, setText] = useState(item.text);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveDate, setMoveDate] = useState(date);
  const [addingDetail, setAddingDetail] = useState(false);
  const [detailDraft, setDetailDraft] = useState('');
  useEffect(() => setText(item.text), [item.text]);
  const saveText = () => { const value = text.trim(); if (value && value !== item.text) onChange(item => { item.text = value; }); else setText(item.text); };
  return <ItemRow role="group" aria-label={item.text}>
    <CheckButton $done={item.completed} aria-label={`${item.completed ? 'Reopen' : 'Complete'} ${item.text}`} onClick={() => onChange(item => { item.completed = !item.completed; })}><Circle $done={item.completed}>{item.completed && <Check size={12}/>}</Circle></CheckButton>
    <ItemBody>
      <ItemInput $done={item.completed} aria-label={`Edit ${item.text}`} value={text} onChange={event => setText(event.target.value)} onBlur={saveText} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setText(item.text); event.currentTarget.blur(); } }}/>
      {item.details.map((detail,index) => <Detail key={`${item.id}-${index}`} value={detail} onSave={value => onChange(item => { item.details[index] = value; })} onDelete={() => onChange(item => { item.details.splice(index,1); })}/>)}
      {addingDetail && <DetailRow><Dash>-</Dash><DetailInput autoFocus aria-label={`New detail for ${item.text}`} value={detailDraft} onChange={event => setDetailDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setDetailDraft(''); setAddingDetail(false); } }} onBlur={() => { if (detailDraft.trim()) onChange(item => { item.details.push(detailDraft.trim()); }); setDetailDraft(''); setAddingDetail(false); }}/></DetailRow>}
      {moveOpen && <DetailRow><Dash>move to</Dash><input aria-label={`Move ${item.text} to date`} type="date" value={moveDate} onChange={event => setMoveDate(event.target.value)}/><Mini aria-label="Confirm move" onClick={() => { if (validDate(moveDate)) { onMove(moveDate); setMoveOpen(false); } }}><Check size={14}/></Mini></DetailRow>}
      {date < today && !item.completed && <Note style={{ margin: '0 0 3px 2px' }}>unfinished</Note>}
    </ItemBody>
    <HoverActions>
      <Mini title="Add detail" aria-label={`Add detail to ${item.text}`} onClick={() => setAddingDetail(true)}><Plus size={14}/></Mini>
      <Mini title="Move to date" aria-label={`Move ${item.text}`} onClick={() => setMoveOpen(value => !value)}><CalendarDays size={14}/></Mini>
      <Mini title="Move up" aria-label={`Move ${item.text} up`} onClick={() => onChange((item, items) => { const index = items.indexOf(item); let previous = -1; for (let position = index - 1; position >= 0; position--) { if (items[position].completed === item.completed) { previous = position; break; } } if (previous >= 0) [items[previous], items[index]] = [items[index], items[previous]]; })}><ArrowUp size={13}/></Mini>
      <Mini title="Move down" aria-label={`Move ${item.text} down`} onClick={() => onChange((item, items) => { const index = items.indexOf(item); const next = items.findIndex((candidate, position) => position > index && candidate.completed === item.completed); if (next >= 0) [items[next], items[index]] = [items[index], items[next]]; })}><ArrowDown size={13}/></Mini>
      <Mini title="Delete" aria-label={`Delete ${item.text}`} onClick={() => onChange((item, items) => { items.splice(items.indexOf(item),1); })}><Trash2 size={13}/></Mini>
    </HoverActions>
  </ItemRow>;
}

function Detail({ value, onSave, onDelete }: { value: string; onSave: (value: string) => void; onDelete: () => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <DetailRow><Dash>-</Dash><DetailInput aria-label={`Edit detail ${value}`} value={draft} onChange={event => setDraft(event.target.value)} onBlur={() => { if (draft.trim() && draft.trim() !== value) onSave(draft.trim()); else setDraft(value); }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setDraft(value); event.currentTarget.blur(); } }}/><Mini title="Delete detail" aria-label={`Delete detail ${value}`} onClick={onDelete}><X size={13}/></Mini></DetailRow>;
}
