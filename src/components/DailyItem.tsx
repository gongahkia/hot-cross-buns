import { OutlineEditor } from './OutlineEditor';
import { outlineContent, outlineNodes, promoteOutlineDetail, refreshItemCompletion, setItemCompletion } from '../outline';
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import styled, { css, keyframes } from 'styled-components';
import { createPortal } from 'react-dom';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { ArrowLeft, CalendarDays, ChevronDown, Clock3, CornerDownRight, GripVertical, MoreHorizontal, Plus, Repeat2, Trash2 } from 'lucide-react';
import { Button, Field, IconButton } from '../styles';
import { shiftDate } from '../dayWindow';
import { describeRecurrence, formatRecurrence } from '../recurrence';
import { parseTimeBlock } from '../timeBlock';
import { formatSpan, newId, todayString, type TodoDetail, type TodoItem } from '../todoText';
import type { ViewItem } from '../seriesView';
import { CalendarPanel } from './CalendarPanel';
import { ScheduleEditor } from './ScheduleEditor';
import { SpanEditor } from './SpanEditor';

const ItemRow = styled.div<{ $dragging: boolean; $standalone?: boolean }>`position: relative; display: flex; align-items: flex-start; gap: 4px; min-height: 40px; border-radius: 7px; background: ${({ $dragging }) => $dragging ? 'var(--soft)' : 'transparent'}; opacity: ${({ $dragging }) => $dragging ? .35 : 1}; &:hover { background: var(--soft); } [data-row-control] { opacity: 0; transition: opacity 120ms ease-out; } &:hover [data-row-control], &:focus-within [data-row-control] { opacity: 1; } @media(hover:none) { [data-row-control] { opacity: 1; } } @media(max-width:540px){display:grid; grid-template-columns:max-content max-content minmax(0,1fr) 44px; column-gap:4px; row-gap:0;${({ $standalone }) => $standalone ? "grid-template-columns:max-content minmax(0,1fr) 44px;[data-calendar-title]{grid-column:2;}[data-calendar-actions]{grid-column:3;}[data-calendar-actions]>button{grid-column:3;}[data-calendar-meta]{grid-column:2 / -1;}" : ""}}`;
const Grip = styled.button`width: 22px; height: 40px; display: grid; place-items: center; flex: none; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--muted); cursor: grab !important; touch-action: none; &:active { cursor: grabbing !important; } @media(pointer:coarse){width:44px;height:44px;}`;
const CheckButton = styled.button<{ $done: boolean }>`width: 34px; height: 40px; display: grid; place-items: center; flex: none; border: 0; background: transparent; color: ${({ $done }) => $done ? 'var(--link)' : 'var(--checkbox)'}; @media(pointer:coarse){width:44px;height:44px;}`;
const Circle = styled.span<{ $done: boolean; $progress?: number; $previousProgress?: number }>`
  --circle-progress: ${({ $done, $progress = 0 }) => `${($done ? 1 : $progress) * 100}%`};
  display: grid; place-items: center; width: 15px; height: 15px; border: 1px solid currentColor; border-radius: 50%;
  background: conic-gradient(var(--link) var(--circle-progress), transparent var(--circle-progress));
  color: ${({ $done }) => $done ? 'var(--link)' : 'var(--checkbox)'};
  transition: --circle-progress 280ms cubic-bezier(.2, 0, 0, 1), color 180ms ease-out;
  @starting-style { --circle-progress: ${({ $previousProgress, $done, $progress = 0 }) => `${($previousProgress ?? ($done ? 1 : $progress)) * 100}%`}; }
`;
const ItemBody = styled.div`min-width: 0; flex: 1; @media(max-width:540px){display:contents;}`;
const OutlineClip = styled.div`min-width:0;@media(max-width:540px){grid-column:1 / -1;grid-row:4;}`;
const ItemMain = styled.div`display: flex; align-items: flex-start; min-width: 0; gap: 8px; @media(max-width:540px){grid-column:3; grid-row:1; flex-direction:column; gap:0;}`;
const TimeLabel = styled.span`flex: none; padding-top: 10px; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; @media(pointer:coarse){padding-top: 12px;} @media(max-width:540px){padding-top:0;}`;
const RepeatLabel = styled.span`display: inline-flex; align-items: center; gap: 4px; margin: 0 0 4px 2px; color: var(--muted); font-size: 11px; @media(max-width:540px){grid-column:3 / -1; grid-row:2;}`;
const dimText = keyframes`from {color:var(--ink)} to {color:var(--muted)}`;
const restoreText = keyframes`from {color:var(--muted)} to {color:var(--ink)}`;
type CompletionChange = 'complete' | 'reopen' | undefined;
const quietLineFocus = css`&:focus, &:focus-visible { outline: none; border-color: transparent; border-radius: 0; background: transparent; box-shadow: inset 0 -1px 0 var(--focus); }`;
const ItemInput = styled.textarea<{ $done?: boolean; $completionChange?:CompletionChange }>`display: block; width: 100%; min-height: 40px; border: 0; border-radius: 4px; padding: 9px 2px; background: transparent; font-size: 15px; line-height: 1.4; color: ${({ $done }) => $done ? 'var(--muted)' : 'var(--ink)'}; text-decoration: ${({ $done }) => $done ? 'line-through' : 'none'}; text-decoration-color: transparent; overflow: hidden; resize: none; transition: color 180ms ease-out; animation:${({$completionChange})=>$completionChange==='complete'?dimText:$completionChange==='reopen'?restoreText:'none'} 220ms ease-out; ${quietLineFocus} &:focus, &:focus-visible { color: var(--ink); text-decoration: none; } @media(pointer:coarse){min-height:44px; padding-top: 11px; font-size:16px;}`;
const DetailInput = styled(ItemInput)`font-size: 13px; min-height: 32px; color: var(--muted); animation:none; @media(pointer:coarse){min-height:44px; font-size:16px;}`;
const drawStrike = keyframes`from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); }`;
const eraseStrike = keyframes`from { clip-path: inset(0 0 0 0); } to { clip-path: inset(0 0 0 100%); }`;
const LineShell = styled.div`position: relative; width: 100%; min-width: 0; flex: 1; &:focus-within [data-strike] { opacity: 0; }`;
const Strike = styled.span<{ $detail: boolean; $completionChange?:CompletionChange }>`position: absolute; inset: 0; z-index: 1; padding: 9px 2px; color: transparent; text-decoration: line-through; text-decoration-color: var(--muted); text-decoration-thickness: 1px; font-size: ${({$detail})=>$detail?'13px':'15px'}; line-height: 1.4; white-space: pre-wrap; overflow-wrap: anywhere; pointer-events: none; animation:${({$completionChange})=>$completionChange==='complete'?drawStrike:$completionChange==='reopen'?eraseStrike:'none'} 240ms ease-out both; transition: opacity 100ms ease-out; @media(pointer:coarse){padding-top:11px;font-size:16px;}`;
const DetailsClip = styled.div<{ $open:boolean }>`display:grid; grid-template-rows:${({$open})=>$open?'1fr':'0fr'}; opacity:${({$open})=>$open?1:0}; transition:grid-template-rows 190ms ease-out, opacity 150ms ease-out; > div { min-height:0; overflow:hidden; } @media(max-width:540px){grid-column:1 / -1; grid-row:4; min-width:0;}`;
const DetailList = styled.div`position: relative;`;
const DetailRow = styled.div<{ $dragging?:boolean }>`display: flex; align-items: center; gap: 6px; margin-left: 3px; border-radius: 6px; background: ${({$dragging})=>$dragging?'var(--date-bg)':'transparent'}; z-index: ${({$dragging})=>$dragging?1:0}; position: relative; [data-detail-control] { opacity: 0; transition: opacity 120ms ease-out; } &:hover [data-detail-control], &:focus-within [data-detail-control] { opacity: 1; } @media(hover:none) { [data-detail-control] { opacity: 1; } }`;
const DetailDraftRow = styled(DetailRow)`padding-left: 60px; @media(pointer:coarse){padding-left:88px;} @media(max-width:540px){grid-column:1 / -1; grid-row:4; min-width:0;}`;
const DetailGrip = styled.button`width: 20px; min-width: 20px; min-height: 32px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--muted); cursor: grab !important; touch-action: none; &:active { cursor: grabbing !important; } @media(pointer:coarse){width:44px;min-width:44px;min-height:44px;}`;
const DetailCheck = styled.button<{ $done:boolean }>`width:28px; min-width:28px; min-height:32px; display:grid; place-items:center; padding:0; border:0; border-radius:5px; background:transparent; color:${({$done})=>$done?'var(--link)':'var(--checkbox)'}; &:hover{background:var(--soft);} @media(pointer:coarse){width:44px;min-width:44px;min-height:44px;}`;
const ActionWrap = styled.div`position: static; display:flex; align-items:flex-start; flex: none; @media(max-width:540px){display:contents;}`;
const MoreButton = styled(IconButton)`width: 40px; height: 40px; @media(pointer:coarse){width:44px;height:44px;} @media(max-width:540px){grid-column:4;grid-row:1;}`;
const ActionMenu = styled.div`position: fixed; z-index: 50; width: 176px; max-height:calc(100dvh - 80px); overflow:auto; padding: 5px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface); box-shadow: 0 10px 30px #0003;`;
const Action = styled.button`width: 100%; min-height: 40px; display: flex; align-items: center; gap: 9px; padding: 7px 9px; border: 0; border-radius: 5px; background: transparent; color: var(--ink); font-size: 13px; text-align: left; &:hover:not(:disabled), &[aria-expanded='true'] { background: var(--soft); } &:disabled { color: var(--muted); cursor: default; opacity: .55; } @media(pointer:coarse){min-height:44px;}`;
const ParentSearch = styled(Field)`width: 100%; min-height: 40px; margin: 3px 0 5px; font-size: 13px; @media(pointer:coarse){min-height:44px; font-size:16px;}`;
const ParentList = styled.div`max-height: min(280px, calc(100dvh - 150px)); overflow-y: auto; overscroll-behavior: contain;`;
const ParentOption = styled(Action)`display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;`;
const ParentHint = styled.p`padding: 8px 9px; color: var(--muted); font-size: 12px;`;
const MoveFlyout = styled.div<{ $inline?: boolean }>`position: absolute; left: calc(100% + 8px); top: 0; @media(max-width: 540px), (max-width: 900px) and (max-height: 500px){position:fixed; left:50%; right:auto; top:max(8px, env(safe-area-inset-top)); transform:translateX(-50%); width:min(360px, calc(100vw - 16px)); max-height:calc(100dvh - max(8px, env(safe-area-inset-top)) - max(8px, env(safe-area-inset-bottom))); overflow:auto; overscroll-behavior:contain;}`;
const MoveFooter = styled.div`display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; font-size: 12px; color: var(--muted);`;
const QuickMoves = styled.div`display:flex;gap:6px;margin-bottom:10px;&>button{flex:1;}`;
const MoveConfirm = styled.button`min-height: 36px; padding: 6px 12px; border: 0; border-radius: 6px; background: var(--primary); color: var(--primary-ink); font-size: 12px; @media(pointer:coarse){min-height:44px;}`;
const AddForm = styled.form<{ $inline: boolean }>`margin: 10px 0 0 64px; width: calc(100% - 64px); ${({$inline}) => $inline && 'margin-top: 0;'} @media(pointer:coarse){margin-left:84px;width:calc(100% - 84px);}`;
const AddInput = styled(Field)`min-height: 44px; border-color: transparent; background: transparent; padding: 9px 2px; font-size: 15px; line-height: 1.4; &::placeholder { color: var(--muted); opacity: 1; font-size:13px; } &:hover { color: var(--ink); } ${quietLineFocus} @media(pointer:coarse){font-size:16px;}`;
const DetailToggle = styled.button<{ $open:boolean }>`display: inline-flex; align-items: center; justify-content:center; gap: 3px; min-width:48px; min-height:40px; padding: 0 4px; border: 0; border-radius: 6px; background: transparent; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; svg { transform: rotate(${({$open})=>$open?'0':'-90deg'}); transition: transform 180ms ease-out; } &:hover { background: var(--soft); color: var(--ink); } @media(pointer:coarse){min-height:44px;min-width:48px;} @media(max-width:540px){grid-column:3 / -1;grid-row:3;justify-self:end;}`;

export function useJournalFieldResize() {
  useEffect(() => {
    let frame = 0;
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const fields = document.querySelectorAll<HTMLTextAreaElement>('textarea[data-journal-entry]');
        fields.forEach(element => { element.style.height = 'auto'; });
        fields.forEach(element => { element.style.height = `${element.scrollHeight}px`; });
      });
    };
    window.addEventListener('resize', resize);
    return () => { window.removeEventListener('resize', resize); cancelAnimationFrame(frame); };
  }, []);
}

function LineField({ detail = false, value, $completionChange, ...props }: ComponentProps<'textarea'> & { detail?: boolean; value: string; $done?: boolean; $completionChange?:CompletionChange }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);
  const Component = detail ? DetailInput : ItemInput;
  return <LineShell><Component ref={ref} rows={1} value={value} data-journal-entry $completionChange={$completionChange} {...props}/>{(props.$done || $completionChange === 'reopen') && <Strike data-strike aria-hidden="true" $detail={detail} $completionChange={$completionChange}>{value}</Strike>}</LineShell>;
}

export function AddItem({ onAdd, autoFocus = false, onCancel, inline = false, label }: { onAdd: (text: string) => void; autoFocus?: boolean; onCancel?: () => void; inline?: boolean; label?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  const submitted = useRef(false);
  const finish = () => {
    if (cancelled.current || submitted.current) return;
    const value = inputRef.current?.value.trim() ?? '';
    if (value) { submitted.current = true; onAdd(value); onCancel?.(); }
    else if (inline) onCancel?.();
  };
  return <AddForm $inline={inline} onSubmit={event => { event.preventDefault(); finish(); }}><AddInput ref={inputRef} data-journal-entry autoFocus={autoFocus} aria-label={label ?? (inline ? 'New item after current item' : 'New daily item')} placeholder={inline ? 'New item…' : 'No lines yet. Add the first one below.'} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); cancelled.current = true; event.currentTarget.value = ''; onCancel?.(); event.currentTarget.blur(); } }} onBlur={finish}/></AddForm>;
}

export function JournalItem({ item, parentItems, previousItem, date, onChange, onEdit, onDelete, onMove, onMakeDetail, onMakeUndated, undatedListNames, onStartNext, recursive, onEnableOutline, revealOutline, unified = false, standalone = false }: { recursive: boolean; unified?: boolean; standalone?: boolean; onEnableOutline: () => void; revealOutline?: boolean; item: ViewItem; parentItems: TodoItem[]; previousItem?:TodoItem; date: string; onChange: (change: (item: TodoItem, items: TodoItem[]) => void) => void; onEdit: (change: (item: TodoItem, items: TodoItem[]) => void) => void; onDelete: () => void; onMove: (date: string) => void; onMakeDetail: (parentId: string) => void; onMakeUndated: (list: string) => void; undatedListNames: string[]; onStartNext: () => void }) {
  const today = todayString();
  const tomorrow = shiftDate(today, 1);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const [text, setText] = useState(parseTimeBlock(item.text)?.title ?? item.text);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const cancelText = useRef(false);
  const cancelDetail = useRef(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [parentOpen, setParentOpen] = useState(false);
  const [undatedOpen, setUndatedOpen] = useState(false);
  const [parentQuery, setParentQuery] = useState('');
  const [moveDate, setMoveDate] = useState(date);
  const [scheduleEditor, setScheduleEditor] = useState<'time' | 'repeat' | null>(null);
  const [spanEditor, setSpanEditor] = useState(false);
  const [actionGroup,setActionGroup]=useState<'main'|'schedule'|'move'>('main');
  const [detailInsertAt, setDetailInsertAt] = useState<number | null>(null);
  const [detailDraft, setDetailDraft] = useState('');
  const [detailsExpanded, setDetailsExpanded] = useState(true);
  const [outlineAdd, setOutlineAdd] = useState(0), [notesRequest, setNotesRequest] = useState(0);
  const detailSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const detailCounts = new Map<string, number>();
  const detailIds = item.details.map(detail => {
    const signature = JSON.stringify([detail.text, detail.completed]);
    const occurrence = detailCounts.get(signature) ?? 0;
    detailCounts.set(signature, occurrence + 1);
    return `${item.id}:detail:${signature}:${occurrence}`;
  });
  const taskDetails = recursive ? outlineNodes(item.details).filter(detail => detail.kind !== 'note') : item.details;
  const completedDetails = taskDetails.filter(detail => detail.completed).length;
  const timeBlock = parseTimeBlock(item.text);
  const detailProgress = taskDetails.length ? completedDetails / taskDetails.length : 0;
  const previousProgress = previousItem?.details.length ? previousItem.details.filter(detail => detail.completed).length / previousItem.details.length : previousItem?.completed ? 1 : undefined;
  const completionChange:CompletionChange = previousItem && previousItem.completed !== item.completed ? item.completed?'complete':'reopen' : undefined;
  const parentMatches = parentOpen ? parentItems.filter(candidate => candidate.id !== item.id && candidate.text.toLowerCase().includes(parentQuery.trim().toLowerCase())) : [];
  useEffect(() => setText(parseTimeBlock(item.text)?.title ?? item.text), [item.text]);
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) { setMenuOpen(false); setMoveOpen(false); setParentOpen(false); } };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenuOpen(false); setMoveOpen(false); setParentOpen(false); moreRef.current?.focus(); } };
    const scroll = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      const anchor = moreRef.current?.getBoundingClientRect();
      if (!anchor || anchor.bottom < 0 || anchor.top > innerHeight) { setMenuOpen(false); setMoveOpen(false); setParentOpen(false); return; }
      positionMenu(moveOpen, parentOpen);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', scroll);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', scroll); };
  }, [menuOpen, moveOpen, parentOpen]);
  const positionMenu = (withCalendar: boolean, withParents = false) => {
    const rect = moreRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dialog = standalone ? moreRef.current?.closest('dialog[open]') : null;
    const bounds = dialog?.getBoundingClientRect() ?? { left: 0, top: 0, width: innerWidth, height: innerHeight };
    const narrow = bounds.width <= 540;
    const menuWidth = withParents ? Math.min(280, window.innerWidth - 16) : 176;
    const needed = withCalendar && !narrow ? 512 : menuWidth;
    const left = Math.max(8, Math.min(rect.right - bounds.left - menuWidth, bounds.width - needed - 8)) + (dialog?.scrollLeft ?? 0);
    const height = withParents ? Math.min(390, window.innerHeight - 16) : withCalendar ? (narrow ? 580 : 430) : 275;
    const top = Math.max(8, Math.min(rect.bottom - bounds.top + 4, bounds.height - height - 8)) + (dialog?.scrollTop ?? 0);
    setMenuPosition({ top, left });
  };
  const saveText = () => { const original = timeBlock?.title ?? item.text; if (cancelText.current) { cancelText.current = false; setText(original); return; } const value = text.trim(); if (value && value !== original) onEdit(item => { item.text = timeBlock ? `${timeBlock.start}-${timeBlock.end} ${value}` : value; }); else setText(original); };
  const closeMenu = (action: () => void) => { setMenuOpen(false); setMoveOpen(false); setParentOpen(false);setActionGroup('main'); action(); };
  const detailDraftRow = detailInsertAt === null ? null : <DetailDraftRow key="new-detail"><LineField detail autoFocus aria-label={`New detail for ${item.text}`} value={detailDraft} onChange={event => setDetailDraft(event.target.value.replace(/[\r\n]+/g, ' '))} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { cancelDetail.current = true; event.currentTarget.blur(); } }} onBlur={() => { if (!cancelDetail.current && detailDraft.trim()) onEdit(item => { item.details.splice(detailInsertAt, 0, { text: detailDraft.trim(), completed: false }); item.completed = false; }); cancelDetail.current = false; setDetailDraft(''); setDetailInsertAt(null); }}/></DetailDraftRow>;
  return <ItemRow $standalone={standalone} ref={setNodeRef} role="group" aria-label={item.text} data-transition-id={item.id} data-search-item-id={item.id} $dragging={isDragging} style={{ transform: CSS.Transform.toString(transform), transition }}>
    {!standalone && <Grip data-row-control ref={setActivatorNodeRef} type="button" {...attributes} {...listeners} aria-label={`Drag to reorder ${item.text}`} title="Drag to reorder or move to another date"><GripVertical size={16}/></Grip>}
    {item.kind !== 'note' && <CheckButton data-row-control $done={item.completed} aria-label={`${item.completed ? 'Reopen' : 'Complete'} ${item.text}`} aria-pressed={item.completed} aria-description={item.details.length ? `${completedDetails} of ${item.details.length} details done` : undefined} onClick={() => onChange(item => setItemCompletion(item, !item.completed))}><Circle $done={item.completed} $progress={detailProgress} $previousProgress={previousProgress}/></CheckButton>}
    <ItemBody>
      <ItemMain data-calendar-title>{timeBlock && <TimeLabel title="Time block">{timeBlock.start}–{timeBlock.end}</TimeLabel>}<LineField $done={item.completed} $completionChange={completionChange} aria-label={`Edit ${item.text}`} value={text} onChange={event => setText(event.target.value.replace(/[\r\n]+/g, ' '))} onBlur={saveText} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); onStartNext(); } if (event.key === 'Escape') { cancelText.current = true; event.currentTarget.blur(); } }}/></ItemMain>
      {item.repeat && <RepeatLabel data-calendar-meta title={`Repeat rule: ${formatRecurrence(item.repeat)}`}><Repeat2 size={12}/>{describeRecurrence(item.repeat)}</RepeatLabel>}
      {item.span && <RepeatLabel data-calendar-meta title={`Span: ${formatSpan(item.span)}`}><CalendarDays size={12}/>{item.projection?.continuation ? 'continues · ' : ''}{formatSpan(item.span)}</RepeatLabel>}
      {recursive && <OutlineClip id={`details-${item.id}`} hidden={!detailsExpanded}><OutlineEditor unified={unified} item={item} dated onEdit={change => onEdit(change)} onToggle={change => onChange(change)} onPromote={(path,expected) => onEdit((item,items) => { if (outlineContent(item) !== expected) throw new Error('This outline changed. Review the latest outline before promoting this branch.'); promoteOutlineDetail(item, items, path, newId(), unified); })} addRequest={outlineAdd} notesRequest={notesRequest} reveal={revealOutline}/></OutlineClip>}
      {!recursive && !!item.details.length && <DetailsClip id={`details-${item.id}`} $open={detailsExpanded} aria-hidden={!detailsExpanded} inert={!detailsExpanded}><DndContext sensors={detailSensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis, restrictToParentElement]} onDragEnd={({active,over}) => {
        if (!over || active.id === over.id) return;
        const from = detailIds.indexOf(String(active.id));
        const to = detailIds.indexOf(String(over.id));
        if (from < 0 || to < 0) return;
        onEdit(item => { item.details = arrayMove(item.details, from, to); });
      }}><SortableContext items={detailIds} strategy={verticalListSortingStrategy}><DetailList>{item.details.map((detail,index) => <Fragment key={detailIds[index]}><Detail id={detailIds[index]} value={detail} completionChange={previousItem?.details[index]?.text === detail.text && previousItem.details[index].completed !== detail.completed ? detail.completed?'complete':'reopen' : undefined} onToggle={() => onChange(item => { item.details[index].completed = !item.details[index].completed; item.completed = item.details.every(detail => detail.completed); })} onSave={value => onEdit(item => { item.details[index].text = value; })} onStartNext={() => setDetailInsertAt(index+1)} onMakeItem={() => onEdit((item,items) => { const [promoted] = item.details.splice(index,1); items.splice(items.indexOf(item)+1,0,{id:newId(),text:promoted.text,sourceRef:promoted.sourceRef,details:[],completed:promoted.completed}); if (item.details.length) item.completed = item.details.every(detail => detail.completed); })} onDelete={() => onEdit(item => { item.details.splice(index,1); if (item.details.length) item.completed = item.details.every(detail => detail.completed); })}/>{detailInsertAt === index+1 && detailDraftRow}</Fragment>)}{detailInsertAt === 0 && detailDraftRow}</DetailList></SortableContext></DndContext></DetailsClip>}
      {!recursive && !item.details.length && detailDraftRow}
    </ItemBody>
    <ActionWrap data-calendar-actions ref={menuRef}>
      {item.details.length > 0 && <DetailToggle $open={detailsExpanded} type="button" aria-expanded={detailsExpanded} aria-controls={`details-${item.id}`} aria-label={`${detailsExpanded ? 'Collapse' : 'Expand'} details for ${item.text}`} title={`${completedDetails} of ${item.details.length} details done`} onClick={() => setDetailsExpanded(value => !value)}><ChevronDown size={14}/><span aria-hidden="true">{completedDetails}/{item.details.length}</span></DetailToggle>}
      <MoreButton data-row-control ref={moreRef} aria-label={`More actions for ${item.text}`} aria-expanded={menuOpen} onClick={() => { if (!menuOpen) positionMenu(false); else { setMoveOpen(false); setParentOpen(false); } setMenuOpen(value => !value); }}><MoreHorizontal size={17}/></MoreButton>
      {menuOpen && <ActionMenu style={{ ...menuPosition, overflow: standalone ? 'auto' : 'visible', maxHeight: standalone ? 'min(55dvh,420px)' : undefined, width: standalone && moveOpen ? 'min(330px, calc(100vw - 64px))' : parentOpen ? 'min(280px, calc(100vw - 16px))' : undefined }} aria-label={`Actions for ${item.text}`}>
        {parentOpen ? <>
          <Action aria-label="Back to item actions" onClick={() => { setParentOpen(false); positionMenu(false); moreRef.current?.focus(); }}><ArrowLeft size={15}/> choose parent</Action>
          <ParentSearch autoFocus aria-label="Find parent item" placeholder="Find an item…" value={parentQuery} onChange={event => setParentQuery(event.target.value)}/>
          <ParentList aria-label="Choose parent item">
            {parentMatches.slice(0, 50).map(parent => <ParentOption key={parent.id} title={parent.text} aria-label={`Make ${item.text} a detail of ${parent.text}`} onClick={() => closeMenu(() => onMakeDetail(parent.id))}>{parent.text}</ParentOption>)}
            {parentMatches.length === 0 && <ParentHint>No items match</ParentHint>}
            {parentMatches.length > 50 && <ParentHint>Search to see more items</ParentHint>}
          </ParentList>
        </> : <>
        {(!unified || actionGroup==='main') && <>
        <Action aria-label={`Add detail to ${item.text}`} onClick={() => closeMenu(() => { setDetailsExpanded(true); if (recursive) setOutlineAdd(value => value + 1); else setDetailInsertAt(item.details.length); })}><Plus size={15}/>{unified ? 'Add child' : 'add detail'}</Action>
        <Action onClick={() => closeMenu(() => { if (recursive) { setDetailsExpanded(true); setNotesRequest(value => value + 1); } else onEnableOutline(); })}><Plus size={15}/>{recursive ? unified ? 'Edit content' : 'edit notes' : 'enable deeper outlines'}</Action>
        {unified && <Action disabled={item.completed || item.repeat?.kind === 'after'} title={item.completed ? 'Reopen this task before making it plain' : undefined} onClick={()=>closeMenu(()=>onEdit(next=>{next.kind=next.kind==='note'?undefined:'note';refreshItemCompletion(next);} ))}>{item.kind==='note'?'Make task':'Make plain item'}</Action>}
        {unified && <><Action onClick={()=>setActionGroup('schedule')}>Schedule…</Action><Action onClick={()=>setActionGroup('move')}>Move…</Action></>}
        </>}
        {unified && actionGroup!=='main' && <Action onClick={()=>{setActionGroup('main');setMoveOpen(false);setUndatedOpen(false);}}>Back to item actions</Action>}
        {(!unified || actionGroup==='move') && <>
        <Action aria-label={`Make ${item.text} a detail`} title={item.repeat || timeBlock || item.span || item.replaces ? 'Remove the schedule and span first' : parentItems.length < 2 ? 'Add another item to this day first' : undefined} disabled={parentItems.length < 2 || !!item.repeat || !!timeBlock || !!item.span || !!item.replaces} onClick={() => { setParentQuery(''); setParentOpen(true); positionMenu(false, true); }}><CornerDownRight size={15}/> make detail</Action>
        </>}
        {(!unified || actionGroup==='schedule') && <>
        <Action aria-label={`Set time block for ${item.text}`} onClick={() => closeMenu(() => setScheduleEditor('time'))}><Clock3 size={15}/> {timeBlock ? 'edit time' : 'add time block'}</Action>
        <Action aria-label={`Set span for ${item.text}`} onClick={() => closeMenu(() => setSpanEditor(true))}><CalendarDays size={15}/> {item.span ? 'edit span' : 'add span'}</Action>
        <Action aria-label={`Set repeat for ${item.text}`} onClick={() => closeMenu(() => setScheduleEditor('repeat'))}><Repeat2 size={15}/> {item.repeat ? 'edit repeat' : 'repeat'}</Action>
        </>}
        {(!unified || actionGroup==='move') && <>
        <Action aria-label={`Move ${item.text}`} aria-expanded={moveOpen} onClick={() => { if (!moveOpen) { setMoveDate(date); positionMenu(true); } else positionMenu(false); setMoveOpen(value => !value); }}><CalendarDays size={15}/> move to date</Action>
        <Action aria-label={`Make ${item.text} undated`} disabled={unified && !!(item.repeat || item.span || item.replaces || timeBlock)} title={unified && (item.repeat || item.span || item.replaces || timeBlock) ? "Clear the schedule before moving to an undated document" : undefined} onClick={() => setUndatedOpen(value => !value)}><CalendarDays size={15}/> make undated</Action>
        {undatedOpen && (undatedListNames.length ? undatedListNames : ['Inbox']).map(name => <Action key={name} aria-label={`Move ${item.text} to undated list ${name}`} onClick={() => closeMenu(() => onMakeUndated(name))}>{name}</Action>)}
        </>}
        {(!unified || actionGroup==='main') &&         <Action aria-label={`Delete ${item.text}`} onClick={() => closeMenu(onDelete)}><Trash2 size={15}/> delete</Action>}
        {moveOpen && <MoveFlyout $inline={standalone} style={standalone ? {position:'static',transform:'none',width:'100%',overflow:'visible'} : undefined}>
          <QuickMoves role="group" aria-label="Quick move dates">
            <Button type="button" disabled={date === today} aria-label={`Move ${item.text} to today`} onClick={() => closeMenu(() => onMove(today))}>Today</Button>
            <Button type="button" disabled={date === tomorrow} aria-label={`Move ${item.text} to tomorrow`} onClick={() => closeMenu(() => onMove(tomorrow))}>Tomorrow</Button>
          </QuickMoves>
          <CalendarPanel label={`Choose destination for ${item.text}`} value={moveDate} onSelect={setMoveDate}><MoveFooter><span>{moveDate}</span><MoveConfirm type="button" onClick={() => closeMenu(() => onMove(moveDate))}>Move here</MoveConfirm></MoveFooter></CalendarPanel>
        </MoveFlyout>}
        </>}
      </ActionMenu>}
    </ActionWrap>
    {scheduleEditor && <ScheduleEditor kind={scheduleEditor} item={item} date={date} onClose={() => setScheduleEditor(null)} onTime={value => onEdit(item => { item.text = value; item.span = undefined; })} onRepeat={rule => onEdit(item => { item.repeat = rule; })}/>}
    {spanEditor && <SpanEditor open date={item.projection?.originalDate ?? date} span={item.span} onClose={() => setSpanEditor(false)} onSave={span => { onEdit(item => { item.span = span; if (span && parseTimeBlock(item.text)) item.text = parseTimeBlock(item.text)!.title; }); setSpanEditor(false); }}/>}
  </ItemRow>;
}


function Detail({ id, value, completionChange, onToggle, onSave, onStartNext, onMakeItem, onDelete }: { id: string; value: TodoDetail; completionChange?:CompletionChange; onToggle: () => void; onSave: (value: string) => void; onStartNext: () => void; onMakeItem: () => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const [draft, setDraft] = useState(value.text);
  const cancelled = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  useEffect(() => setDraft(value.text), [value.text]);
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node) && !menuPanelRef.current?.contains(event.target as Node)) setMenuOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenuOpen(false); moreRef.current?.focus(); } };
    const scroll = (event: Event) => {
      if (event.target instanceof Node && menuPanelRef.current?.contains(event.target)) return;
      const anchor = moreRef.current?.getBoundingClientRect();
      if (!anchor || anchor.bottom < 0 || anchor.top > innerHeight) { setMenuOpen(false); return; }
      positionDetailMenu();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', scroll);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', scroll); };
  }, [menuOpen]);
  const positionDetailMenu = () => {
    const rect = moreRef.current?.getBoundingClientRect();
    if (rect) setMenuPosition({ top: Math.max(8, Math.min(rect.bottom + 4, innerHeight - 100)), left: Math.max(8, Math.min(rect.right - 176, innerWidth - 184)) });
  };
  const openMenu = () => {
    if (!menuOpen) positionDetailMenu();
    setMenuOpen(value => !value);
  };
  return <DetailRow ref={setNodeRef} $dragging={isDragging} style={{transform: CSS.Transform.toString(transform), transition}}>
    <DetailGrip data-detail-control ref={setActivatorNodeRef} type="button" {...attributes} {...listeners} aria-label={`Drag to reorder detail ${value.text}`} title="Drag to reorder detail"><GripVertical size={13}/></DetailGrip>
    <DetailCheck $done={value.completed} type="button" aria-label={`${value.completed ? 'Reopen' : 'Complete'} detail ${value.text}`} aria-pressed={value.completed} onClick={onToggle}><Circle $done={value.completed} $previousProgress={completionChange ? (completionChange === 'complete' ? 0 : 1) : undefined}/></DetailCheck>
    <LineField detail $done={value.completed} $completionChange={completionChange} aria-label={`Edit detail ${value.text}`} value={draft} onChange={event => setDraft(event.target.value.replace(/[\r\n]+/g, ' '))} onBlur={() => { if (cancelled.current) { cancelled.current = false; setDraft(value.text); return; } if (draft.trim() && draft.trim() !== value.text) onSave(draft.trim()); else setDraft(value.text); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); onStartNext(); } if (event.key === 'Escape') { cancelled.current = true; event.currentTarget.blur(); } }}/>
    <ActionWrap ref={menuRef}><MoreButton data-detail-control ref={moreRef} aria-label={`More actions for detail ${value.text}`} aria-expanded={menuOpen} onClick={openMenu}><MoreHorizontal size={15}/></MoreButton></ActionWrap>
    {menuOpen && createPortal(<ActionMenu ref={menuPanelRef} style={menuPosition} aria-label={`Actions for detail ${value.text}`}><Action aria-label={`Make detail ${value.text} an item`} onClick={() => { setMenuOpen(false); onMakeItem(); }}><CornerDownRight size={15} style={{transform:'rotate(180deg)'}}/> make item</Action><Action aria-label={`Delete detail ${value.text}`} onClick={() => { setMenuOpen(false); onDelete(); }}><Trash2 size={15}/> delete</Action></ActionMenu>, document.body)}
  </DetailRow>;
}
