import { useState, type ReactNode } from 'react';
import styled from 'styled-components';
import type { TodoDocument } from '../todoText';
import type { WritingOperation } from '../journalWriting';
import { Button, Field, Muted } from '../styles';
import type { ViewItem } from '../seriesView';
import { WritingDocument } from './WritingDocument';

const Document = styled.section`margin-bottom:36px;min-width:0;scroll-margin-top:20px;`;
const Title = styled.h2`font-size:17px;margin:4px 0 14px;`;
const NewList = styled.form`display:flex;gap:8px;align-items:center;margin:12px 0;input{min-width:0;flex:1;}`;

export function WritingJournal({ document, view, dates, visibleLists, renderDateHeading, onWrite, onToggleTask, onCreateList, composeRequest, projectedDays, onOpenEntry }: { composeRequest?: {date:string;key:number} | null; projectedDays?: Array<{date:string;items:ViewItem[]}>; onOpenEntry?: (date:string,item:ViewItem)=>void; document: TodoDocument; view: 'dated' | 'undated'; dates: string[]; visibleLists?: string[]; renderDateHeading: (date: string) => ReactNode; onWrite: (operation: WritingOperation, expected: string) => Promise<void>; onToggleTask: (start: number) => void; onCreateList: (name: string) => void }) {
  const [name, setName] = useState('');
  return view === 'dated' ? <>{dates.map(date => <Document key={date} data-journal-date={date} aria-label={`Document for ${date}`}>
    {renderDateHeading(date)}
    <WritingDocument document={document} onOpenEntry={id=>{const item=projectedDays?.find(day=>day.date===date)?.items.find(item=>item.id===id);if(item)onOpenEntry?.(date,item);}} appendRequest={composeRequest?.date===date ? composeRequest.key : 0} location={{ kind: 'dated', date }} label={date} onWrite={onWrite} onToggleTask={onToggleTask}/>
    {(projectedDays?.find(day=>day.date===date)?.items??[]).filter(item=>item.projection).map(item=><p key={item.id}><Button onClick={()=>onOpenEntry?.(date,item)}>{item.text}</Button><Muted as="span"> · {item.projection?.continuation ? 'continues' : 'repeats'}</Muted></p>)}
  </Document>)}</> : <>
    {(document.undated ?? []).filter(list => !visibleLists || visibleLists.includes(list.name)).map(list => <Document key={list.sourceRef ?? list.name} aria-label={`Document for ${list.name}`}>
      <Title>{list.name}</Title>
      <WritingDocument document={document} location={{ kind: 'undated', list: list.name }} label={list.name} onWrite={onWrite} onToggleTask={onToggleTask}/>
    </Document>)}
    {!visibleLists && <NewList onSubmit={event => { event.preventDefault(); if (name.trim()) { onCreateList(name.trim()); setName(''); } }}><Field aria-label="New undated document" placeholder="New document" value={name} onChange={event => setName(event.target.value)}/><Button type="submit" disabled={!name.trim() || document.undated?.some(list => list.name === name.trim())}>Add document</Button></NewList>}
  </>;
}
