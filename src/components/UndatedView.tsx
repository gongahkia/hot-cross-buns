import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { CalendarDays, GripVertical, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { CalendarPanel } from './CalendarPanel';
import { todayString, type TodoDetail, type TodoItem, type TodoList } from '../todoText';

const Section = styled.section`margin: 0 0 36px;`;
const Heading = styled.h2`margin: 0 0 14px; font-size: 15px; color: var(--ink); text-wrap: balance;`;
const HeadingRow = styled.div`display:flex;align-items:center;justify-content:space-between;min-height:44px;position:relative; &:hover [data-list-control], &:focus-within [data-list-control]{opacity:1;} @media(hover:none){[data-list-control]{opacity:1;}}`;
const Row = styled.div<{ $dragging?:boolean }>`display:grid; grid-template-columns:22px minmax(0,1fr) 44px; align-items:start; gap:0; margin-left:36px; border-radius:7px; position:relative; opacity:${({$dragging})=>$dragging ? .5 : 1}; &:hover{background:var(--soft);} [data-row-control]{opacity:0;transition:opacity 120ms ease-out;} &:hover [data-row-control], &:focus-within [data-row-control]{opacity:1;} @media(hover:none){[data-row-control]{opacity:1;}} @media(max-width:600px){margin-left:0;grid-template-columns:44px minmax(0,1fr) 44px;}`;
const DetailRow = styled(Row)`margin-left:64px; @media(max-width:600px){margin-left:18px;}`;
const Grip = styled.button`width:22px;height:44px;display:grid;place-items:center;padding:0;border:0;border-radius:5px;background:transparent;color:var(--muted);cursor:grab;touch-action:none;&:active{cursor:grabbing;}@media(pointer:coarse){width:44px;}`;
const Text = styled.textarea`width:100%; min-height:44px; padding:10px 2px; border:0; border-radius:4px; background:transparent; color:var(--ink); resize:none; overflow:hidden; font:inherit; font-size:15px; line-height:1.45; overflow-wrap:anywhere; &:focus{outline:0;box-shadow:inset 0 -1px var(--focus);} @media(pointer:coarse){font-size:16px;}`;
const Detail = styled(Text)`min-height:36px; color:var(--muted); font-size:13px; @media(pointer:coarse){font-size:16px;}`;
const Icon = styled.button`width:44px;height:44px;display:grid;place-items:center;border:0;border-radius:7px;background:transparent;color:var(--muted); &:hover,&:focus-visible{background:var(--soft);color:var(--ink);}`;
const ListIcon = styled(Icon)`opacity:0;transition:opacity 120ms ease-out;`;
const Menu = styled.div`position:absolute;right:0;top:40px;z-index:20;width:min(340px,calc(100vw - 24px));padding:6px;border:1px solid var(--line);border-radius:10px;background:var(--surface);box-shadow:0 12px 30px #0003;`;
const MenuAction = styled.button`display:flex;align-items:center;gap:8px;width:100%;min-height:40px;padding:6px 10px;border:0;border-radius:6px;background:transparent;color:var(--ink);font-size:13px;text-align:left;&:hover{background:var(--soft);}@media(pointer:coarse){min-height:44px;}`;
const MenuMessage = styled.p`margin:5px 9px 7px;color:var(--muted);font-size:13px;line-height:1.4;`;
const Actions = styled.div`position:relative;`;
const Add = styled.input`display:block;width:calc(100% - 58px);min-height:44px;margin-left:58px;padding:8px 2px;border:0;border-radius:4px;background:transparent;color:var(--ink);font:inherit;font-size:13px;&:focus{outline:0;box-shadow:inset 0 -1px var(--focus);}::placeholder{color:var(--muted);}@media(max-width:600px){width:100%;margin-left:0;}@media(pointer:coarse){font-size:16px;}`;
const AddList = styled.button`min-height:40px;padding:6px 10px;border:0;border-radius:6px;background:transparent;color:var(--muted);font-size:13px;&:hover{background:var(--soft);color:var(--ink);}`;
const AddListField = styled(Add)`margin-left:0;width:100%;`;
const EmptyLists = styled.p`margin:12px 0 24px;color:var(--muted);font-size:13px;`;

function DraftText({ value, label, detail, onSave }: { value: string; label: string; detail?: boolean; onSave: (text: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const Component = detail ? Detail : Text;
  return <Component key={value} rows={1} aria-label={label} value={draft} onChange={event => setDraft(event.target.value.replace(/[\r\n]+/g, ' '))} onBlur={() => { const next = draft.trim(); if (next && next !== value) onSave(next); else setDraft(value); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { setDraft(value); event.currentTarget.blur(); } }}/>
}

type ItemActions = {
  onEdit: (list: string, id: string, text: string) => void;
  onAddDetail: (list: string, id: string, text: string) => void;
  onEditDetail: (list: string, id: string, index: number, text: string) => void;
  onDeleteDetail: (list: string, id: string, index: number) => void;
  onReorderDetails: (list: string, id: string, from: number, to: number) => void;
  onDate: (list: string, id: string, date: string) => void;
  onDelete: (list: string, id: string) => void;
};

function SortableDetail({ detail, index, id, list, item, disabled, onEditDetail, onDeleteDetail }: {
  detail: TodoDetail; index: number; id: string; list: string; item: TodoItem; disabled: boolean;
  onEditDetail: ItemActions['onEditDetail']; onDeleteDetail: ItemActions['onDeleteDetail'];
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  return <DetailRow ref={setNodeRef} $dragging={isDragging} style={{ transform: CSS.Transform.toString(transform), transition }}>
    <Grip data-row-control ref={setActivatorNodeRef} type="button" {...attributes} {...listeners} disabled={disabled} aria-label={'Drag to reorder detail ' + detail.text} title={disabled ? 'Clear filters to reorder' : 'Drag to reorder detail'}><GripVertical size={13}/></Grip>
    <DraftText detail value={detail.text} label={'Edit detail ' + detail.text} onSave={text => onEditDetail(list,item.id,index,text)}/>
    <Icon data-row-control aria-label={'Delete detail ' + detail.text} onClick={() => onDeleteDetail(list,item.id,index)}><Trash2 size={14}/></Icon>
  </DetailRow>;
}

function SortableItem({ item, list, disabled, ...actions }: { item: TodoItem; list: string; disabled: boolean } & ItemActions) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled });
  const [open, setOpen] = useState<'actions' | 'date' | null>(null);
  const [addDetail, setAddDetail] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const counts = new Map<string,number>();
  const detailIds = item.details.map(detail => {
    const count = counts.get(detail.text) ?? 0;
    counts.set(detail.text,count+1);
    return item.id + ':detail:' + JSON.stringify(detail.text) + ':' + count;
  });
  return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, position: 'relative', zIndex: isDragging ? 1 : undefined }}>
    <Row $dragging={isDragging}>
      <Grip data-row-control ref={setActivatorNodeRef} type="button" {...attributes} {...listeners} disabled={disabled} aria-label={'Drag to reorder ' + item.text} title={disabled ? 'Clear filters to reorder' : 'Drag to reorder item'}><GripVertical size={14}/></Grip>
      <DraftText value={item.text} label={'Edit ' + item.text} onSave={text => actions.onEdit(list,item.id,text)}/>
      <Actions><Icon data-row-control aria-label={'More actions for ' + item.text} aria-expanded={open !== null} onClick={() => setOpen(open ? null : 'actions')}><MoreHorizontal size={17}/></Icon>
        {open === 'actions' && <Menu aria-label={'Actions for ' + item.text}>
          <MenuAction onClick={() => { setOpen(null); setAddDetail(true); }}><Plus size={15}/> add detail</MenuAction>
          <MenuAction onClick={() => setOpen('date')}><CalendarDays size={15}/> add date</MenuAction>
          <MenuAction onClick={() => { setOpen(null); actions.onDelete(list,item.id); }}><Trash2 size={15}/> delete</MenuAction>
        </Menu>}
        {open === 'date' && <Menu><CalendarPanel label={'Choose date for ' + item.text} value={todayString()} onSelect={value => { actions.onDate(list,item.id,value); setOpen(null); }}/></Menu>}
      </Actions>
    </Row>
    <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis,restrictToParentElement]} onDragEnd={({active,over}) => {
      if (!over || active.id === over.id) return;
      const from = detailIds.indexOf(String(active.id));
      const to = detailIds.indexOf(String(over.id));
      if (from >= 0 && to >= 0) actions.onReorderDetails(list,item.id,from,to);
    }}><SortableContext items={detailIds} strategy={verticalListSortingStrategy}>
      {item.details.map((detail,index) => <SortableDetail key={detailIds[index]} id={detailIds[index]} detail={detail} index={index} list={list} item={item} disabled={disabled} onEditDetail={actions.onEditDetail} onDeleteDetail={actions.onDeleteDetail}/>)}
    </SortableContext></DndContext>
    {addDetail && <Add autoFocus aria-label={'New detail for ' + item.text} placeholder="New detail…" onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.currentTarget.value=''; setAddDetail(false); } }} onBlur={event => { if (event.currentTarget.value.trim()) actions.onAddDetail(list,item.id,event.currentTarget.value.trim()); setAddDetail(false); }}/>}
  </div>;
}

export function UndatedView({ lists, query, tag, onAddList, onDeleteList, onAdd, onReorderItems, ...actions }: {
  lists?: TodoList[]; query: string; tag: string | null; onAddList: (name: string) => void; onDeleteList: (name: string) => void;
  onAdd: (list: string, text: string) => void; onReorderItems: (list: string, from: string, to: string) => void;
} & ItemActions) {
  const [openList, setOpenList] = useState<string | null>(null);
  const [confirmList, setConfirmList] = useState<string | null>(null);
  const [creatingList, setCreatingList] = useState(false);
  useEffect(() => { setOpenList(null); setConfirmList(null); }, [query,tag]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const shown = lists ?? [{ name: 'Inbox', items: [] }];
  const filtered = shown.map(list => ({ ...list, items: list.items.filter(item => {
    const content = [item.text,...item.details.map(detail => detail.text)].join(' ').toLowerCase();
    return (!query || content.includes(query.toLowerCase())) && (!tag || new RegExp('(?:^|\\s)#' + tag + '(?=$|\\s)', 'i').test(content));
  }) })).filter(list => !query && !tag || list.items.length);
  const filteredActive = !!(query || tag);
  return <div aria-label="Undated items">
    {filteredActive && !filtered.length && <p role="status">No undated items match this search</p>}
    {!filteredActive && lists?.length === 0 && <EmptyLists>No lists yet. Add the first one below.</EmptyLists>}
    {filtered.map(list => <Section key={list.name} aria-label={list.name}>
      <HeadingRow><Heading>{list.name}</Heading>{!filteredActive && <Actions>
        <ListIcon data-list-control aria-label={'More actions for list ' + list.name} aria-expanded={openList === list.name} onClick={() => { setOpenList(openList === list.name ? null : list.name); setConfirmList(null); }}><MoreHorizontal size={17}/></ListIcon>
        {openList === list.name && <Menu aria-label={'Actions for list ' + list.name}>
          {confirmList === list.name ? <>
            <MenuMessage>Delete {list.name} and its {list.items.length} {list.items.length === 1 ? 'item' : 'items'}? You can undo this.</MenuMessage>
            <MenuAction onClick={() => { onDeleteList(list.name); setOpenList(null); setConfirmList(null); }}><Trash2 size={15}/> delete list and items</MenuAction>
            <MenuAction onClick={() => setConfirmList(null)}>cancel</MenuAction>
          </> : <MenuAction onClick={() => { if (list.items.length) setConfirmList(list.name); else { onDeleteList(list.name); setOpenList(null); } }}><Trash2 size={15}/> delete list{list.items.length ? ' and ' + list.items.length + (list.items.length === 1 ? ' item' : ' items') : ''}</MenuAction>}
        </Menu>}
      </Actions>}</HeadingRow>
      <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis,restrictToParentElement]} onDragEnd={({active,over}) => {
        if (over && active.id !== over.id) onReorderItems(list.name,String(active.id),String(over.id));
      }}><SortableContext items={list.items.map(item => item.id)} strategy={verticalListSortingStrategy}>
        {list.items.map(item => <SortableItem key={item.id} item={item} list={list.name} disabled={filteredActive} {...actions}/>)}
      </SortableContext></DndContext>
      {!filteredActive && <Add aria-label={'New item in ' + list.name} placeholder={list.items.length ? 'New item…' : 'No items yet. Add the first one here.'} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} onBlur={event => { if (event.currentTarget.value.trim()) { onAdd(list.name,event.currentTarget.value.trim()); event.currentTarget.value=''; } }}/>}
    </Section>)}
    {!filteredActive && (creatingList
      ? <AddListField autoFocus aria-label="New list name" placeholder="List name…" onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.currentTarget.value=''; event.currentTarget.blur(); } }} onBlur={event => { const name = event.currentTarget.value.trim(); if (name) onAddList(name); setCreatingList(false); }}/>
      : <AddList onClick={() => setCreatingList(true)}>+ new list</AddList>)}
  </div>;
}
