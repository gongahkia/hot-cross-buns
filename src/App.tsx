import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, pointerWithin, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent } from '@dnd-kit/core';
import { createPortal, flushSync } from 'react-dom';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { restrictToWindowEdges } from '@dnd-kit/modifiers';
import styled, { keyframes } from 'styled-components';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Download, FileInput, FolderOpen, Save, Search, Settings2, X } from 'lucide-react';
import { Button, Field, IconButton, Muted, VisuallyHidden } from './styles';
import { AppearanceSettings } from './components/AppearanceSettings';
import { FileReview, type FileReviewState } from './components/FileReview';
import { AddItem, JournalItem } from './components/DailyItem';
import { JournalDatePicker } from './components/JournalDatePicker';
import { ExportPreview, type LineEnding } from './components/ExportPreview';
import { datesInRange, shiftDate, shiftRange, weekRange, type DateSpan } from './dayWindow';
import { formatDateHeading, getDateFormat, setDateFormat, type DateFormat } from './preferences';
import { cloneDocument, emptyDocument, newId, parseTodoText, serializeTodoText, todayString, validDate, validateDocument, type TodoDocument, type TodoItem, type ParseIssue } from './todoText';
import { fileBaseline, proposeMerge, resolveMerge, type MergeChoice } from './todoMerge';
import { advanceRecurrences } from './recurrence';
import { parseTimeBlock } from './timeBlock';
import { emptyState, loadTodoState, pickTodoFile, saveTodoState, supportsDirectFiles, type TodoFileHandle, type TodoState } from './todoStore';

const Page = styled.main`width: min(730px, calc(100% - 40px)); min-height: 100dvh; margin: 0 auto; padding: 35px 0 80px; @media(max-width: 600px){width: calc(100% - 28px); padding-top: 16px;}`;
const Header = styled.header<{ $revealed: boolean }>`position: relative; z-index: 40; display: flex; align-items: center; gap: 16px; min-height: 44px; margin-bottom: 20px; opacity: ${({$revealed})=>$revealed?1:0}; transition: opacity 150ms ease-out; &:hover, &:focus-within { opacity: 1; } @media(hover:none){opacity:1;} @media(max-width: 760px){flex-wrap:wrap; justify-content:flex-end;}`;
const Tools = styled.div`display: flex; align-items: center; gap: 2px; @media(max-width:390px){gap:0; > button {width:40px;}}`;
const Icon = styled(IconButton)`width: 44px; height: 44px;`;
const Toolbar = styled.div`display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; @media(max-width: 760px){order:2;flex-basis:100%;} @media(max-width: 600px){display: grid; grid-template-columns: 44px minmax(0,1fr) 44px 44px; gap: 6px;}`;
const DateControl = styled.div<{ $range:boolean }>`position: relative; display: flex; align-items: center; width: ${({$range})=>$range?'255px':'155px'}; min-width: 0; min-height: 44px; @media(max-width:600px){width:100%;}`;
const DateText = styled.button`flex: 1; min-width: 0; min-height: 44px; padding: 8px 0 8px 4px; border: 0; border-radius: 7px; background: transparent; color: var(--ink); font-size: 13px; text-align: left; white-space: nowrap; overflow:hidden; text-overflow:ellipsis; &:hover { text-decoration: underline; text-underline-offset: 3px; font-weight: 600; } .compact{display:none;} @media(max-width:600px){.full{display:none;} .compact{display:inline;}}`;
const DateCalendar = styled(IconButton)`width: 44px; height: 44px; color: var(--ink);`;
const DatePopover = styled.div`position: absolute; top: calc(100% + 6px); left: 0; z-index: 30; @media(max-width: 390px){left: -50px;}`;
const SearchBox = styled.div`position:relative; flex:1; min-width:0; @media(max-width:600px){grid-column:1 / -1;}`;
const SearchField = styled(Field)`min-height: 44px; width: 100%; padding-right: 44px; font-size: 13px; &::-webkit-search-cancel-button { display: none; }`;
const ClearSearch = styled(IconButton)`position: absolute; right: 0; top: 0; width: 44px; height: 44px;`;
const TagRail = styled.nav`display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 24px;`;
const TagPill = styled.button<{ $active: boolean }>`min-height: 36px; border: 1px solid ${({ $active }) => $active ? 'var(--tag-selected)' : 'var(--line)'}; color: ${({ $active }) => $active ? 'var(--tag-selected)' : 'var(--tag-ink)'}; background: var(--tag-bg); padding: 5px 10px; border-radius: 999px; font-size: 12px; @media(pointer:coarse){min-height:44px;}`;
const dayEnter = keyframes`from { opacity:.45; transform:translateY(5px); } to { opacity:1; transform:translateY(0); }`;
const DaySection = styled.section<{ $selected:boolean }>`margin: 0 0 38px; scroll-margin-top: 20px; animation:${({$selected})=>$selected?dayEnter:'none'} 180ms ease-out;`;
const DayTitle = styled.h2<{ $over?: boolean }>`display: flex; align-items: center; gap: 10px; min-width: 0; font-size: 15px; margin-bottom: 10px; border-radius: 9px; background: ${({ $over }) => $over ? 'var(--soft)' : 'transparent'}; box-shadow: ${({ $over }) => $over ? '0 0 0 2px var(--focus)' : 'none'};`;
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
const EmptyResults = styled.div`padding: 18px 0 28px; color: var(--muted); font-size: 14px;`;
const Notice = styled(Note)`display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 14px;`;
const Dismiss = styled.button`width: 32px; height: 32px; border: 0; border-radius: 5px; background: transparent; color: inherit; &:hover {background: var(--soft);}`;
const DayUnfinished = styled.span`display: inline-flex; align-items: center; gap: 6px; margin-left: auto; color: var(--link); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; .short-label{display:none;} @media(max-width:600px){ .long-label{display:none;} .short-label{display:inline;} }`;
const LEGACY_RAW_DRAFT_KEY = 'hito-raw-draft-v1';
const SAVED_RANGE_KEY = 'hito-journal-range-v1';
const readSavedRange = (): DateSpan | null => {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_RANGE_KEY) ?? 'null') as DateSpan | null;
    return saved && validDate(saved.from) && validDate(saved.to) && saved.from <= saved.to ? saved : null;
  } catch { return null; }
};
const downloadTextFile = (text: string, fileName: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const tagsIn = (text: string) => [...text.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)].map(match => match[1].toLowerCase());
const dateLabel = (date: string, today: string) => date === today ? 'Today' : new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long' });
const navDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
const compactRange = ({ from, to }: DateSpan) => {
  const start = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  const startLabel = start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()
    ? `${start.getDate()}–${end.getDate()} ${end.toLocaleDateString('en-GB', { month: 'short' })}`
    : `${startLabel}–${end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
};
const taskCollisionDetection: CollisionDetection = args => {
  const underPointer = pointerWithin(args);
  return underPointer.length ? underPointer : closestCenter(args);
};
type HistoryRow = { element: HTMLElement; left: number; top: number; signature: string };
const visibleHistoryRows = () => {
  const visible = new Map<string, HistoryRow>();
  for (const row of document.querySelectorAll<HTMLElement>('[data-transition-id]')) {
    if (row.closest('[aria-hidden="true"]')) continue;
    const bounds = row.getBoundingClientRect();
    if (bounds.bottom < -48 || bounds.top > window.innerHeight + 48) continue;
    const signature = [row.getAttribute('aria-label'), ...[...row.querySelectorAll('textarea')].map(field => field.value), ...[...row.querySelectorAll('[aria-pressed]')].map(button => button.getAttribute('aria-pressed'))].join('\u0000');
    visible.set(row.dataset.transitionId!, { element: row, left: bounds.left, top: bounds.top, signature });
  }
  return visible;
};
const tagVisibleHistoryRows = (tagged: Set<HTMLElement>) => {
  for (const [id, { element }] of visibleHistoryRows()) {
    element.style.viewTransitionName = `hito-item-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    tagged.add(element);
  }
};
const changedHistoryIds = (before: TodoDocument, after: TodoDocument) => {
  const prior = new Map(before.days.flatMap(day => day.items.map(item => [item.id, JSON.stringify([day.date, item.text, item.completed, item.details])] as const)));
  const changed = new Set<string>();
  for (const day of after.days) for (const item of day.items) {
    if (prior.get(item.id) !== JSON.stringify([day.date, item.text, item.completed, item.details])) changed.add(item.id);
  }
  return changed;
};
const animateHistoryFallback = (before: Map<string, HistoryRow>, changed: Set<string>) => {
  for (const [id, after] of visibleHistoryRows()) {
    const previous = before.get(id);
    const dx = previous ? Math.max(-24, Math.min(24, previous.left - after.left)) : 0;
    const dy = previous ? Math.max(-24, Math.min(24, previous.top - after.top)) : 6;
    if (previous && Math.abs(dx) < 1 && Math.abs(dy) < 1 && previous.signature === after.signature && !changed.has(id)) continue;
    after.element.animate([
      { opacity: previous ? .72 : 0, transform: `translate(${dx}px, ${dy}px)` },
      { opacity: 1, transform: 'translate(0px, 0px)' },
    ], { duration: 220, easing: 'cubic-bezier(.2, 0, 0, 1)' });
  }
};

function DateHeading({ date, today, format, highlighted, unfinished }: { date: string; today: string; format: DateFormat; highlighted: boolean; unfinished: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `date:${date}` });
  return <DayTitle ref={setNodeRef} $over={isOver || highlighted} data-drop-date={date} title="Drop a task here to move it to this date">
    <DateBadge dateTime={date}>{formatDateHeading(date,format)}</DateBadge><span>{dateLabel(date,today)}</span>
    {date < today && unfinished > 0 && <DayUnfinished title={`${unfinished} unfinished on this day`} aria-label={`${unfinished} unfinished on this day`}><CircleAlert size={14} aria-hidden="true"/><span className="long-label">{unfinished} unfinished on this day</span><span className="short-label" aria-hidden="true">{unfinished}</span></DayUnfinished>}
  </DayTitle>;
}

function DayItems({ date, items, selected, filterActive, completed, upcoming, previousItem, onChange, onMove, onMakeDetail, onAddAfter }: {
  date: string; items: TodoItem[]; selected: boolean; filterActive:boolean; completed: TodoItem[]; upcoming: TodoItem[];
  previousItem:(id:string)=>TodoItem|undefined;
  onChange: (id: string, change: (item: TodoItem, items: TodoItem[]) => void) => void;
  onMove: (id: string, target: string) => void;
  onMakeDetail: (id: string, parentId: string) => void;
  onAddAfter: (id: string, text: string) => void;
}) {
  const [draftAfterId, setDraftAfterId] = useState<string | null>(null);
  const [doneExpanded, setDoneExpanded] = useState(filterActive);
  const filterWasActive = useRef(filterActive);
  const expandedBeforeFilter = useRef(false);
  const doneVisible = doneExpanded;
  useEffect(() => {
    if (filterActive && !filterWasActive.current) {
      expandedBeforeFilter.current = doneExpanded;
      setDoneExpanded(true);
    } else if (!filterActive && filterWasActive.current) setDoneExpanded(expandedBeforeFilter.current);
    filterWasActive.current = filterActive;
  }, [filterActive]);
  return <>
    {(completed.length > 0 || selected) && <DoneToggle type="button" aria-expanded={doneVisible} aria-controls={`done-${date}`} aria-label={`${doneVisible?'Collapse':'Expand'} done items for ${date}`} onClick={() => setDoneExpanded(value => !value)}><ChevronDown size={14} style={{transform:doneVisible?'rotate(0deg)':'rotate(-90deg)',transition:'transform 180ms ease-out'}}/><span>done</span><DoneCount aria-hidden="true">{completed.length}</DoneCount></DoneToggle>}
    <CompletedClip id={`done-${date}`} $open={doneVisible} aria-hidden={!doneVisible} inert={!doneVisible}><div><SortableContext items={completed.map(item => item.id)} strategy={verticalListSortingStrategy}>
      {completed.map(item => <Fragment key={item.id}><JournalItem item={item} parentItems={items} previousItem={previousItem(item.id)} date={date} onChange={change => onChange(item.id,change)} onMove={target => onMove(item.id,target)} onMakeDetail={parentId => onMakeDetail(item.id, parentId)} onStartNext={() => setDraftAfterId(item.id)}/>{draftAfterId === item.id && <AddItem inline autoFocus onAdd={text => onAddAfter(item.id,text)} onCancel={() => setDraftAfterId(null)}/>}</Fragment>)}
    </SortableContext></div></CompletedClip>
    <Divider aria-hidden="true"/>
    {(upcoming.length > 0 || selected) && <SectionCaption>upcoming</SectionCaption>}
    <SortableContext items={upcoming.map(item => item.id)} strategy={verticalListSortingStrategy}>
      {upcoming.map(item => <Fragment key={item.id}><JournalItem item={item} parentItems={items} previousItem={previousItem(item.id)} date={date} onChange={change => onChange(item.id,change)} onMove={target => onMove(item.id,target)} onMakeDetail={parentId => onMakeDetail(item.id, parentId)} onStartNext={() => setDraftAfterId(item.id)}/>{draftAfterId === item.id && <AddItem inline autoFocus onAdd={text => onAddAfter(item.id,text)} onCancel={() => setDraftAfterId(null)}/>}</Fragment>)}
    </SortableContext>
  </>;
}

export default function App() {
  const [state, setState] = useState<TodoState | null>(null);
  const current = useRef<TodoState>(emptyState());
  const previousDocument = useRef<TodoDocument | null>(null);
  const [initialRange] = useState(readSavedRange);
  const [selectedDate, setSelectedDate] = useState(todayString);
  const [dateFormat, setDateFormatState] = useState(getDateFormat);
  const [viewMode, setViewMode] = useState<'day' | 'range'>('range');
  const [activeRange, setActiveRange] = useState<DateSpan>(() => initialRange ?? weekRange(todayString()));
  const [rangeCustomized, setRangeCustomized] = useState(!!initialRange);
  const [dateOpen, setDateOpen] = useState(false);
  const dateControlRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [legacyRawDraft, setLegacyRawDraft] = useState<string | null>(null);
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
  const activeHistoryTransition = useRef<{ transition: ViewTransition; rows: Set<HTMLElement> } | null>(null);
  const today = todayString();
  const dragSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  useEffect(() => {
    try {
      if (viewMode === 'range' && rangeCustomized) localStorage.setItem(SAVED_RANGE_KEY, JSON.stringify(activeRange));
      else localStorage.removeItem(SAVED_RANGE_KEY);
    } catch { /* The visible range still works for this session. */ }
  }, [viewMode, activeRange, rangeCustomized]);

  useEffect(() => {
    if (!dateOpen) return;
    const outside = (event: PointerEvent) => { if (!dateControlRef.current?.contains(event.target as Node)) setDateOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setDateOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [dateOpen]);

  useEffect(() => { loadTodoState().then(loaded => {
    current.current = loaded;
    setState(loaded);
    try {
      const draft = sessionStorage.getItem(LEGACY_RAW_DRAFT_KEY);
      if (draft === serializeTodoText(loaded.document)) sessionStorage.removeItem(LEGACY_RAW_DRAFT_KEY);
      else if (draft !== null) setLegacyRawDraft(draft);
    } catch { /* The journal remains available if session storage is blocked. */ }
  }).catch(error => setMessage(`Could not open IndexedDB: ${String(error)}`)); }, []);
  useEffect(() => { if (state) previousDocument.current = state.document; }, [state?.document]);
  const commitState = async (next: TodoState) => {
    const stamped = { ...next, revision: Math.max(current.current.revision, next.revision) + 1 };
    current.current = stamped;
    setState(stamped);
    await saveTodoState(stamped);
  };
  const replayState = (documentData: TodoDocument) => {
    const next = { ...current.current, document: documentData };
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduceMotion && document.startViewTransition) {
      const active = activeHistoryTransition.current;
      if (active) {
        active.transition.skipTransition();
        active.rows.forEach(row => { row.style.viewTransitionName = 'none'; });
      }
      const rows = new Set<HTMLElement>();
      tagVisibleHistoryRows(rows);
      const stamped = { ...next, revision: Math.max(current.current.revision, next.revision) + 1 };
      current.current = stamped;
      const transition = document.startViewTransition(() => {
        flushSync(() => setState(stamped));
        rows.forEach(row => { row.style.viewTransitionName = 'none'; });
        tagVisibleHistoryRows(rows);
      });
      activeHistoryTransition.current = { transition, rows };
      const clearNames = () => {
        if (activeHistoryTransition.current?.transition !== transition) return;
        rows.forEach(row => { row.style.viewTransitionName = 'none'; });
        activeHistoryTransition.current = null;
      };
      void transition.finished.then(clearNames, clearNames);
      void saveTodoState(stamped).catch(error => setMessage(`Could not save: ${String(error)}`));
    } else if (!reduceMotion) {
      const before = visibleHistoryRows();
      const changed = changedHistoryIds(current.current.document, documentData);
      const stamped = { ...next, revision: Math.max(current.current.revision, next.revision) + 1 };
      current.current = stamped;
      flushSync(() => setState(stamped));
      animateHistoryFallback(before, changed);
      void saveTodoState(stamped).catch(error => setMessage(`Could not save: ${String(error)}`));
    } else void commitState(next).catch(error => setMessage(`Could not save: ${String(error)}`));
  };
  const commitDocumentState = async (next: TodoState) => {
    if (serializeTodoText(current.current.document) !== serializeTodoText(next.document)) {
      undoStack.current.push(current.current.document);
      if (undoStack.current.length > 100) undoStack.current.shift();
      redoStack.current = [];
    }
    await commitState(next);
  };
  const edit = (change: (document: TodoDocument) => void) => {
    const before = current.current.document;
    const document = cloneDocument(before);
    change(document);
    advanceRecurrences(before, document, todayString());
    try { validateDocument(document); } catch (error) { setMessage(String(error)); return; }
    if (serializeTodoText(before) === serializeTodoText(document)) return;
    undoStack.current.push(before);
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
    void commitState({ ...current.current, document }).catch(error => setMessage(`Could not save: ${String(error)}`));
  };
  const undo = () => { const previous = undoStack.current.pop(); if (!previous) return; redoStack.current.push(current.current.document); replayState(previous); };
  const redo = () => { const next = redoStack.current.pop(); if (!next) return; undoStack.current.push(current.current.document); replayState(next); };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setDateOpen(false);
        setSearchOpen(true);
        requestAnimationFrame(() => { searchInput.current?.focus(); searchInput.current?.select(); });
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        if (exportOpen) return;
        event.preventDefault();
        const target = event.target;
        if (target instanceof HTMLTextAreaElement && target.hasAttribute('data-journal-entry')) target.blur();
        event.shiftKey ? redo() : undo();
      }
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
        if (sourceDate === targetDate && moved.completed !== target.completed) {
          moved.completed = target.completed;
          moved.details.forEach(detail => { detail.completed = target.completed; });
        }
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
  const addItemAfter = (date: string, id: string, text: string) => { if (!text.trim()) return; edit(document => {
    const items = document.days.find(day => day.date === date)?.items;
    const index = items?.findIndex(item => item.id === id) ?? -1;
    if (items && index >= 0) items.splice(index + 1, 0, { id: newId(), text: text.trim(), details: [], completed: false });
  }); };
  const makeDetail = (date: string, id: string, parentId: string) => edit(document => {
    const items = document.days.find(day => day.date === date)?.items;
    const index = items?.findIndex(item => item.id === id) ?? -1;
    const parent = items?.find(item => item.id === parentId);
    if (!items || index < 0 || !parent || id === parentId || items[index].repeat || parseTimeBlock(items[index].text)) return;
    const [child] = items.splice(index, 1);
    parent.details.push({ text: child.text, completed: child.completed }, ...child.details);
    parent.completed = parent.details.every(detail => detail.completed);
  });
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
    setViewMode('day');
  };
  const imported = async (raw: string, handle: TodoFileHandle | null, mode: 'import' | 'save', observedText: string | null = null) => {
    const parsed = parseTodoText(raw);
    if (parsed.issues.length) { setRawEdit(raw); setIssues(parsed.issues); setReview({ raw, proposal: { rows: [], conflicts: [] }, handle, mode, observedText }); return; }
    const proposal = proposeMerge(current.current.document, parsed.document, current.current.baseline);
    if (proposal.conflicts.length) { setChoices({}); setIssues([]); setReview({ raw, proposal, handle, mode, observedText }); return; }
    const merged = resolveMerge(proposal, {});
    advanceRecurrences(current.current.document, merged, todayString());
    validateDocument(merged);
    if (mode === 'save' && handle) await saveToHandle(handle, merged, observedText ?? raw);
    else { await commitDocumentState({ ...current.current, document: merged, baseline: fileBaseline(proposal), baselineText: raw, fileHandle: handle }); setMessage('TODO.txt imported.'); }
  };
  const saveToHandle = async (handle: TodoFileHandle, document: TodoDocument, observed: string) => {
    if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted' && await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('File access was not granted.');
    const latest = await (await handle.getFile()).text();
    if (latest !== observed) {
      // Keep the user's completed review as the local side of the next merge.
      await commitDocumentState({ ...current.current, document });
      await imported(latest, handle, 'save', latest);
      return;
    }
    const output = serializeTodoText(document);
    const writable = await handle.createWritable();
    await writable.write(output);
    await writable.close();
    await commitDocumentState({ ...current.current, document, baseline: cloneDocument(document), baselineText: output, fileHandle: handle });
    setReview(null); setMessage(`Saved ${handle.name}.`);
  };
  const importFile = async (file: File) => { setBusy(true); try { await imported(await file.text(), null, 'import'); } catch (error) { setMessage(String(error)); } finally { setBusy(false); } };
  const openFile = async () => { setBusy(true); try { const handle = await pickTodoFile(); await imported(await (await handle.getFile()).text(), handle, 'import'); } catch (error) { if ((error as Error).name !== 'AbortError') setMessage(String(error)); } finally { setBusy(false); } };
  const download = async (fileName: string, lineEnding: LineEnding) => {
    const output = serializeTodoText(current.current.document);
    const fileText = lineEnding === 'crlf' ? output.replace(/\n/g, '\r\n') : output;
    downloadTextFile(fileText, fileName);
    setExportOpen(false);
    if (!current.current.fileHandle) await commitState({ ...current.current, baseline: cloneDocument(current.current.document), baselineText: fileText });
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
      advanceRecurrences(current.current.document, merged, todayString());
      validateDocument(merged);
      if (review.mode === 'save' && review.handle) await saveToHandle(review.handle, merged, review.observedText ?? review.raw);
      else {
        await commitDocumentState({ ...current.current, document: merged, baseline: fileBaseline(review.proposal), baselineText: review.raw, fileHandle: review.handle });
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
  const rangeActive = viewMode === 'range';
  const moveDateView = (direction: -1 | 1) => {
    if (rangeActive) {
      const shifted = shiftRange(activeRange, direction * datesInRange(activeRange).length);
      setActiveRange(shifted);
      setRangeCustomized(true);
    } else setSelectedDate(date => shiftDate(date, direction));
  };
  const allTags = useMemo(() => [...new Set(documentData.days.flatMap(day => day.items.flatMap(item => [item.text, ...item.details.map(detail => detail.text)].flatMap(tagsIn))))].sort(), [documentData]);
  const unfinishedDates = useMemo(() => new Set(documentData.days.filter(day => day.items.some(item => !item.completed)).map(day => day.date)), [documentData]);
  const visibleDays = useMemo(() => {
    const daysByDate = new Map(documentData.days.map(day => [day.date, day] as const));
    const dates = query || tag
      ? [selectedDate, ...[...daysByDate.keys()].filter(date => date !== selectedDate).sort((a,b) => b.localeCompare(a))]
      : rangeActive ? datesInRange(activeRange) : [selectedDate];
    return dates.map(date => ({ date, items: daysByDate.get(date)?.items ?? [] }));
  }, [documentData, selectedDate, viewMode, activeRange, rangeActive, query, tag]);
  const filteredDays = useMemo(() => {
    const needle = query.toLowerCase();
    return visibleDays.map(day => {
      if (!needle && !tag) return { ...day, completed: day.items.filter(item => item.completed), upcoming: day.items.filter(item => !item.completed) };
      const completed: TodoItem[] = [];
      const upcoming: TodoItem[] = [];
      for (const item of day.items) {
        const content = `${item.text} ${item.details.map(detail => detail.text).join(' ')}`.toLowerCase();
        if ((!needle || content.includes(needle)) && (!tag || tagsIn(content).includes(tag))) (item.completed ? completed : upcoming).push(item);
      }
      return { ...day, completed, upcoming };
    });
  }, [visibleDays, query, tag]);
  const hasResults = filteredDays.some(day => day.completed.length + day.upcoming.length > 0);
  if (!state) return <Page><Muted role="status">{message || 'Opening journal…'}</Muted></Page>;
  return <Page>
    <a href="#journal-content" className="skip-link">Skip to journal</a>
    <VisuallyHidden as="h1">Hito daily journal</VisuallyHidden>
    <Header $revealed={searchOpen || dateOpen}>
    <Toolbar>
      <SearchBox id="journal-search-panel" hidden={!searchOpen}>{searchOpen && <><SearchField ref={searchInput} id="journal-search" type="search" aria-label="Search journal" placeholder="Search the text file" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if(event.key==='Escape') { setSearchOpen(false); setQuery(''); searchButton.current?.focus(); } }}/>
        {query && <ClearSearch aria-label="Clear search" onClick={() => setQuery('')}><X size={15}/></ClearSearch>}</>}</SearchBox>
      {!searchOpen && <>
      <Icon aria-label={rangeActive?'Previous range':'Previous day'} onClick={() => moveDateView(-1)}><ChevronLeft size={17}/></Icon>
      <DateControl ref={dateControlRef} $range={rangeActive}>
        <DateText aria-label={rangeActive ? `Viewing ${activeRange.from} to ${activeRange.to}; go to today` : `Go to today from ${selectedDate}`} title="Go to today" onClick={() => { const today = todayString(); setSelectedDate(today); setActiveRange(weekRange(today)); setRangeCustomized(false); setViewMode('range'); setDateOpen(false); }}><span className="full">{rangeActive ? `${navDate(activeRange.from)} – ${navDate(activeRange.to)}` : navDate(selectedDate)}</span><span className="compact">{rangeActive ? compactRange(activeRange) : navDate(selectedDate)}</span></DateText>
        <DateCalendar aria-label="Choose date" aria-expanded={dateOpen} title="Choose date" onClick={() => setDateOpen(value => !value)}><CalendarDays size={17}/></DateCalendar>
        {dateOpen && <DatePopover><JournalDatePicker selectedDate={selectedDate} activeRange={activeRange} rangeActive={rangeActive} unfinishedDates={unfinishedDates}
          onSelectDate={value => { setSelectedDate(value); setViewMode('day'); setDateOpen(false); }}
          onToggleRange={active => { if (!active) setSelectedDate(todayString()); setViewMode(active ? 'range' : 'day'); }}
          onSelectRange={range => { setActiveRange(range); setRangeCustomized(true); setViewMode('range'); setDateOpen(false); }}/></DatePopover>}
      </DateControl>
      <Icon aria-label={rangeActive?'Next range':'Next day'} onClick={() => moveDateView(1)}><ChevronRight size={17}/></Icon>
      </>}
    </Toolbar>
    <Tools>
      <Icon ref={searchButton} aria-label={searchOpen?'Close search':'Open search'} aria-expanded={searchOpen} aria-controls="journal-search-panel" onClick={() => { if (searchOpen) { setSearchOpen(false); setQuery(''); } else { setDateOpen(false); setSearchOpen(true); requestAnimationFrame(() => searchInput.current?.focus()); } }}>{searchOpen?<X size={17}/>:<Search size={17}/>}</Icon>
      <Icon title="Import TODO.txt" aria-label="Import TODO.txt" onClick={() => importInput.current?.click()}><FileInput size={17}/></Icon>
      {supportsDirectFiles() && <Icon title="Open TODO.txt" aria-label="Open TODO.txt" disabled={busy} onClick={() => void openFile()}><FolderOpen size={17}/></Icon>}
      <Icon title="Download TODO.txt" aria-label="Download TODO.txt" onClick={() => setExportOpen(true)}><Download size={17}/></Icon>
      {supportsDirectFiles() && <Icon title="Save connected TODO.txt" aria-label="Save connected TODO.txt" disabled={busy || !state.fileHandle} onClick={() => void save()}><Save size={17}/></Icon>}
      <Icon title="Hito settings" aria-label="Hito settings" onClick={() => setSettingsOpen(true)}><Settings2 size={17}/></Icon>
    </Tools>
    </Header>
    <input ref={importInput} type="file" accept=".txt,text/plain" hidden aria-label="Import a TODO.txt file" onChange={event => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = ''; }}/>
    {!!allTags.length && <TagRail aria-label="Tags"><TagPill $active={!tag} onClick={() => setTag(null)}>all</TagPill>{allTags.map(name => <TagPill key={name} $active={tag === name} onClick={() => setTag(tag === name ? null : name)}>#{name}</TagPill>)}</TagRail>}
    {legacyRawDraft !== null && <Notice role="status">An unfinished TODO.txt draft from the old editor is available. <Button type="button" onClick={() => {
      downloadTextFile(legacyRawDraft, 'TODO-draft.txt');
      setLegacyRawDraft(null);
      try { sessionStorage.removeItem(LEGACY_RAW_DRAFT_KEY); } catch { /* The downloaded copy remains available. */ }
    }}>download draft</Button><Dismiss aria-label="Dismiss draft notice" onClick={() => setLegacyRawDraft(null)}>×</Dismiss></Notice>}
    {message && <Notice role="status">{message} <Dismiss aria-label="Dismiss message" onClick={() => setMessage('')}>×</Dismiss></Notice>}
    <div id="journal-content" tabIndex={-1}>
    {(query || tag) && !hasResults && <EmptyResults role="status">No lines match this search</EmptyResults>}
    <DndContext sensors={dragSensors} collisionDetection={taskCollisionDetection}
      onDragStart={({ active }) => { setDraggingId(String(active.id)); setDragOverDate(null); }}
      onDragOver={({ over }) => setDragOverDate(dateForDrop(over ? String(over.id) : undefined))}
      onDragCancel={() => { setDraggingId(null); setDragOverDate(null); }}
      onDragEnd={event => { dropItem(event); setDraggingId(null); setDragOverDate(null); }}>
    {filteredDays.map(day => {
      const { completed, upcoming } = day;
      if ((query || tag) && !completed.length && !upcoming.length) return null;
      return <DaySection key={`${day.date}:${day.date===selectedDate?'selected':'other'}`} $selected={day.date===selectedDate} aria-label={`${dateLabel(day.date,today)}, ${day.date}`}>
        <DateHeading date={day.date} today={today} format={dateFormat} highlighted={!!draggingId && dragOverDate === day.date} unfinished={upcoming.length}/>
        {day.items.length === 0 && !query && !tag ? <AddItem label={day.date === selectedDate ? 'New daily item' : `New item for ${day.date}`} onAdd={text => addItem(day.date,text)}/> : <>
        <DayItems date={day.date} items={day.items} selected={day.date === selectedDate} filterActive={!!(query||tag)} completed={completed} upcoming={upcoming} previousItem={id=>priorItems.get(id)} onChange={(id,change) => mutateItem(day.date,id,change)} onMove={(id,target) => moveItem(day.date,id,target)} onMakeDetail={(id,parentId) => makeDetail(day.date,id,parentId)} onAddAfter={(id,text) => addItemAfter(day.date,id,text)}/>
        </>}
      </DaySection>;
    })}
    {createPortal(<DragOverlay dropAnimation={null} modifiers={[restrictToWindowEdges]} style={{ width: 'min(360px, calc(100vw - 32px))' }} zIndex={40}>{draggingItem && <DragPreview aria-label={`Dragging ${draggingItem.text}`}><PreviewCircle $done={draggingItem.completed}/><PreviewText $done={draggingItem.completed}>{draggingItem.text}</PreviewText></DragPreview>}</DragOverlay>, window.document.body)}
    </DndContext>
    </div>
    <ExportPreview open={exportOpen} text={exportOpen ? serializeTodoText(state.document) : ''} onClose={() => setExportOpen(false)} onDownload={(fileName, lineEnding) => { void download(fileName, lineEnding).catch(error => setMessage(`Could not download: ${String(error)}`)); }}/>
    <AppearanceSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} dateFormat={dateFormat} onDateFormatChange={value => { setDateFormat(value); setDateFormatState(value); }}/>
    <FileReview review={review} issues={issues} rawEdit={rawEdit} choices={choices} busy={busy}
      onClose={() => { setReview(null); setIssues([]); }} onRawEdit={setRawEdit}
      onChoice={(key, choice) => setChoices(previous => ({ ...previous, [key]: choice }))}
      onReparse={() => void reparse()} onApply={() => void applyReview()}/>
  </Page>;
}
