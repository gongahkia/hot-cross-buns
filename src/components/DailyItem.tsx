import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import styled from 'styled-components';
import { ArrowDown, ArrowUp, CalendarDays, Check, MoreHorizontal, Plus, Trash2, X } from 'lucide-react';
import { Field, IconButton } from '../styles';
import { validDate, type TodoItem } from '../todoText';

const ItemRow = styled.div`position: relative; display: flex; align-items: flex-start; gap: 4px; min-height: 40px; border-radius: 7px; &:hover { background: var(--soft); }`;
const CheckButton = styled.button<{ $done: boolean }>`width: 40px; height: 40px; display: grid; place-items: center; flex: none; border: 0; background: transparent; color: ${({ $done }) => $done ? 'var(--link)' : 'var(--checkbox)'}; @media(pointer:coarse){width:44px;height:44px;}`;
const Circle = styled.span<{ $done: boolean }>`display: grid; place-items: center; width: 15px; height: 15px; border: 1px solid currentColor; border-radius: 50%; background: ${({ $done }) => $done ? 'var(--link)' : 'transparent'}; color: ${({ $done }) => $done ? 'var(--paper)' : 'var(--checkbox)'};`;
const ItemBody = styled.div`min-width: 0; flex: 1;`;
const ItemInput = styled.textarea`display: block; width: 100%; min-height: 40px; border: 0; border-radius: 4px; padding: 9px 2px; background: transparent; font-size: 15px; line-height: 1.4; color: var(--ink); overflow: hidden; resize: none; &:focus { background: var(--field); box-shadow: 0 0 0 1px var(--focus); } @media(pointer:coarse){min-height:44px; padding-top: 11px;}`;
const DetailInput = styled(ItemInput)`font-size: 13px; min-height: 32px; color: var(--muted); @media(pointer:coarse){min-height:44px;}`;
const DetailRow = styled.div`display: flex; align-items: center; gap: 6px; margin-left: 3px; &:hover button { opacity: 1; }`;
const Dash = styled.span`color: var(--muted); font-size: 13px;`;
const MoveDate = styled(Field)`width: 150px; min-height: 40px; font-size: 13px; @media(pointer:coarse){min-height:44px;}`;
const Mini = styled.button`display: inline-grid; place-items: center; width: 32px; height: 32px; flex: none; padding: 0; border: 0; border-radius: 5px; color: var(--muted); background: transparent; &:hover { color: var(--link); background: var(--date-bg); } @media(pointer:coarse){width:44px;height:44px;}`;
const ActionWrap = styled.div`position: static; flex: none;`;
const MoreButton = styled(IconButton)`width: 40px; height: 40px; @media(pointer:coarse){width:44px;height:44px;}`;
const ActionMenu = styled.div`position: absolute; right: 0; top: 100%; z-index: 10; width: 176px; padding: 5px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface); box-shadow: 0 10px 30px #0002;`;
const Action = styled.button`width: 100%; min-height: 40px; display: flex; align-items: center; gap: 9px; padding: 7px 9px; border: 0; border-radius: 5px; background: transparent; color: var(--ink); font-size: 13px; text-align: left; &:hover { background: var(--soft); } @media(pointer:coarse){min-height:44px;}`;
const AddForm = styled.form`display: flex; align-items: center; gap: 4px; margin-left: 40px; max-width: calc(100% - 40px);`;
const AddInput = styled(Field)`min-height: 40px; border-color: transparent; background: transparent; padding-left: 2px; &:focus { background: var(--field); border-color: var(--focus); } @media(pointer:coarse){min-height:44px;}`;
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
  const [text, setText] = useState(item.text);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const cancelText = useRef(false);
  const cancelDetail = useRef(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveDate, setMoveDate] = useState(date);
  const [addingDetail, setAddingDetail] = useState(false);
  const [detailDraft, setDetailDraft] = useState('');
  useEffect(() => setText(item.text), [item.text]);
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [menuOpen]);
  const saveText = () => { if (cancelText.current) { cancelText.current = false; setText(item.text); return; } const value = text.trim(); if (value && value !== item.text) onChange(item => { item.text = value; }); else setText(item.text); };
  const closeMenu = (action: () => void) => { setMenuOpen(false); action(); };
  return <ItemRow role="group" aria-label={item.text}>
    <CheckButton $done={item.completed} aria-label={`${item.completed ? 'Reopen' : 'Complete'} ${item.text}`} onClick={() => onChange(item => { item.completed = !item.completed; })}><Circle $done={item.completed}>{item.completed && <Check size={12}/>}</Circle></CheckButton>
    <ItemBody>
      <LineField aria-label={`Edit ${item.text}`} value={text} onChange={event => setText(event.target.value.replace(/[\r\n]+/g, ' '))} onBlur={saveText} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { cancelText.current = true; event.currentTarget.blur(); } }}/>
      {item.details.map((detail,index) => <Detail key={`${item.id}-${index}`} value={detail} onSave={value => onChange(item => { item.details[index] = value; })} onDelete={() => onChange(item => { item.details.splice(index,1); })}/>)}
      {addingDetail && <DetailRow><Dash>-</Dash><LineField detail autoFocus aria-label={`New detail for ${item.text}`} value={detailDraft} onChange={event => setDetailDraft(event.target.value.replace(/[\r\n]+/g, ' '))} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { cancelDetail.current = true; event.currentTarget.blur(); } }} onBlur={() => { if (!cancelDetail.current && detailDraft.trim()) onChange(item => { item.details.push(detailDraft.trim()); }); cancelDetail.current = false; setDetailDraft(''); setAddingDetail(false); }}/></DetailRow>}
      {moveOpen && <DetailRow><Dash>move to</Dash><MoveDate aria-label={`Move ${item.text} to date`} type="date" value={moveDate} onChange={event => setMoveDate(event.target.value)}/><Mini aria-label="Confirm move" onClick={() => { if (validDate(moveDate)) { onMove(moveDate); setMoveOpen(false); } }}><Check size={14}/></Mini></DetailRow>}
      {date < today && !item.completed && <UnfinishedNote>unfinished</UnfinishedNote>}
    </ItemBody>
    <ActionWrap ref={menuRef}>
      <MoreButton aria-label={`More actions for ${item.text}`} aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}><MoreHorizontal size={17}/></MoreButton>
      {menuOpen && <ActionMenu aria-label={`Actions for ${item.text}`}>
        <Action aria-label={`Add detail to ${item.text}`} onClick={() => closeMenu(() => setAddingDetail(true))}><Plus size={15}/> add detail</Action>
        <Action aria-label={`Move ${item.text}`} onClick={() => closeMenu(() => setMoveOpen(value => !value))}><CalendarDays size={15}/> move to date</Action>
        <Action aria-label={`Move ${item.text} up`} onClick={() => closeMenu(() => onChange((item, items) => { const index = items.indexOf(item); let previous = -1; for (let position = index - 1; position >= 0; position--) { if (items[position].completed === item.completed) { previous = position; break; } } if (previous >= 0) [items[previous], items[index]] = [items[index], items[previous]]; }))}><ArrowUp size={15}/> move up</Action>
        <Action aria-label={`Move ${item.text} down`} onClick={() => closeMenu(() => onChange((item, items) => { const index = items.indexOf(item); const next = items.findIndex((candidate, position) => position > index && candidate.completed === item.completed); if (next >= 0) [items[next], items[index]] = [items[index], items[next]]; }))}><ArrowDown size={15}/> move down</Action>
        <Action aria-label={`Delete ${item.text}`} onClick={() => closeMenu(() => onChange((item, items) => { items.splice(items.indexOf(item),1); }))}><Trash2 size={15}/> delete</Action>
      </ActionMenu>}
    </ActionWrap>
  </ItemRow>;
}

function Detail({ value, onSave, onDelete }: { value: string; onSave: (value: string) => void; onDelete: () => void }) {
  const [draft, setDraft] = useState(value);
  const cancelled = useRef(false);
  useEffect(() => setDraft(value), [value]);
  return <DetailRow><Dash>-</Dash><LineField detail aria-label={`Edit detail ${value}`} value={draft} onChange={event => setDraft(event.target.value.replace(/[\r\n]+/g, ' '))} onBlur={() => { if (cancelled.current) { cancelled.current = false; setDraft(value); return; } if (draft.trim() && draft.trim() !== value) onSave(draft.trim()); else setDraft(value); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { cancelled.current = true; event.currentTarget.blur(); } }}/><Mini title="Delete detail" aria-label={`Delete detail ${value}`} onClick={onDelete}><X size={13}/></Mini></DetailRow>;
}
