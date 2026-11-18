import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import type { writingTarget } from '../writingPresentation';
import type { WritingOutlineAction } from '../writingOutline';
import { Button, Field } from '../styles';
import { todayString, validDate } from '../todoText';

const Menu = styled.div`position:fixed;z-index:80;width:230px;max-height:calc(100dvh - 24px);overflow:auto;padding:5px;border:1px solid var(--line);border-radius:8px;background:var(--surface);box-shadow:0 10px 24px #0003;`;
const Action = styled.button`display:flex;align-items:center;justify-content:space-between;width:100%;min-height:40px;padding:7px 9px;border:0;border-radius:5px;background:transparent;color:var(--ink);font:inherit;font-size:13px;text-align:left;&:hover,&:focus-visible{background:var(--soft);}&:disabled{opacity:.45;}@media(pointer:coarse){min-height:44px;}`;
const Destination = styled.form`display:grid;gap:8px;padding:8px;border-top:1px solid var(--line);font-size:12px;input,select{min-height:40px;width:100%;background:var(--field);color:var(--ink);}select{border:1px solid var(--line);border-radius:5px;padding:6px;}`;

export function WritingNodeMenu({ target, anchor, lists, onClose, onEdit, onChild, onSchedule, onAction }: {target:NonNullable<ReturnType<typeof writingTarget>>;anchor:HTMLButtonElement;lists:string[];onClose:()=>void;onEdit:()=>void;onChild:()=>void;onSchedule?:()=>void;onAction:(action:WritingOutlineAction)=>Promise<void>}) {
  const panel=useRef<HTMLDivElement>(null),[moving,setMoving]=useState(false),[date,setDate]=useState(target.entry.date??todayString()),[list,setList]=useState(lists[0]??'Inbox'),[error,setError]=useState('');
  const rect=anchor.getBoundingClientRect(),dialog=anchor.closest('dialog'),bounds=dialog?.getBoundingClientRect();
  useEffect(()=>{panel.current?.querySelector<HTMLButtonElement>('button')?.focus();const outside=(event:PointerEvent)=>{if(!panel.current?.contains(event.target as Node) && !anchor.contains(event.target as Node))onClose();};const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();anchor.focus();}};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key,true);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key,true);};},[]);
  const run=(action:WritingOutlineAction)=>{void onAction(action).then(()=>{onClose();anchor.focus();}).catch(error=>setError(String(error)));};
  const index=target.path.at(-1)??0;
  return createPortal(<Menu ref={panel} aria-label={`Actions for ${target.node.text}`} style={{left:Math.max((bounds?.left??0)+8,Math.min(rect.right-230,(bounds?.right??innerWidth)-238))-(bounds?.left??0)+(dialog?.scrollLeft??0),top:Math.max((bounds?.top??0)+8,Math.min(rect.bottom+4,(bounds?.bottom??innerHeight)-440))-(bounds?.top??0)+(dialog?.scrollTop??0),maxHeight:bounds?bounds.height-24:undefined}}>
    {moving ? <>
      <Action onClick={()=>setMoving(false)}><ArrowLeft size={14}/>Item actions</Action>
      <Action onClick={()=>run('up')}>Move up</Action><Action onClick={()=>run('down')}>Move down</Action>
      <Action disabled={!!target.path.length && !index || target.path.length>=32} onClick={()=>run('in')}>Indent</Action>
      <Action disabled={target.path.length<2} onClick={()=>run('out')}>Outdent</Action>
      {!!target.path.length && <Action onClick={()=>run('promote')}>Make top-level item</Action>}
      {!target.path.length && <><Destination onSubmit={event=>{event.preventDefault();run({date});}}><label>Move to date<Field type="date" aria-label="Move item to date" value={date} onChange={event=>setDate(event.target.value)}/></label><Button type="submit" disabled={!validDate(date)}>Move to date</Button></Destination><Destination onSubmit={event=>{event.preventDefault();run({list});}}><label>Move to document<select aria-label="Move item to document" value={list} onChange={event=>setList(event.target.value)}>{(lists.length?lists:['Inbox']).map(name=><option key={name}>{name}</option>)}</select></label><Button type="submit" disabled={!!(target.entry.repeat||target.entry.span||target.entry.timeBlock||target.entry.replaces)}>Move to document</Button></Destination></>}
    </> : <>
      <Action onClick={()=>{onClose();onEdit();}}>Edit content</Action>
      <Action disabled={target.path.length>=32} onClick={()=>{onClose();onChild();}}>Add child</Action>
      <Action disabled={target.node.completed} title={target.node.completed?'Reopen this task before making it plain':undefined} onClick={()=>run(target.node.kind==='note'?'task':'plain')}>{target.node.kind==='note'?'Make task':'Make plain item'}</Action>
      {onSchedule && <Action onClick={()=>{onClose();onSchedule();}}>Schedule…</Action>}
      <Action onClick={()=>setMoving(true)}>Move…<ChevronRight size={14}/></Action>
      <Action onClick={()=>run('delete')}>Delete branch</Action>
    </>}
    {error && <p role="status">{error}</p>}
  </Menu>,dialog??document.body);
}
