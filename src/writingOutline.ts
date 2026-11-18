import { journalModel, materializeJournal, readJournal } from './journalDocument.ts';
import { detailAt, detailSiblings, moveOutlineDetail, promoteOutlineDetail, refreshItemCompletion } from './outline.ts';
import { writingTarget } from './writingPresentation.ts';
import { parseTimeBlock } from './timeBlock.ts';
import {shiftDate} from './dayWindow.ts';
import {validDate} from './todoText.ts';
import type { TodoItem } from './todoText.ts';

export type WritingOutlineAction = 'task' | 'plain' | 'up' | 'down' | 'in' | 'out' | 'promote' | 'delete' | { date: string } | { list: string };

/** structural edits reuse the source adapter and retain attached bodies and identities. */
export function editWritingOutline(source: string, start: number, action: WritingOutlineAction) {
  const original=readJournal(source), model=original.model, target=writingTarget(model,start);
  if(model.format!==3 || !target) throw new Error('Choose an item in a unified writing document.');
  if(target.entry.repeat || target.entry.replaces) throw new Error('Open this recurring entry to choose which occurrences to change.');
  const document=structuredClone(original.document), items=target.entry.date ? document.days.find(day=>day.date===target.entry.date)!.items : document.undated!.find(list=>list.name===target.entry.list)!.items;
  const item=items.find(item=>item.id===(target.entry.id ?? `source:${target.entry.range.start}`))!;
  const node=target.path.length ? detailAt(item.details,target.path) : item;
  if(action==='plain' || action==='task') {
    if(action==='plain' && (node.completed || !target.path.length && item.repeat?.kind==='after')) throw new Error('Reopen this task before making it plain.');
    node.kind=action==='plain'?'note':undefined;
    refreshItemCompletion(item);
  } else if(action==='delete') {
    if(target.path.length) detailSiblings(item,target.path).splice(target.path.at(-1)!,1);
    else items.splice(items.indexOf(item),1);
    refreshItemCompletion(item);
  } else if(action==='promote') {
    if(!target.path.length) throw new Error('This is already a top-level item.');
    promoteOutlineDetail(item,items,target.path,crypto.randomUUID(),true);
  } else if(typeof action==='object') {
    if(target.path.length) throw new Error('Make this branch a top-level item before moving it to another document.');
    let destination: TodoItem[];
    if('date' in action) {
      if(!validDate(action.date)) throw new Error('Choose a valid destination date.');
      if(target.entry.date && item.span){const delta=Math.round((Date.parse(`${action.date}T12:00:00Z`)-Date.parse(`${target.entry.date}T12:00:00Z`))/86400000);if(item.span.kind==='time')item.span.endDate=shiftDate(item.span.endDate,delta);else if(item.span.through)item.span.through=shiftDate(item.span.through,delta);}
      let day=document.days.find(day=>day.date===action.date);
      if(!day){day={date:action.date,items:[]};document.days.push(day);} destination=day.items;
    } else {
      if(!action.list.trim() || action.list!==action.list.trim() || /[\r\n]/.test(action.list)) throw new Error('Choose a valid document name on one line.');
      if(item.repeat || item.span || item.replaces || parseTimeBlock(item.text)) throw new Error('Clear the schedule before moving to an undated document.');
      let list=document.undated?.find(list=>list.name===action.list);
      if(!list){list={name:action.list,items:[]};(document.undated??=[]).push(list);} destination=list.items;
    }
    if(destination!==items){items.splice(items.indexOf(item),1);destination.push(item);}
  } else if(target.path.length) moveOutlineDetail(item,target.path,action);
  else {
    const index=items.indexOf(item);
    if(action==='up' || action==='down') {
      const next=index+(action==='up'?-1:1);
      if(next>=0 && next<items.length){items.splice(index,1);items.splice(next,0,item);}
    } else if(action==='in' && index>0) {
      if(item.repeat || item.span || item.replaces || item.completedOn || parseTimeBlock(item.text)) throw new Error('Clear the schedule and completion date before nesting this entry.');
      const parent=items[index-1];items.splice(index,1);
      parent.details.push({text:item.text,completed:item.completed,kind:item.kind,sourceRef:item.sourceRef,body:item.body,children:item.details});refreshItemCompletion(parent);
    } else throw new Error('This item cannot move in that direction.');
  }
  return journalModel(materializeJournal(document));
}

export function writingChildDraft(source: string, start: number): {start:number;markdown:string;selection:number} {
  const model=readJournal(source).model,target=writingTarget(model,start);
  if(model.format!==3 || !target || target.path.length>=32) throw new Error('Choose an outline item with room for another nesting level.');
  const nl=/\r\n|\r|\n/.exec(source)?.[0]??'\n';
  const root=source.slice(target.entry.range.start,target.entry.range.end), offset=target.node.range.end-target.entry.range.start;
  const marker=target.node.kind==='note'?'- ':'- [ ] ', prefix=nl+' '.repeat(target.node.column+2)+marker;
  return {start:target.entry.range.start,markdown:root.slice(0,offset)+prefix+'New child'+root.slice(offset),selection:offset+prefix.length};
}
