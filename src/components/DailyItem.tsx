import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import styled from 'styled-components';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CalendarDays, Check, ChevronDown, ChevronRight, GripVertical, MoreHorizontal, Plus, Trash2, X } from 'lucide-react';
import { Field, IconButton } from '../styles';
import { type TodoItem } from '../todoText';
import { CalendarPanel } from './CalendarPanel';

const ItemRow = styled.div<{ $dragging: boolean }>`position: relative; display: flex; align-items: flex-start; gap: 4px; min-height: 40px; border-radius: 7px; background: ${({ $dragging }) => $dragging ? 'var(--soft)' : 'transparent'}; z-index: ${({ $dragging }) => $dragging ? 4 : 'auto'}; &:hover { background: var(--soft); }`;
const Grip = styled.button`width: 22px; height: 40px; display: grid; place-items: center; flex: none; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--muted); cursor: grab !important; touch-action: none; &:active { cursor: grabbing !important; } @media(pointer:coarse){width:36px;height:44px;}`;
const CheckButton = styled.button<{ $done: boolean }>`width: 34px; height: 40px; display: grid; place-items: center; flex: none; border: 0; background: transparent; color: ${({ $done }) => $done ? 'var(--link)' : 'var(--checkbox)'}; @media(pointer:coarse){width:44px;height:44px;}`;
const Circle = styled.span<{ $done: boolean }>`display: grid; place-items: center; width: 15px; height: 15px; border: 1px solid currentColor; border-radius: 50%; background: ${({ $done }) => $done ? 'var(--link)' : 'transparent'}; color: ${({ $done }) => $done ? 'var(--paper)' : 'var(--checkbox)'};`;
const ItemBody = styled.div`min-width: 0; flex: 1;`;
const ItemInput = styled.textarea<{ $done?: boolean }>`display: block; width: 100%; min-height: 40px; border: 0; border-radius: 4px; padding: 9px 2px; background: transparent; font-size: 15px; line-height: 1.4; color: ${({ $done }) => $done ? 'var(--muted)' : 'var(--ink)'}; text-decoration: ${({ $done }) => $done ? 'line-through' : 'none'}; overflow: hidden; resize: none; &:focus { color: var(--ink); text-decoration: none; background: var(--field); box-shadow: 0 0 0 1px var(--focus); } @media(pointer:coarse){min-height:44px; padding-top: 11px;}`;
const DetailInput = styled(ItemInput)`font-size: 13px; min-height: 32px; color: var(--muted); @media(pointer:coarse){min-height:44px;}`;
const DetailRow = styled.div`display: flex; align-items: center; gap: 6px; margin-left: 3px; &:hover button { opacity: 1; }`;
const Dash = styled.span`color: var(--muted); font-size: 13px;`;
const Mini = styled.button`display: inline-grid; place-items: center; width: 32px; height: 32px; flex: none; padding: 0; border: 0; border-radius: 5px; color: var(--muted); background: transparent; &:hover { color: var(--link); background: var(--date-bg); } @media(pointer:coarse){width:44px;height:44px;}`;
const ActionWrap = styled.div`position: static; flex: none;`;
const MoreButton = styled(IconButton)`width: 40px; height: 40px; @media(pointer:coarse){width:44px;height:44px;}`;
const ActionMenu = styled.div`position: fixed; z-index: 30; width: 176px; padding: 5px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface); box-shadow: 0 10px 30px #0003;`;
const Action = styled.button`width: 100%; min-height: 40px; display: flex; align-items: center; gap: 9px; padding: 7px 9px; border: 0; border-radius: 5px; background: transparent; color: var(--ink); font-size: 13px; text-align: left; &:hover, &[aria-expanded='true'] { background: var(--soft); } @media(pointer:coarse){min-height:44px;}`;
const MoveFlyout = styled.div`position: absolute; left: calc(100% + 8px); top: 0; @media(max-width: 540px){left: auto; right: 0; top: calc(100% + 8px);}`;
const MoveFooter = styled.div`display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; font-size: 12px; color: var(--muted);`;
const MoveConfirm = styled.button`min-height: 36px; padding: 6px 12px; border: 0; border-radius: 6px; background: var(--primary); color: var(--primary-ink); font-size: 12px; @media(pointer:coarse){min-height:44px;}`;
const AddForm = styled.form`display: flex; align-items: center; gap: 4px; margin-left: 60px; max-width: calc(100% - 60px); @media(pointer:coarse){margin-left:84px;max-width:calc(100% - 84px);}`;
const AddInput = styled(Field)`min-height: 40px; border-color: transparent; background: transparent; padding-left: 2px; &:focus { background: var(--field); border-color: var(--focus); } @media(pointer:coarse){min-height:44px;}`;
const DetailToggle = styled.button`display: inline-flex; align-items: center; gap: 3px; min-height: 26px; padding: 0 3px; margin: 0 0 1px 0; border: 0; border-radius: 4px; background: transparent; color: var(--muted); font-size: 12px; &:hover { background: var(--soft); color: var(--ink); } @media(pointer:coarse){min-height:44px;}`;
const UnfinishedNote = styled.p`margin: 0 0 3px 2px; font-size: 12px; color: var(--muted);`;

function LineField({ detail = false, value, ...props }: ComponentProps<'textarea'> & { detail?: boolean; value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);
  const Component = detail ? DetailInput : ItemInput;
  return <Component ref={ref} rows={1} value={value} {...props}/>;
}

export function AddItem({ onAdd }: { onAdd: (text: string) => void }) {
  const [text, setText] = useState('');
  return <AddForm onSubmit={event => { event.preventDefault(); if (text.trim()) { onAdd(text); setText(''); } }}><AddInput aria-label="New daily item" placeholder="Add a line to this day…" value={text} onChange={event => setText(event.target.value)}/><Mini aria-label="Add daily item" type="submit"><Plus size={16}/></Mini></AddForm>;
}

export function JournalItem({ item, date, today, onChange, onMove }: { item: TodoItem; date: string; today: string; onChange: (change: (item: TodoItem, items: TodoItem[]) => void) => void; onMove: (date: string) => void }) {
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
  const [addingDetail, setAddingDetail] = useState(false);
  const [detailDraft, setDetailDraft] = useState('');
  const [detailsExpanded, setDetailsExpanded] = useState(true);
  useEffect(() => setText(item.text), [item.text]);
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) { setMenuOpen(false); setMoveOpen(false); } };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenuOpen(false); setMoveOpen(false); moreRef.current?.focus(); } };
    const scroll = () => { setMenuOpen(false); setMoveOpen(false); };
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
    const height = withCalendar ? (narrow ? 540 : 390) : 145;
    const top = Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - height - 8));
    setMenuPosition({ top, left });
  };
  const saveText = () => { if (cancelText.current) { cancelText.current = false; setText(item.text); return; } const value = text.trim(); if (value && value !== item.text) onChange(item => { item.text = value; }); else setText(item.text); };
  const closeMenu = (action: () => void) => { setMenuOpen(false); setMoveOpen(false); action(); };
  return <ItemRow ref={setNodeRef} role="group" aria-label={item.text} $dragging={isDragging} style={{ transform: CSS.Transform.toString(transform), transition }}>
    <Grip ref={setActivatorNodeRef} type="button" {...attributes} {...listeners} aria-label={`Drag to reorder ${item.text}`} title="Drag to reorder"><GripVertical size={16}/></Grip>
    <CheckButton $done={item.completed} aria-label={`${item.completed ? 'Reopen' : 'Complete'} ${item.text}`} onClick={() => onChange(item => { item.completed = !item.completed; })}><Circle $done={item.completed}>{item.completed && <Check size={12}/>}</Circle></CheckButton>
    <ItemBody>
      <LineField $done={item.completed} aria-label={`Edit ${item.text}`} value={text} onChange={event => setText(event.target.value.replace(/[\r\n]+/g, ' '))} onBlur={saveText} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { cancelText.current = true; event.currentTarget.blur(); } }}/>
      {item.details.length > 0 && <DetailToggle type="button" aria-expanded={detailsExpanded} aria-label={`${detailsExpanded ? 'Collapse' : 'Expand'} details for ${item.text}`} onClick={() => setDetailsExpanded(value => !value)}>{detailsExpanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>} {item.details.length} {item.details.length === 1 ? 'detail' : 'details'}</DetailToggle>}
      {detailsExpanded && item.details.map((detail,index) => <Detail key={`${item.id}-${index}`} value={detail} completed={item.completed} onSave={value => onChange(item => { item.details[index] = value; })} onDelete={() => onChange(item => { item.details.splice(index,1); })}/>)}
      {addingDetail && <DetailRow><Dash>-</Dash><LineField detail autoFocus aria-label={`New detail for ${item.text}`} value={detailDraft} onChange={event => setDetailDraft(event.target.value.replace(/[\r\n]+/g, ' '))} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { cancelDetail.current = true; event.currentTarget.blur(); } }} onBlur={() => { if (!cancelDetail.current && detailDraft.trim()) onChange(item => { item.details.push(detailDraft.trim()); }); cancelDetail.current = false; setDetailDraft(''); setAddingDetail(false); }}/></DetailRow>}
      {date < today && !item.completed && <UnfinishedNote>unfinished</UnfinishedNote>}
    </ItemBody>
    <ActionWrap ref={menuRef}>
      <MoreButton ref={moreRef} aria-label={`More actions for ${item.text}`} aria-expanded={menuOpen} onClick={() => { if (!menuOpen) positionMenu(false); else setMoveOpen(false); setMenuOpen(value => !value); }}><MoreHorizontal size={17}/></MoreButton>
      {menuOpen && <ActionMenu style={menuPosition} aria-label={`Actions for ${item.text}`}>
        <Action aria-label={`Add detail to ${item.text}`} onClick={() => closeMenu(() => setAddingDetail(true))}><Plus size={15}/> add detail</Action>
        <Action aria-label={`Move ${item.text}`} aria-expanded={moveOpen} onClick={() => { if (!moveOpen) { setMoveDate(date); positionMenu(true); } else positionMenu(false); setMoveOpen(value => !value); }}><CalendarDays size={15}/> move to date</Action>
        <Action aria-label={`Delete ${item.text}`} onClick={() => closeMenu(() => onChange((item, items) => { items.splice(items.indexOf(item),1); }))}><Trash2 size={15}/> delete</Action>
        {moveOpen && <MoveFlyout><CalendarPanel label={`Choose destination for ${item.text}`} value={moveDate} onSelect={setMoveDate}><MoveFooter><span>{moveDate}</span><MoveConfirm type="button" onClick={() => closeMenu(() => onMove(moveDate))}>Move here</MoveConfirm></MoveFooter></CalendarPanel></MoveFlyout>}
      </ActionMenu>}
    </ActionWrap>
  </ItemRow>;
}

function Detail({ value, completed, onSave, onDelete }: { value: string; completed: boolean; onSave: (value: string) => void; onDelete: () => void }) {
  const [draft, setDraft] = useState(value);
  const cancelled = useRef(false);
  useEffect(() => setDraft(value), [value]);
  return <DetailRow><Dash>-</Dash><LineField detail $done={completed} aria-label={`Edit detail ${value}`} value={draft} onChange={event => setDraft(event.target.value.replace(/[\r\n]+/g, ' '))} onBlur={() => { if (cancelled.current) { cancelled.current = false; setDraft(value); return; } if (draft.trim() && draft.trim() !== value) onSave(draft.trim()); else setDraft(value); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { cancelled.current = true; event.currentTarget.blur(); } }}/><Mini title="Delete detail" aria-label={`Delete detail ${value}`} onClick={onDelete}><X size={13}/></Mini></DetailRow>;
}
