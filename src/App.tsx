import { useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, pointerWithin, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent } from '@dnd-kit/core';
import { createPortal } from 'react-dom';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { restrictToWindowEdges } from '@dnd-kit/modifiers';
import styled, { keyframes } from 'styled-components';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Download, FileInput, FolderOpen, Save, Search, Settings2, X } from 'lucide-react';
import { Button, Field, IconButton, Muted, VisuallyHidden } from './styles';
import { AppearanceSettings } from './components/AppearanceSettings';
import { FileReview, type FileReviewState } from './components/FileReview';
import { AddItem, JournalItem } from './components/DailyItem';
import { CalendarPanel } from './components/CalendarPanel';
import { formatDateHeading, getDateFormat, setDateFormat, type DateFormat } from './preferences';
import { cloneDocument, emptyDocument, newId, parseTodoText, serializeTodoText, todayString, validDate, validateDocument, type TodoDocument, type TodoItem, type ParseIssue } from './todoText';
import { fileBaseline, proposeMerge, resolveMerge, type MergeChoice } from './todoMerge';
import { emptyState, loadTodoState, pickTodoFile, saveTodoState, supportsDirectFiles, type TodoFileHandle, type TodoState } from './todoStore';

const Page = styled.main`width: min(730px, calc(100% - 40px)); min-height: 100dvh; margin: 0 auto; padding: 35px 0 80px; @media(max-width: 600px){width: calc(100% - 28px); padding-top: 16px;}`;
const Header = styled.header`display: flex; align-items: center; gap: 16px; min-height: 44px; margin-bottom: 20px; @media(max-width: 760px){flex-wrap:wrap; justify-content:flex-end;}`;
const Tools = styled.div`display: flex; align-items: center; gap: 2px;`;
const Icon = styled(IconButton)`width: 44px; height: 44px;`;
const Toolbar = styled.div`display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; @media(max-width: 760px){order:2;flex-basis:100%;} @media(max-width: 600px){display: grid; grid-template-columns: 44px minmax(0,1fr) 44px 44px; gap: 6px;}`;
const DateControl = styled.div`position: relative; display: flex; align-items: center; width: 155px; min-width: 0; min-height: 44px; @media(max-width:600px){width:100%;}`;
const DateText = styled.button`flex: 1; min-width: 0; min-height: 44px; padding: 8px 0 8px 4px; border: 0; border-radius: 7px; background: transparent; color: var(--ink); font-size: 13px; text-align: left; white-space: nowrap; &:hover { text-decoration: underline; text-underline-offset: 3px; font-weight: 600; }`;
const DateCalendar = styled(IconButton)`width: 44px; height: 44px; color: var(--ink);`;
const DatePopover = styled.div`position: absolute; top: calc(100% + 6px); left: 0; z-index: 30; @media(max-width: 390px){left: -50px;}`;
const SearchWrap = styled.div<{ $open:boolean }>`display:flex; align-items:center; min-width:44px; width:${({$open})=>$open?'min(240px, 100%)':'44px'}; flex:${({$open})=>$open?'1 1 180px':'0 0 44px'}; transition:width 180ms ease-out, flex-basis 180ms ease-out; @media(max-width:600px){grid-column:${({$open})=>$open?'1 / -1':'4'}; grid-row:${({$open})=>$open?'2':'1'}; justify-self:${({$open})=>$open?'stretch':'end'}; width:${({$open})=>$open?'100%':'44px'};}`;
const SearchBox = styled.div<{ $open:boolean }>`position:relative; flex:1; min-width:0; max-width:${({$open})=>$open?'100%':'0'}; opacity:${({$open})=>$open?1:0}; overflow:hidden; transition:max-width 180ms ease-out, opacity 140ms ease-out;`;
const SearchField = styled(Field)`min-height: 44px; width: 100%; padding-right: 44px; font-size: 13px; &::-webkit-search-cancel-button { display: none; }`;
const ClearSearch = styled(IconButton)`position: absolute; right: 0; top: 0; width: 44px; height: 44px;`;
const TagRail = styled.nav`display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 24px;`;
const TagPill = styled.button<{ $active: boolean }>`min-height: 36px; border: 1px solid ${({ $active }) => $active ? 'var(--tag-selected)' : 'var(--line)'}; color: ${({ $active }) => $active ? 'var(--tag-selected)' : 'var(--tag-ink)'}; background: var(--tag-bg); padding: 5px 10px; border-radius: 999px; font-size: 12px; @media(pointer:coarse){min-height:44px;}`;
const dayEnter = keyframes`from { opacity:.45; transform:translateY(5px); } to { opacity:1; transform:translateY(0); }`;
const DaySection = styled.section<{ $selected:boolean }>`margin: 0 0 38px; scroll-margin-top: 20px; animation:${({$selected})=>$selected?dayEnter:'none'} 180ms ease-out;`;
const DayTitle = styled.h2<{ $over?: boolean }>`display: flex; align-items: center; gap: 10px; font-size: 15px; margin-bottom: 10px; border-radius: 9px; background: ${({ $over }) => $over ? 'var(--soft)' : 'transparent'}; box-shadow: ${({ $over }) => $over ? '0 0 0 2px var(--focus)' : 'none'};`;
const DateBadge = styled.time`padding: 4px 8px; background: var(--date-bg); border-radius: 9px;`;
const DragPreview = styled.div`display:flex; align-items:center; gap:8px; min-height:44px; width:100%; padding:7px 12px; border:1px solid var(--focus); border-radius:8px; background:var(--surface); color:var(--ink); box-shadow:0 12px 30px #0005; font-size:15px; pointer-events:none;`;
const PreviewCircle = styled.span<{ $done:boolean }>`display:grid; place-items:center; width:15px; height:15px; flex:none; border:1px solid ${({$done})=>$done?'var(--link)':'var(--checkbox)'}; border-radius:50%; background:${({$done})=>$done?'var(--link)':'transparent'}; color:var(--paper);`;
const PreviewText = styled.span<{ $done:boolean }>`min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:${({$done})=>$done?'var(--muted)':'var(--ink)'}; text-decoration:${({$done})=>$done?'line-through':'none'};`;
const SectionCaption = styled.p`font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .12em; margin: 10px 0 3px 64px;`;
const DoneToggle = styled.button`display:inline-flex; align-items:center; gap:6px; min-height:36px; margin:3px 0 0 58px; padding:3px 6px; border:0; border-radius:5px; background:transparent; color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.12em; &:hover {background:var(--soft); color:var(--ink);} @media(pointer:coarse){min-height:44px;}`;
const DoneCount = styled.span`font-size:11px; letter-spacing:0; font-variant-numeric:tabular-nums;`;
const CompletedClip = styled.div<{ $open:boolean }>`display:grid; grid-template-rows:${({$open})=>$open?'1fr':'0fr'}; opacity:${({$open})=>$open?1:0}; transition:grid-template-rows 190ms ease-out, opacity 150ms ease-out; > div {min-height:0; overflow:hidden;}`;
const Divider = styled.div`height: 1px; margin: 15px 0 13px 64px; background: var(--line);`;
const Note = styled.p`font-size: 12px; color: var(--muted);`;
const EmptyDay = styled.p`margin: 12px 0 10px 64px; color: var(--muted); font-size: 13px;`;
const EmptyResults = styled.div`padding: 18px 0 28px; color: var(--muted); font-size: 14px;`;
const Notice = styled(Note)`display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 14px;`;
const Dismiss = styled.button`width: 32px; height: 32px; border: 0; border-radius: 5px; background: transparent; color: inherit; &:hover {background: var(--soft);}`;
const DayUnfinished = styled(Note)`margin: 7px 0 5px 64px;`;
const tagsIn = (text: string) => [...text.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)].map(match => match[1].toLowerCase());
const dateLabel = (date: string, today: string) => date === today ? 'Today' : new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long' });
const shiftDate = (date: string, amount: number) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + amount); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const taskCollisionDetection: CollisionDetection = args => {
  const underPointer = pointerWithin(args);
  return underPointer.length ? underPointer : closestCenter(args);
};

function DateHeading({ date, today, format, highlighted }: { date: string; today: string; format: DateFormat; highlighted: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `date:${date}` });
  return <DayTitle ref={setNodeRef} $over={isOver || highlighted} data-drop-date={date} title="Drop a task here to move it to this date">
    <DateBadge dateTime={date}>{formatDateHeading(date,format)}</DateBadge><span>{dateLabel(date,today)}</span>
  </DayTitle>;
}

function DayItems({ date, today, selected, filterActive, completed, upcoming, previousItem, onChange, onMove }: {
  date: string; today: string; selected: boolean; filterActive:boolean; completed: TodoItem[]; upcoming: TodoItem[];
  previousItem:(id:string)=>TodoItem|undefined;
  onChange: (id: string, change: (item: TodoItem, items: TodoItem[]) => void) => void;
  onMove: (id: string, target: string) => void;
}) {
  const [doneExpanded, setDoneExpanded] = useState(filterActive && completed.length > 0);
  const previousDoneCount = useRef(completed.length);
  useEffect(() => {
    if ((filterActive && completed.length > 0) || completed.length > previousDoneCount.current) setDoneExpanded(true);
    previousDoneCount.current = completed.length;
  }, [completed.length, filterActive]);
  return <>
    {(completed.length > 0 || selected) && <DoneToggle type="button" aria-expanded={doneExpanded} aria-controls={`done-${date}`} aria-label={`${doneExpanded?'Collapse':'Expand'} done items for ${date}`} onClick={() => setDoneExpanded(value => !value)}><ChevronDown size={14} style={{transform:doneExpanded?'rotate(0deg)':'rotate(-90deg)',transition:'transform 180ms ease-out'}}/><span>done</span><DoneCount aria-hidden="true">{completed.length}</DoneCount></DoneToggle>}
    <CompletedClip id={`done-${date}`} $open={doneExpanded} aria-hidden={!doneExpanded} inert={!doneExpanded}><div><SortableContext items={completed.map(item => item.id)} strategy={verticalListSortingStrategy}>
      {completed.map(item => <JournalItem key={item.id} item={item} previousItem={previousItem(item.id)} date={date} today={today} onChange={change => onChange(item.id,change)} onMove={target => onMove(item.id,target)}/>)}
    </SortableContext></div></CompletedClip>
    <Divider aria-hidden="true"/>
    {(upcoming.length > 0 || selected) && <SectionCaption>upcoming</SectionCaption>}
    <SortableContext items={upcoming.map(item => item.id)} strategy={verticalListSortingStrategy}>
      {upcoming.map(item => <JournalItem key={item.id} item={item} previousItem={previousItem(item.id)} date={date} today={today} onChange={change => onChange(item.id,change)} onMove={target => onMove(item.id,target)}/>)}
    </SortableContext>
    {date < today && upcoming.length > 0 && <DayUnfinished>{upcoming.length} unfinished on this day</DayUnfinished>}
  </>;
}

export default function App() {
  const [state, setState] = useState<TodoState | null>(null);
  const current = useRef<TodoState>(emptyState());
  const previousDocument = useRef<TodoDocument | null>(null);
  const [selectedDate, setSelectedDate] = useState(todayString);
  const [dateFormat, setDateFormatState] = useState(getDateFormat);
  const [dateOpen, setDateOpen] = useState(false);
  const dateControlRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [review, setReview] = useState<FileReviewState | null>(null);
  const [choices, setChoices] = useState<Record<string, MergeChoice>>({});
  const [rawEdit, setRawEdit] = useState('');
  const [issues, setIssues] = useState<ParseIssue[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const undoStack = useRef<TodoDocument[]>([]);
  const redoStack = useRef<TodoDocument[]>([]);
  const today = todayString();
  const dragSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  useEffect(() => {
    if (!dateOpen) return;
    const outside = (event: PointerEvent) => { if (!dateControlRef.current?.contains(event.target as Node)) setDateOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setDateOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [dateOpen]);

  useEffect(() => { loadTodoState().then(loaded => { current.current = loaded; setState(loaded); }).catch(error => setMessage(`Could not open IndexedDB: ${String(error)}`)); }, []);
  useEffect(() => { if (state) previousDocument.current = state.document; }, [state?.document]);
  const commitState = async (next: TodoState) => {
    const stamped = { ...next, revision: Math.max(current.current.revision, next.revision) + 1 };
    current.current = stamped;
    setState(stamped);
    await saveTodoState(stamped);
  };
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
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() => { searchInput.current?.focus(); searchInput.current?.select(); });
        return;
      }
      const target = event.target as HTMLElement;
      if (target.closest('input,textarea,[contenteditable=true]')) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  const mutateItem = (date: string, id: string, change: (item: TodoItem, items: TodoItem[]) => void) => edit(document => {
    const items = document.days.find(day => day.date === date)?.items;
    const item = items?.find(item => item.id === id);
    if (items && item) change(item, items);
  });
  const dropItem = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    edit(document => {
      const source = document.days.find(day => day.items.some(item => item.id === activeId));
      if (!source) return;
      const targetDate = overId.startsWith('date:')
        ? overId.slice(5)
        : document.days.find(day => day.items.some(item => item.id === overId))?.date;
      if (!targetDate || !validDate(targetDate)) return;
      const from = source.items.findIndex(item => item.id === activeId);
      const sourceDate = source.date;
      const [moved] = source.items.splice(from, 1);
      let destination = document.days.find(day => day.date === targetDate);
      if (!destination) { destination = { date: targetDate, items: [] }; document.days.push(destination); }
      const target = destination.items.find(item => item.id === overId);
      if (target) {
        const beforeTarget = sourceDate !== targetDate || from > destination.items.indexOf(target);
        if (sourceDate === targetDate) moved.completed = target.completed;
        destination.items.splice(destination.items.indexOf(target) + (beforeTarget ? 0 : 1), 0, moved);
      } else destination.items.push(moved);
      document.days = document.days.filter(day => day.items.length);
      document.days.sort((a,b) => a.date.localeCompare(b.date));
    });
  };
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
    if (parsed.issues.length) { setRawEdit(raw); setIssues(parsed.issues); setReview({ raw, proposal: { rows: [], conflicts: [] }, handle, mode, observedText }); return; }
    const proposal = proposeMerge(current.current.document, parsed.document, current.current.baseline);
    if (proposal.conflicts.length) { setChoices({}); setIssues([]); setReview({ raw, proposal, handle, mode, observedText }); return; }
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
  const priorDocument = previousDocument.current;
  const priorItems = new Map(priorDocument?.days.flatMap(day => day.items.map(item => [item.id, item] as const)));
  const draggingItem = draggingId ? documentData.days.flatMap(day => day.items).find(item => item.id === draggingId) : null;
  const dateForDrop = (id: string | undefined) => id ? id.startsWith('date:') ? id.slice(5) : documentData.days.find(day => day.items.some(item => item.id === id))?.date ?? null : null;
  const allTags = useMemo(() => [...new Set(documentData.days.flatMap(day => day.items.flatMap(item => [item.text, ...item.details.map(detail => detail.text)].flatMap(tagsIn))))].sort(), [documentData]);
  const visibleDays = useMemo(() => {
    const dates = new Set([selectedDate, ...documentData.days.map(day => day.date)]);
    return [selectedDate, ...[...dates].filter(date => date !== selectedDate).sort((a,b) => b.localeCompare(a))].map(date => ({ date, items: documentData.days.find(day => day.date === date)?.items ?? [] }));
  }, [documentData, selectedDate]);
  const matches = (item: TodoItem) => {
    const content = [item.text, ...item.details.map(detail => detail.text)].join(' ').toLowerCase();
    return (!query || content.includes(query.toLowerCase())) && (!tag || tagsIn(content).includes(tag));
  };
  const hasResults = visibleDays.some(day => day.items.some(matches));
  if (!state) return <Page><Muted role="status">{message || 'Opening journal…'}</Muted></Page>;
  return <Page>
    <a href="#journal-content" className="skip-link">Skip to journal</a>
    <VisuallyHidden as="h1">Hito daily journal</VisuallyHidden>
    <Header>
    <Toolbar>
      <Icon aria-label="Previous day" onClick={() => setSelectedDate(shiftDate(selectedDate,-1))}><ChevronLeft size={17}/></Icon>
      <DateControl ref={dateControlRef}>
        <DateText aria-label={`Go to today from ${selectedDate}`} title="Go to today" onClick={() => { setSelectedDate(todayString()); setDateOpen(false); }}>{new Date(`${selectedDate}T12:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}</DateText>
        <DateCalendar aria-label="Choose date" aria-expanded={dateOpen} title="Choose date" onClick={() => setDateOpen(value => !value)}><CalendarDays size={17}/></DateCalendar>
        {dateOpen && <DatePopover><CalendarPanel label="Choose journal date" value={selectedDate} onSelect={value => { setSelectedDate(value); setDateOpen(false); }}/></DatePopover>}
      </DateControl>
      <Icon aria-label="Next day" onClick={() => setSelectedDate(shiftDate(selectedDate,1))}><ChevronRight size={17}/></Icon>
      <SearchWrap $open={searchOpen}><Icon ref={searchButton} aria-label={searchOpen?'Close search':'Open search'} aria-expanded={searchOpen} aria-controls="journal-search-panel" onClick={() => { if (searchOpen) { setSearchOpen(false); setQuery(''); } else { setSearchOpen(true); requestAnimationFrame(() => searchInput.current?.focus()); } }}>{searchOpen?<X size={17}/>:<Search size={17}/>}</Icon>
        <SearchBox id="journal-search-panel" $open={searchOpen} aria-hidden={!searchOpen} inert={!searchOpen}><SearchField ref={searchInput} id="journal-search" type="search" aria-label="Search journal" placeholder="Search the text file" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if(event.key==='Escape') { setSearchOpen(false); setQuery(''); searchButton.current?.focus(); } }}/>
        {query && <ClearSearch aria-label="Clear search" onClick={() => setQuery('')}><X size={15}/></ClearSearch>}</SearchBox>
      </SearchWrap>
    </Toolbar>
    <Tools>
      <Icon title="Import TODO.txt" aria-label="Import TODO.txt" onClick={() => importInput.current?.click()}><FileInput size={17}/></Icon>
      {supportsDirectFiles() && <Icon title="Open TODO.txt" aria-label="Open TODO.txt" disabled={busy} onClick={() => void openFile()}><FolderOpen size={17}/></Icon>}
      <Icon title="Download TODO.txt" aria-label="Download TODO.txt" onClick={() => void download()}><Download size={17}/></Icon>
      {supportsDirectFiles() && <Icon title="Save connected TODO.txt" aria-label="Save connected TODO.txt" disabled={busy || !state.fileHandle} onClick={() => void save()}><Save size={17}/></Icon>}
      <Icon title="Hito settings" aria-label="Hito settings" onClick={() => setSettingsOpen(true)}><Settings2 size={17}/></Icon>
    </Tools>
    </Header>
    <input ref={importInput} type="file" accept=".txt,text/plain" hidden aria-label="Import a TODO.txt file" onChange={event => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = ''; }}/>
    {!!allTags.length && <TagRail aria-label="Tags"><TagPill $active={!tag} onClick={() => setTag(null)}>all</TagPill>{allTags.map(name => <TagPill key={name} $active={tag === name} onClick={() => setTag(tag === name ? null : name)}>#{name}</TagPill>)}</TagRail>}
    {message && <Notice role="status">{message} <Dismiss aria-label="Dismiss message" onClick={() => setMessage('')}>×</Dismiss></Notice>}
    <div id="journal-content" tabIndex={-1}>
    {(query || tag) && !hasResults && <EmptyResults role="status">No lines match this search. <Button onClick={() => { setQuery(''); setTag(null); }}>clear filters</Button></EmptyResults>}
    <DndContext sensors={dragSensors} collisionDetection={taskCollisionDetection}
      onDragStart={({ active }) => { setDraggingId(String(active.id)); setDragOverDate(null); }}
      onDragOver={({ over }) => setDragOverDate(dateForDrop(over ? String(over.id) : undefined))}
      onDragCancel={() => { setDraggingId(null); setDragOverDate(null); }}
      onDragEnd={event => { dropItem(event); setDraggingId(null); setDragOverDate(null); }}>
    {visibleDays.map(day => {
      const completed = day.items.filter(item => item.completed && matches(item));
      const upcoming = day.items.filter(item => !item.completed && matches(item));
      if ((query || tag) && !completed.length && !upcoming.length) return null;
      return <DaySection key={`${day.date}:${day.date===selectedDate?'selected':'other'}`} $selected={day.date===selectedDate} aria-label={`${dateLabel(day.date,today)}, ${day.date}`}>
        <DateHeading date={day.date} today={today} format={dateFormat} highlighted={!!draggingId && dragOverDate === day.date}/>
        {day.date === selectedDate && day.items.length === 0 && !query && !tag ? <EmptyDay>No lines yet. Add the first one below.</EmptyDay> : <>
        <DayItems date={day.date} today={today} selected={day.date === selectedDate} filterActive={!!(query||tag)} completed={completed} upcoming={upcoming} previousItem={id=>priorItems.get(id)} onChange={(id,change) => mutateItem(day.date,id,change)} onMove={(id,target) => moveItem(day.date,id,target)}/>
        </>}
        {day.date === selectedDate && !query && !tag && <AddItem onAdd={text => addItem(day.date,text)}/>}
      </DaySection>;
    })}
    {createPortal(<DragOverlay dropAnimation={null} modifiers={[restrictToWindowEdges]} style={{ width: 'min(360px, calc(100vw - 32px))' }} zIndex={40}>{draggingItem && <DragPreview aria-label={`Dragging ${draggingItem.text}`}><PreviewCircle $done={draggingItem.completed}/><PreviewText $done={draggingItem.completed}>{draggingItem.text}</PreviewText></DragPreview>}</DragOverlay>, window.document.body)}
    </DndContext>
    </div>
    <AppearanceSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} dateFormat={dateFormat} onDateFormatChange={value => { setDateFormat(value); setDateFormatState(value); }}/>
    <FileReview review={review} issues={issues} rawEdit={rawEdit} choices={choices} busy={busy}
      onClose={() => { setReview(null); setIssues([]); }} onRawEdit={setRawEdit}
      onChoice={(key, choice) => setChoices(previous => ({ ...previous, [key]: choice }))}
      onReparse={() => void reparse()} onApply={() => void applyReview()}/>
  </Page>;
}
