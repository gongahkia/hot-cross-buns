import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import styled, { keyframes } from 'styled-components';
import { createPortal } from 'react-dom';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { CalendarDays, ChevronDown, CornerDownRight, GripVertical, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { Field, IconButton } from '../styles';
import { newId, type TodoDetail, type TodoItem } from '../todoText';
import { CalendarPanel } from './CalendarPanel';

const ItemRow = styled.div<{ $dragging: boolean }>`position: relative; display: flex; align-items: flex-start; gap: 4px; min-height: 40px; border-radius: 7px; background: ${({ $dragging }) => $dragging ? 'var(--soft)' : 'transparent'}; opacity: ${({ $dragging }) => $dragging ? .35 : 1}; &:hover { background: var(--soft); } [data-row-control] { opacity: 0; transition: opacity 120ms ease-out; } &:hover [data-row-control], &:focus-within [data-row-control] { opacity: 1; } @media(hover:none) { [data-row-control] { opacity: 1; } }`;
const Grip = styled.button`width: 22px; height: 40px; display: grid; place-items: center; flex: none; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--muted); cursor: grab !important; touch-action: none; &:active { cursor: grabbing !important; } @media(pointer:coarse){width:36px;height:44px;}`;
const CheckButton = styled.button<{ $done: boolean }>`width: 34px; height: 40px; display: grid; place-items: center; flex: none; border: 0; background: transparent; color: ${({ $done }) => $done ? 'var(--link)' : 'var(--checkbox)'}; @media(pointer:coarse){width:44px;height:44px;}`;
const Circle = styled.span<{ $done: boolean; $progress?: number }>`display: grid; place-items: center; width: 15px; height: 15px; border: 1px solid currentColor; border-radius: 50%; background: ${({ $done, $progress = 0 }) => $done ? 'var(--link)' : $progress ? `conic-gradient(var(--link) ${$progress * 100}%, transparent 0)` : 'transparent'}; color: ${({ $done }) => $done ? 'var(--link)' : 'var(--checkbox)'}; transition: background 180ms ease-out, color 180ms ease-out;`;
const ItemBody = styled.div`min-width: 0; flex: 1;`;
const dimText = keyframes`from {color:var(--ink)} to {color:var(--muted)}`;
const restoreText = keyframes`from {color:var(--muted)} to {color:var(--ink)}`;
type CompletionChange = 'complete' | 'reopen' | undefined;
const ItemInput = styled.textarea<{ $done?: boolean; $completionChange?:CompletionChange }>`display: block; width: 100%; min-height: 40px; border: 0; border-radius: 4px; padding: 9px 2px; background: transparent; font-size: 15px; line-height: 1.4; color: ${({ $done }) => $done ? 'var(--muted)' : 'var(--ink)'}; text-decoration: ${({ $done }) => $done ? 'line-through' : 'none'}; text-decoration-color: transparent; overflow: hidden; resize: none; transition: color 180ms ease-out; animation:${({$completionChange})=>$completionChange==='complete'?dimText:$completionChange==='reopen'?restoreText:'none'} 220ms ease-out; &:focus { color: var(--ink); text-decoration: none; background: var(--field); box-shadow: 0 0 0 1px var(--focus); } @media(pointer:coarse){min-height:44px; padding-top: 11px;}`;
const DetailInput = styled(ItemInput)`font-size: 13px; min-height: 32px; color: var(--muted); animation:none; @media(pointer:coarse){min-height:44px;}`;
const drawStrike = keyframes`from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); }`;
const eraseStrike = keyframes`from { clip-path: inset(0 0 0 0); } to { clip-path: inset(0 0 0 100%); }`;
const LineShell = styled.div`position: relative; width: 100%; min-width: 0; flex: 1; &:focus-within [data-strike] { opacity: 0; }`;
const Strike = styled.span<{ $detail: boolean; $completionChange?:CompletionChange }>`position: absolute; inset: 0; z-index: 1; padding: 9px 2px; color: transparent; text-decoration: line-through; text-decoration-color: var(--muted); text-decoration-thickness: 1px; font-size: ${({$detail})=>$detail?'13px':'15px'}; line-height: 1.4; white-space: pre-wrap; overflow-wrap: anywhere; pointer-events: none; animation:${({$completionChange})=>$completionChange==='complete'?drawStrike:$completionChange==='reopen'?eraseStrike:'none'} 240ms ease-out both; transition: opacity 100ms ease-out; @media(pointer:coarse){padding-top:11px;}`;
const DetailsClip = styled.div<{ $open:boolean }>`display:grid; grid-template-rows:${({$open})=>$open?'1fr':'0fr'}; opacity:${({$open})=>$open?1:0}; transition:grid-template-rows 190ms ease-out, opacity 150ms ease-out; > div { min-height:0; overflow:hidden; }`;
const DetailList = styled.div`position: relative;`;
const DetailRow = styled.div<{ $dragging?:boolean }>`display: flex; align-items: center; gap: 6px; margin-left: 3px; border-radius: 6px; background: ${({$dragging})=>$dragging?'var(--date-bg)':'transparent'}; z-index: ${({$dragging})=>$dragging?1:0}; position: relative; [data-detail-control] { opacity: 0; transition: opacity 120ms ease-out; } &:hover [data-detail-control], &:focus-within [data-detail-control] { opacity: 1; } @media(hover:none) { [data-detail-control] { opacity: 1; } }`;
const DetailGrip = styled.button`width: 20px; min-width: 20px; min-height: 32px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--muted); cursor: grab !important; touch-action: none; &:active { cursor: grabbing !important; } @media(pointer:coarse){width:32px;min-width:32px;min-height:44px;}`;
const DetailCheck = styled.button<{ $done:boolean }>`width:28px; min-width:28px; min-height:32px; display:grid; place-items:center; padding:0; border:0; border-radius:5px; background:transparent; color:${({$done})=>$done?'var(--link)':'var(--checkbox)'}; &:hover{background:var(--soft);} @media(pointer:coarse){width:44px;min-width:44px;min-height:44px;}`;
const Dash = styled.span`color: var(--muted); font-size: 13px;`;
const Mini = styled.button`display: inline-grid; place-items: center; width: 32px; height: 32px; flex: none; padding: 0; border: 0; border-radius: 5px; color: var(--muted); background: transparent; &:hover { color: var(--link); background: var(--date-bg); } @media(pointer:coarse){width:44px;height:44px;}`;
const ActionWrap = styled.div`position: static; display:flex; align-items:flex-start; flex: none;`;
const MoreButton = styled(IconButton)`width: 40px; height: 40px; @media(pointer:coarse){width:44px;height:44px;}`;
const ActionMenu = styled.div`position: fixed; z-index: 30; width: 176px; padding: 5px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface); box-shadow: 0 10px 30px #0003;`;
const Action = styled.button`width: 100%; min-height: 40px; display: flex; align-items: center; gap: 9px; padding: 7px 9px; border: 0; border-radius: 5px; background: transparent; color: var(--ink); font-size: 13px; text-align: left; &:hover:not(:disabled), &[aria-expanded='true'] { background: var(--soft); } &:disabled { color: var(--muted); cursor: default; opacity: .55; } @media(pointer:coarse){min-height:44px;}`;
const MoveFlyout = styled.div`position: absolute; left: calc(100% + 8px); top: 0; @media(max-width: 540px){left: auto; right: 0; top: calc(100% + 8px); max-height: calc(100dvh - 160px); overflow: auto;}`;
const MoveFooter = styled.div`display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; font-size: 12px; color: var(--muted);`;
const MoveConfirm = styled.button`min-height: 36px; padding: 6px 12px; border: 0; border-radius: 6px; background: var(--primary); color: var(--primary-ink); font-size: 12px; @media(pointer:coarse){min-height:44px;}`;
const AddForm = styled.form`display: flex; align-items: center; gap: 4px; margin-left: 60px; max-width: calc(100% - 60px); @media(pointer:coarse){margin-left:84px;max-width:calc(100% - 84px);}`;
const AddInput = styled(Field)`min-height: 40px; border-color: transparent; background: transparent; padding-left: 2px; &:focus { background: var(--field); border-color: var(--focus); } @media(pointer:coarse){min-height:44px;}`;
const DetailToggle = styled.button<{ $open:boolean }>`display: inline-flex; align-items: center; justify-content:center; gap: 3px; min-width:48px; min-height:40px; padding: 0 4px; border: 0; border-radius: 6px; background: transparent; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; svg { transform: rotate(${({$open})=>$open?'0':'-90deg'}); transition: transform 180ms ease-out; } &:hover { background: var(--soft); color: var(--ink); } @media(pointer:coarse){min-height:44px;min-width:48px;}`;
const UnfinishedNote = styled.p`margin: 0 0 3px 2px; font-size: 12px; color: var(--muted);`;

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

export function AddItem({ onAdd, autoFocus = false, onCancel, inline = false }: { onAdd: (text: string) => void; autoFocus?: boolean; onCancel?: () => void; inline?: boolean }) {
  const [text, setText] = useState('');
  const cancelled = useRef(false);
  return <AddForm onSubmit={event => { event.preventDefault(); if (text.trim()) { onAdd(text); setText(''); onCancel?.(); } }}><AddInput autoFocus={autoFocus} aria-label={inline ? 'New item after current item' : 'New daily item'} placeholder={inline ? 'New item…' : 'Add a line to this day…'} value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { cancelled.current = true; onCancel?.(); } }} onBlur={event => { if (inline && !event.currentTarget.form?.contains(event.relatedTarget as Node)) { if (!cancelled.current && text.trim()) onAdd(text); cancelled.current = false; onCancel?.(); } }}/><Mini aria-label="Add daily item" type="submit"><Plus size={16}/></Mini></AddForm>;
}

export function JournalItem({ item, previousItem, date, today, onChange, onMove, onMakeDetail, onStartNext }: { item: TodoItem; previousItem?:TodoItem; date: string; today: string; onChange: (change: (item: TodoItem, items: TodoItem[]) => void) => void; onMove: (date: string) => void; onMakeDetail?: () => void; onStartNext: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const [text, setText] = useState(item.text);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const cancelText = useRef(false);
  const cancelDetail = useRef(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveDate, setMoveDate] = useState(date);
  const [detailInsertAt, setDetailInsertAt] = useState<number | null>(null);
  const [detailDraft, setDetailDraft] = useState('');
  const [detailsExpanded, setDetailsExpanded] = useState(true);
  const detailSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const detailCounts = new Map<string, number>();
  const detailIds = item.details.map(detail => {
    const signature = JSON.stringify([detail.text, detail.completed]);
    const occurrence = detailCounts.get(signature) ?? 0;
    detailCounts.set(signature, occurrence + 1);
    return `${item.id}:detail:${signature}:${occurrence}`;
  });
  const completedDetails = item.details.filter(detail => detail.completed).length;
  const detailProgress = item.details.length ? completedDetails / item.details.length : 0;
  const completionChange:CompletionChange = previousItem && previousItem.completed !== item.completed ? item.completed?'complete':'reopen' : undefined;
  useEffect(() => setText(item.text), [item.text]);
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) { setMenuOpen(false); setMoveOpen(false); } };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenuOpen(false); setMoveOpen(false); moreRef.current?.focus(); } };
    const scroll = (event: Event) => { if (event.target instanceof Node && menuRef.current?.contains(event.target)) return; setMenuOpen(false); setMoveOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', scroll);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', scroll); };
  }, [menuOpen]);
  const positionMenu = (withCalendar: boolean) => {
    const rect = moreRef.current?.getBoundingClientRect();
    if (!rect) return;
    const narrow = window.innerWidth <= 540;
    const needed = withCalendar && !narrow ? 512 : 176;
    const left = Math.max(8, Math.min(rect.right - 176, window.innerWidth - needed - 8));
    const height = withCalendar ? (narrow ? 580 : 430) : 190;
    const top = Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - height - 8));
    setMenuPosition({ top, left });
  };
  const saveText = () => { if (cancelText.current) { cancelText.current = false; setText(item.text); return; } const value = text.trim(); if (value && value !== item.text) onChange(item => { item.text = value; }); else setText(item.text); };
  const closeMenu = (action: () => void) => { setMenuOpen(false); setMoveOpen(false); action(); };
  const detailDraftRow = detailInsertAt === null ? null : <DetailRow key="new-detail"><Dash>-</Dash><LineField detail autoFocus aria-label={`New detail for ${item.text}`} value={detailDraft} onChange={event => setDetailDraft(event.target.value.replace(/[\r\n]+/g, ' '))} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { cancelDetail.current = true; event.currentTarget.blur(); } }} onBlur={() => { if (!cancelDetail.current && detailDraft.trim()) onChange(item => { item.details.splice(detailInsertAt, 0, { text: detailDraft.trim(), completed: false }); item.completed = false; }); cancelDetail.current = false; setDetailDraft(''); setDetailInsertAt(null); }}/></DetailRow>;
  return <ItemRow ref={setNodeRef} role="group" aria-label={item.text} data-transition-id={item.id} $dragging={isDragging} style={{ transform: CSS.Transform.toString(transform), transition }}>
    <Grip data-row-control ref={setActivatorNodeRef} type="button" {...attributes} {...listeners} aria-label={`Drag to reorder ${item.text}`} title="Drag to reorder or move to another date"><GripVertical size={16}/></Grip>
    <CheckButton data-row-control $done={item.completed} aria-label={`${item.completed ? 'Reopen' : 'Complete'} ${item.text}`} aria-pressed={item.completed} aria-description={item.details.length ? `${completedDetails} of ${item.details.length} details done` : undefined} onClick={() => onChange(item => { const done = !item.completed; item.completed = done; item.details.forEach(detail => { detail.completed = done; }); })}><Circle $done={item.completed} $progress={detailProgress}/></CheckButton>
    <ItemBody>
      <LineField $done={item.completed} $completionChange={completionChange} aria-label={`Edit ${item.text}`} value={text} onChange={event => setText(event.target.value.replace(/[\r\n]+/g, ' '))} onBlur={saveText} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); onStartNext(); } if (event.key === 'Escape') { cancelText.current = true; event.currentTarget.blur(); } }}/>
      {!!item.details.length && <DetailsClip id={`details-${item.id}`} $open={detailsExpanded} aria-hidden={!detailsExpanded} inert={!detailsExpanded}><DndContext sensors={detailSensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis, restrictToParentElement]} onDragEnd={({active,over}) => {
        if (!over || active.id === over.id) return;
        const from = detailIds.indexOf(String(active.id));
        const to = detailIds.indexOf(String(over.id));
        if (from < 0 || to < 0) return;
        onChange(item => { item.details = arrayMove(item.details, from, to); });
      }}><SortableContext items={detailIds} strategy={verticalListSortingStrategy}><DetailList>{item.details.map((detail,index) => <Fragment key={detailIds[index]}><Detail id={detailIds[index]} value={detail} completionChange={previousItem?.details[index]?.text === detail.text && previousItem.details[index].completed !== detail.completed ? detail.completed?'complete':'reopen' : undefined} onToggle={() => onChange(item => { item.details[index].completed = !item.details[index].completed; item.completed = item.details.every(detail => detail.completed); })} onSave={value => onChange(item => { item.details[index].text = value; })} onStartNext={() => setDetailInsertAt(index+1)} onMakeItem={() => onChange((item,items) => { const [promoted] = item.details.splice(index,1); items.splice(items.indexOf(item)+1,0,{id:newId(),text:promoted.text,details:[],completed:promoted.completed}); if (item.details.length) item.completed = item.details.every(detail => detail.completed); })} onDelete={() => onChange(item => { item.details.splice(index,1); if (item.details.length) item.completed = item.details.every(detail => detail.completed); })}/>{detailInsertAt === index+1 && detailDraftRow}</Fragment>)}{detailInsertAt === 0 && detailDraftRow}</DetailList></SortableContext></DndContext></DetailsClip>}
      {!item.details.length && detailDraftRow}
      {date < today && !item.completed && <UnfinishedNote>unfinished</UnfinishedNote>}
    </ItemBody>
    <ActionWrap ref={menuRef}>
      {item.details.length > 0 && <DetailToggle $open={detailsExpanded} type="button" aria-expanded={detailsExpanded} aria-controls={`details-${item.id}`} aria-label={`${detailsExpanded ? 'Collapse' : 'Expand'} details for ${item.text}`} title={`${completedDetails} of ${item.details.length} details done`} onClick={() => setDetailsExpanded(value => !value)}><ChevronDown size={14}/><span aria-hidden="true">{completedDetails}/{item.details.length}</span></DetailToggle>}
      <MoreButton data-row-control ref={moreRef} aria-label={`More actions for ${item.text}`} aria-expanded={menuOpen} onClick={() => { if (!menuOpen) positionMenu(false); else setMoveOpen(false); setMenuOpen(value => !value); }}><MoreHorizontal size={17}/></MoreButton>
      {menuOpen && <ActionMenu style={menuPosition} aria-label={`Actions for ${item.text}`}>
        <Action aria-label={`Add detail to ${item.text}`} onClick={() => closeMenu(() => { setDetailsExpanded(true); setDetailInsertAt(item.details.length); })}><Plus size={15}/> add detail</Action>
        <Action aria-label={`Make ${item.text} a detail`} title={onMakeDetail ? undefined : 'Move another item above this one first'} disabled={!onMakeDetail} onClick={() => { if (onMakeDetail) closeMenu(onMakeDetail); }}><CornerDownRight size={15}/> make detail</Action>
        <Action aria-label={`Move ${item.text}`} aria-expanded={moveOpen} onClick={() => { if (!moveOpen) { setMoveDate(date); positionMenu(true); } else positionMenu(false); setMoveOpen(value => !value); }}><CalendarDays size={15}/> move to date</Action>
        <Action aria-label={`Delete ${item.text}`} onClick={() => closeMenu(() => onChange((item, items) => { items.splice(items.indexOf(item),1); }))}><Trash2 size={15}/> delete</Action>
        {moveOpen && <MoveFlyout><CalendarPanel label={`Choose destination for ${item.text}`} value={moveDate} onSelect={setMoveDate}><MoveFooter><span>{moveDate}</span><MoveConfirm type="button" onClick={() => closeMenu(() => onMove(moveDate))}>Move here</MoveConfirm></MoveFooter></CalendarPanel></MoveFlyout>}
      </ActionMenu>}
    </ActionWrap>
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
    const scroll = (event: Event) => { if (event.target instanceof Node && menuPanelRef.current?.contains(event.target)) return; setMenuOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', scroll);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', scroll); };
  }, [menuOpen]);
  const openMenu = () => {
    if (!menuOpen) {
      const rect = moreRef.current?.getBoundingClientRect();
      if (rect) setMenuPosition({ top: Math.max(8, Math.min(rect.bottom + 4, innerHeight - 100)), left: Math.max(8, Math.min(rect.right - 176, innerWidth - 184)) });
    }
    setMenuOpen(value => !value);
  };
  return <DetailRow ref={setNodeRef} $dragging={isDragging} style={{transform: CSS.Transform.toString(transform), transition}}>
    <DetailGrip data-detail-control ref={setActivatorNodeRef} type="button" {...attributes} {...listeners} aria-label={`Drag to reorder detail ${value.text}`} title="Drag to reorder detail"><GripVertical size={13}/></DetailGrip>
    <DetailCheck $done={value.completed} type="button" aria-label={`${value.completed ? 'Reopen' : 'Complete'} detail ${value.text}`} aria-pressed={value.completed} onClick={onToggle}><Circle $done={value.completed}/></DetailCheck>
    <LineField detail $done={value.completed} $completionChange={completionChange} aria-label={`Edit detail ${value.text}`} value={draft} onChange={event => setDraft(event.target.value.replace(/[\r\n]+/g, ' '))} onBlur={() => { if (cancelled.current) { cancelled.current = false; setDraft(value.text); return; } if (draft.trim() && draft.trim() !== value.text) onSave(draft.trim()); else setDraft(value.text); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); onStartNext(); } if (event.key === 'Escape') { cancelled.current = true; event.currentTarget.blur(); } }}/>
    <ActionWrap ref={menuRef}><MoreButton data-detail-control ref={moreRef} aria-label={`More actions for detail ${value.text}`} aria-expanded={menuOpen} onClick={openMenu}><MoreHorizontal size={15}/></MoreButton></ActionWrap>
    {menuOpen && createPortal(<ActionMenu ref={menuPanelRef} style={menuPosition} aria-label={`Actions for detail ${value.text}`}><Action aria-label={`Make detail ${value.text} an item`} onClick={() => { setMenuOpen(false); onMakeItem(); }}><CornerDownRight size={15} style={{transform:'rotate(180deg)'}}/> make item</Action><Action aria-label={`Delete detail ${value.text}`} onClick={() => { setMenuOpen(false); onDelete(); }}><Trash2 size={15}/> delete</Action></ActionMenu>, document.body)}
  </DetailRow>;
}
