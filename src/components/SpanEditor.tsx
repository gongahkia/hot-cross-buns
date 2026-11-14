import { useState } from 'react';
import styled from 'styled-components';
import { Modal } from './Modal';
import { validDate, type TodoSpan } from '../todoText';

const Title = styled.h2`margin:4px 2px 18px;font-size:18px;text-wrap:balance;`;
const Fields = styled.div`display:grid;gap:12px;`;
const Label = styled.label`display:grid;gap:6px;color:var(--muted);font-size:12px;`;
const Input = styled.input`min-height:44px;width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:7px;background:var(--field);color:var(--ink);font:inherit;font-size:14px;@media(pointer:coarse){font-size:16px;}`;
const Select = styled.select`min-height:44px;width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:7px;background:var(--field);color:var(--ink);font:inherit;font-size:14px;@media(pointer:coarse){font-size:16px;}`;
const Footer = styled.div`display:flex;justify-content:flex-end;gap:8px;margin-top:20px;`;
const Button = styled.button<{ $primary?:boolean }>`min-height:40px;padding:8px 14px;border:0;border-radius:7px;background:${({$primary})=>$primary?'var(--primary)':'var(--soft)'};color:${({$primary})=>$primary?'var(--primary-ink)':'var(--ink)'};font-size:13px;@media(pointer:coarse){min-height:44px;}`;
const Error = styled.p`margin:4px 0;color:var(--danger);font-size:12px;`;

export function SpanEditor({ open, date, span, onClose, onSave }: { open:boolean; date:string; span?:TodoSpan; onClose:()=>void; onSave:(span?:TodoSpan)=>void }) {
  const [kind,setKind] = useState<'none'|'all-day'|'all-day-through'|'time'>(span?.kind === 'time' ? 'time' : span?.kind === 'all-day' && span.through ? 'all-day-through' : span?.kind === 'all-day' ? 'all-day' : 'all-day');
  const [through,setThrough] = useState(span?.kind === 'all-day' ? span.through ?? date : date);
  const [start,setStart] = useState(span?.kind === 'time' ? span.start : '22:00');
  const [end,setEnd] = useState(span?.kind === 'time' ? span.end : '06:00');
  const [endDate,setEndDate] = useState(span?.kind === 'time' ? span.endDate : date);
  const [error,setError] = useState('');
  const save = () => {
    if (kind === 'none') { onSave(undefined); return; }
    if (kind === 'all-day') { onSave({kind:'all-day'}); return; }
    if (kind === 'all-day-through') {
      if (!validDate(through) || through <= date) { setError('Choose an end date after this date.'); return; }
      onSave({kind:'all-day',through}); return;
    }
    if (!validDate(endDate) || endDate <= date || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) { setError('Choose a valid end date after this date and both times.'); return; }
    onSave({kind:'time',start,endDate,end});
  };
  return <Modal open={open} onClose={onClose} title="Edit span" compact><Title>When does this item occupy time?</Title><Fields>
    <Label>span<Select aria-label="Span type" value={kind} onChange={event => { setKind(event.target.value as typeof kind); setError(''); }}><option value="none">No span</option><option value="all-day">All day</option><option value="all-day-through">All day through another date</option><option value="time">Across dates, with times</option></Select></Label>
    {kind === 'all-day-through' && <Label>through<Input aria-label="Span through date" type="date" value={through} onChange={event => setThrough(event.target.value)}/></Label>}
    {kind === 'time' && <><Label>starts<Input aria-label="Span start time" type="time" value={start} onChange={event => setStart(event.target.value)}/></Label><Label>ends on<Input aria-label="Span end date" type="date" value={endDate} onChange={event => setEndDate(event.target.value)}/></Label><Label>at<Input aria-label="Span end time" type="time" value={end} onChange={event => setEnd(event.target.value)}/></Label></>}
    {error && <Error role="alert">{error}</Error>}
  </Fields><Footer><Button onClick={onClose}>cancel</Button><Button $primary onClick={save}>save</Button></Footer></Modal>;
}
