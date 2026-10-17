import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, pointerWithin, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent } from '@dnd-kit/core';
import { createPortal, flushSync } from 'react-dom';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { restrictToWindowEdges } from '@dnd-kit/modifiers';
import styled, { keyframes } from 'styled-components';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Download, FileInput, NotebookPen, PanelsTopLeft, Search, Settings2, X } from 'lucide-react';
import { Button, Field, IconButton, Muted, VisuallyHidden } from './styles';
import { AppearanceSettings } from './components/AppearanceSettings';
import { UndoFeedback, type UndoNoticeKind } from './components/UndoFeedback';
import { FileReview, type FileReviewState } from './components/FileReview';
import { AddItem, JournalItem, useJournalFieldResize } from './components/DailyItem';
import { JournalDatePicker } from './components/JournalDatePicker';
import { ExportPreview, type LineEnding } from './components/ExportPreview';
import { UndatedView } from './components/UndatedView';
import { Modal } from './components/Modal';
import { ScratchpadView } from './components/ScratchpadView';
import { datesInRange, shiftDate, shiftRange, weekRange, type DateSpan } from './dayWindow';
import { formatDateHeading, getDateFormat, setDateFormat, getTimeZone, setTimeZone, getWeekStart, setWeekStart, getHolidayCountry, setHolidayCountry, getHolidayMode, setHolidayMode, getHolidaysEnabled, setHolidaysEnabled, getPastUnfinishedScope, setPastUnfinishedScope, type DateFormat, type HolidayMode, type PastUnfinishedScope } from './preferences';
import { earlierUnfinishedDays } from './earlierUnfinished';
import { addSavedHolidays, fetchHolidayYear, type HolidayYear, type PublicHoliday } from './holidays';
import { cloneDocument, emptyDocument, itemValue, newId, parseTodoText, serializeTodoText, todayString, validDate, validateDocument, type TodoDocument, type TodoItem } from './todoText';
import { applyDoctorAction, doctorTodoText, type DoctorAction, type DoctorFinding } from './todoDoctor';
import { fileBaseline, proposeMerge, resolveMerge, type MergeChoice } from './todoMerge';
import { advanceRecurrences, nextRecurrenceDate } from './recurrence';
import { parseTimeBlock } from './timeBlock';
import { materializeOccurrence, projectItemsForDate, type ViewItem } from './seriesView';
import { newSeriesId, type RecurrenceRule } from './recurrence';
import { emptyState, loadTodoState, mutateTodoState, subscribeStore, undoScratchpadConversion, type ScratchpadUndo, type TodoState } from './todoStore';

const Page = styled.main<{ $dated?: boolean }>`display:flex; flex-direction:column; width: min(730px, calc(100% - 40px)); height:${({$dated})=>$dated?'100dvh':'auto'}; min-height:${({$dated})=>$dated?'0':'100dvh'}; margin: 0 auto; padding: 35px 0 ${({$dated})=>$dated?'max(12px,env(safe-area-inset-bottom))':'80px'}; overflow:${({$dated})=>$dated?'hidden':'visible'}; @media(max-width: 600px){width: calc(100% - 28px); padding-top: 16px;}`;
const Header = styled.header<{ $revealed: boolean }>`position: relative; z-index: 40; display: flex; align-items: center; gap: 16px; min-height: 44px; margin-bottom: 20px; opacity: ${({$revealed})=>$revealed?1:0}; transition: opacity 150ms ease-out; &:hover, &:focus-within { opacity: 1; } @media(hover:none){opacity:1;} @media(max-width: 760px){flex-wrap:wrap; justify-content:flex-end;}`;
const HeaderBrand = styled.span`align-self:center;margin-right:auto;font-size:13px;color:var(--muted);white-space:nowrap;`;
const Tools = styled.div`display: flex; align-items: center; gap: 2px; @media(max-width:390px){gap:0; > button {width:40px;}}`;
const Icon = styled(IconButton)`width: 44px; height: 44px;`;
const Toolbar = styled.div`display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; @media(max-width: 760px){order:2;flex-basis:100%;} @media(max-width: 600px){display: grid; grid-template-columns: 44px minmax(0,1fr) 44px 44px; gap: 6px;}`;
const DateControl = styled.div<{ $range:boolean }>`position: relative; display: flex; align-items: center; width: ${({$range})=>$range?'255px':'155px'}; min-width: 0; min-height: 44px; @media(max-width:600px){width:100%;}`;
const DateText = styled.button`flex: 1; min-width: 0; min-height: 44px; padding: 8px 0 8px 4px; border: 0; border-radius: 7px; background: transparent; color: var(--ink); font-size: 13px; text-align: left; white-space: nowrap; overflow:hidden; text-overflow:ellipsis; &:hover { text-decoration: underline; text-underline-offset: 3px; font-weight: 600; } .compact{display:none;} @media(max-width:600px){.full{display:none;} .compact{display:inline;}}`;
const DateCalendar = styled(IconButton)`width: 44px; height: 44px; color: var(--ink);`;
const DatePopover = styled.div`position: absolute; top: calc(100% + 6px); left: 0; z-index: 30; @media(max-width: 390px){left: -50px;}`;
const SearchBox = styled.div`position:relative; flex:1; min-width:0; @media(max-width:600px){grid-column:1 / -1;}`;
const SearchField = styled(Field)`min-height: 44px; width: 100%; padding-right: 44px; font-size: 13px; &::-webkit-search-cancel-button { display: none; } @media(pointer:coarse){font-size:16px;}`;
const ClearSearch = styled(IconButton)`position: absolute; right: 0; top: 0; width: 44px; height: 44px;`;
const TagRail = styled.nav<{ $bounded:boolean }>`display: flex; gap: 6px; flex-wrap: wrap; max-height:${({$bounded})=>$bounded?'min(120px,24dvh)':'none'}; overflow-y:${({$bounded})=>$bounded?'auto':'visible'}; margin-bottom: 24px;`;
const TagPill = styled.button<{ $active: boolean }>`min-height: 36px; border: 1px solid ${({ $active }) => $active ? 'var(--tag-selected)' : 'var(--line)'}; color: ${({ $active }) => $active ? 'var(--tag-selected)' : 'var(--tag-ink)'}; background: var(--tag-bg); padding: 5px 10px; border-radius: 999px; font-size: 12px; @media(pointer:coarse){min-height:44px;}`;
const dayEnter = keyframes`from { opacity:.45; transform:translateY(5px); } to { opacity:1; transform:translateY(0); }`;
const DaySection = styled.section<{ $selected:boolean }>`margin: 0 0 38px; scroll-margin-top: 20px; animation:${({$selected})=>$selected?dayEnter:'none'} 180ms ease-out;`;
const DayTitle = styled.h2<{ $over?: boolean; $holiday?: boolean }>`display: flex; align-items: center; flex-wrap:${({$holiday})=>$holiday?'wrap':'nowrap'}; gap: 10px; min-width: 0; font-size: 15px; margin-bottom: 10px; border-radius: 9px; background: ${({ $over }) => $over ? 'var(--soft)' : 'transparent'}; box-shadow: ${({ $over }) => $over ? '0 0 0 2px var(--focus)' : 'none'};`;
const DateBadge = styled.time`padding: 4px 8px; background: var(--date-bg); border-radius: 9px;`;
const DayName = styled.span<{ $hideOnMobile: boolean }>`@media(max-width:600px){display:${({$hideOnMobile})=>$hideOnMobile?'none':'inline'};}`;
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
const Dismiss = styled.button`width: 32px; height: 32px; flex:none; border: 0; border-radius: 5px; background: transparent; color: inherit; &:hover {background: var(--soft);} @media(pointer:coarse){width:44px;height:44px;}`;
const DayUnfinished = styled.span`display: inline-flex; align-items: center; gap: 6px; margin-left: auto; color: var(--link); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; .short-label{display:none;} @media(max-width:600px){ .long-label{display:none;} .short-label{display:inline;} }`;
const HolidayBadge = styled.span`display:inline-flex;align-items:center;gap:5px;min-width:0;max-width:min(210px,38vw);padding:4px 8px;border-radius:999px;background:var(--soft);color:var(--muted);font-size:11px;font-weight:400;line-height:1.2;white-space:nowrap;overflow:hidden;>span{min-width:0;overflow:hidden;text-overflow:ellipsis;}@media(max-width:600px){max-width:44vw;}`;
const HolidayLoadError = styled.p`margin:-12px 0 18px;color:var(--muted);font-size:12px;`;
const ViewTabs = styled.nav`display:flex;align-items:center;gap:4px;margin:-4px 0 26px;`;
const ViewTab = styled.button<{ $active:boolean }>`min-height:40px;padding:6px 12px;border:0;border-radius:7px;background:${({$active})=>$active?'var(--date-bg)':'transparent'};color:${({$active})=>$active?'var(--ink)':'var(--muted)'};font-size:13px;font-weight:${({$active})=>$active?600:400};&:hover{background:var(--soft);color:var(--ink);}@media(pointer:coarse){min-height:44px;}`;
const JournalViewport = styled.div<{ $dated:boolean }>`flex:${({$dated})=>$dated?'1':'none'}; min-height:0; overflow-y:${({$dated})=>$dated?'auto':'visible'}; overscroll-behavior:contain; scrollbar-width:none; padding:0 3px ${({$dated})=>$dated?'24px':'0'} 0; &::-webkit-scrollbar{display:none;} &:focus{outline:none;}`;
const EarlierLink = styled.button`display:inline-flex;align-items:center;gap:7px;align-self:flex-start;min-height:32px;margin:-14px 0 12px 0;padding:3px 5px;border:0;border-radius:5px;background:transparent;color:var(--link);font-size:12px;font-variant-numeric:tabular-nums;text-align:left;&:hover{text-decoration:underline;text-underline-offset:3px;}@media(pointer:coarse){min-height:44px;margin-top:-16px;}`;
const ScopeTitle = styled.h2`margin:4px 4px 12px;font-size:17px;line-height:1.3;text-wrap:balance;`;
const ScopeHint = styled.p`margin:0 4px 14px;color:var(--muted);font-size:13px;line-height:1.45;`;
const ScopeOption = styled.button`display:block;width:100%;min-height:44px;padding:10px 12px;border:0;border-radius:7px;background:transparent;color:var(--ink);font-size:14px;text-align:left;&:hover,&:focus-visible{background:var(--soft);}`;
const PopoutField = styled.label`display:grid;gap:6px;margin:12px 0;font-size:13px;`;
const PopoutList = styled.div`display:grid;gap:2px;max-height:45dvh;overflow:auto;`;
const PopoutCheck = styled.label`display:flex;align-items:center;gap:10px;min-height:44px;font-size:14px;input{width:18px;height:18px;accent-color:var(--link);}`;
const PopoutActions = styled.div`display:flex;justify-content:flex-end;gap:8px;margin-top:18px;`;
type UndoNotice = { kind: UndoNoticeKind; text: string; document: TodoDocument };
type DeletionFeedback = { kind: 'item-deletion' | 'detail-deletion'; text: string };
type PopoutScope = { kind: 'scratchpad' } | { kind: 'dated'; from: string; to: string } | { kind: 'undated'; lists: string[] };
const readPopoutScope = (): PopoutScope | null => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('popout') === 'scratchpad') return { kind: 'scratchpad' };
  if (params.get('popout') === 'dated') {
    const from = params.get('from') ?? '';
    const to = params.get('to') ?? from;
    if (validDate(from) && validDate(to) && from <= to) return { kind: 'dated', from, to };
  }
  if (params.get('popout') === 'undated') return { kind: 'undated', lists: params.getAll('list') };
  return null;
};
const LEGACY_RAW_DRAFT_KEY = 'shio-pan-raw-draft-v1';
const SAVED_RANGE_KEY = 'shio-pan-journal-range-v1';
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
const weekdayOf = (date: string) => ['sun','mon','tue','wed','thu','fri','sat'][new Date(`${date}T12:00:00Z`).getUTCDay()] as 'mon'|'tue'|'wed'|'thu'|'fri'|'sat'|'sun';
const moveRule = (rule: RecurrenceRule, previous: string, target: string): RecurrenceRule => {
  const delta = Math.round((Date.parse(`${target}T12:00:00Z`) - Date.parse(`${previous}T12:00:00Z`)) / 86400000);
  if (rule.kind === 'after') return rule;
  if (rule.kind === 'scheduled') {
    const pattern = structuredClone(rule.pattern);
    if (pattern.unit === 'weeks') {
      const names = ['mon','tue','wed','thu','fri','sat','sun'] as const;
      pattern.days = pattern.days.map(day => names[(names.indexOf(day) + delta % 7 + 7) % 7]);
    } else if (pattern.unit === 'months') {
      pattern.on = pattern.on.kind === 'weekday' ? { kind: 'weekday', ordinal: pattern.on.ordinal, weekday: weekdayOf(target) } : { kind: 'day', day: Number(target.slice(8)) };
    } else if (pattern.unit === 'years') {
      pattern.on = { kind: 'date', month: Number(target.slice(5,7)), day: Number(target.slice(8)) };
    }
    return { ...rule, pattern, from: shiftDate(rule.from,delta), ...(rule.end?.kind === 'on' ? { end: { kind: 'on' as const, date: shiftDate(rule.end.date,delta) } } : {}) };
  }
  const endsOn = rule.endsOn ? shiftDate(rule.endsOn,delta) : undefined;
  if (rule.kind === 'weekly') {
    const names = ['mon','tue','wed','thu','fri','sat','sun'] as const;
    return { ...rule, days: rule.days.map(day => names[(names.indexOf(day) + delta % 7 + 7) % 7]), endsOn };
  }
  if (rule.kind === 'weekdays') {
    const names = ['mon','tue','wed','thu','fri','sat','sun'] as const;
    return { kind: 'weekly', days: names.slice(0,5).map(day => names[(names.indexOf(day) + delta % 7 + 7) % 7]), series: rule.series, endsOn };
  }
  if (rule.kind === 'monthly') return { ...rule, day: Number(target.slice(8)), endsOn };
  if (rule.kind === 'yearly') return { ...rule, month: Number(target.slice(5,7)), day: Number(target.slice(8)), endsOn };
  return { ...rule, endsOn };
};
const shiftItemSpan = (item: TodoItem, previous: string, target: string) => {
  if (!item.span || previous === target) return;
  const delta = Math.round((Date.parse(`${target}T12:00:00Z`) - Date.parse(`${previous}T12:00:00Z`)) / 86400000);
  if (item.span.kind === 'all-day' && item.span.through) item.span.through = shiftDate(item.span.through,delta);
  if (item.span.kind === 'time') item.span.endDate = shiftDate(item.span.endDate,delta);
};
const shiftSeriesExceptions = (document: TodoDocument, series: string, first: string, previous: string, target: string) => {
  const delta = Math.round((Date.parse(`${target}T12:00:00Z`) - Date.parse(`${previous}T12:00:00Z`)) / 86400000);
  if (!delta) return;
  const master = document.days.flatMap(day => day.items).find(item => item.repeat?.series === series && item.repeat.kind !== 'after');
  if (master?.skips) master.skips = master.skips.map(date => date >= first ? shiftDate(date,delta) : date);
  const moved = document.days.flatMap(day => day.items.filter(item => item.replaces?.series === series && item.replaces.on >= first).map(item => ({ day, item })));
  for (const { day, item } of moved) {
    const newDate = shiftDate(day.date,delta);
    item.replaces!.on = shiftDate(item.replaces!.on,delta);
    shiftItemSpan(item,day.date,newDate);
    day.items.splice(day.items.indexOf(item),1);
    let destination = document.days.find(candidate => candidate.date === newDate);
    if (!destination) { destination = { date: newDate, items: [] }; document.days.push(destination); }
    destination.items.push(item);
  }
};
const detachRecurringOverride = (document: TodoDocument, item: TodoItem) => {
  if (!item.replaces || !item.repeat) return;
  const { series, on } = item.replaces;
  const master = document.days.flatMap(day => day.items).find(candidate => candidate.repeat?.series === series && candidate.repeat.kind !== 'after');
  if (master && !master.skips?.includes(on)) (master.skips ??= []).push(on);
  item.replaces = undefined;
  item.repeat = { ...item.repeat, series: newSeriesId(item.text,on),
    ...(item.repeat.kind === 'after' ? { occurrence: 1 } : {}) };
};
const remainingCount = (rule: RecurrenceRule, start: string, split: string): number | null => {
  if (rule.kind !== 'scheduled' || rule.end?.kind !== 'after') return null;
  let date = start;
  let preceding = 0;
  while (date < split && preceding < rule.end.count) {
    preceding++;
    const next = nextRecurrenceDate(rule,date);
    if (!next || next <= date) break;
    date = next;
  }
  return rule.end.count - preceding;
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
    element.style.viewTransitionName = `shio-pan-item-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
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
const itemSnapshots = (document: TodoDocument) => new Map([
  ...document.days.flatMap(day => day.items.map(item => [item.id, JSON.stringify([day.date, itemValue(item)])] as const)),
  ...(document.undated ?? []).flatMap(list => list.items.map(item => [item.id, JSON.stringify([list.name, itemValue(item)])] as const)),
]);
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

function DateHeading({ date, today, format, highlighted, unfinished, holidays }: { date: string; today: string; format: DateFormat; highlighted: boolean; unfinished: number; holidays: PublicHoliday[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: `date:${date}` });
  const holidayNames = holidays.map(holiday => holiday.name).join(' · ');
  return <DayTitle ref={setNodeRef} $over={isOver || highlighted} $holiday={!!holidays.length} data-drop-date={date} title="Drop a task here to move it to this date">
    <DateBadge dateTime={date}>{formatDateHeading(date,format)}</DateBadge><DayName $hideOnMobile={date !== today && format.includes('weekday')}>{dateLabel(date,today)}</DayName>
    {!!holidays.length && <HolidayBadge title={holidayNames} aria-label={`Public holiday: ${holidayNames}`}><CalendarDays size={12} aria-hidden="true"/><span>{holidayNames}</span></HolidayBadge>}
    {date < today && unfinished > 0 && <DayUnfinished title={`${unfinished} unfinished on this day`} aria-label={`${unfinished} unfinished on this day`}><CircleAlert size={14} aria-hidden="true"/><span className="long-label">{unfinished} unfinished on this day</span><span className="short-label" aria-hidden="true">{unfinished}</span></DayUnfinished>}
  </DayTitle>;
}

function DayItems({ date, items, selected, filterActive, completed, upcoming, previousItem, onChange, onEdit, onDelete, onMove, onMakeDetail, onAddAfter, onMakeUndated, undatedListNames }: {
  date: string; items: TodoItem[]; selected: boolean; filterActive:boolean; completed: TodoItem[]; upcoming: TodoItem[];
  previousItem:(id:string)=>TodoItem|undefined;
  onChange: (id: string, change: (item: TodoItem, items: TodoItem[]) => void) => void;
  onEdit: (id: string, change: (item: TodoItem, items: TodoItem[]) => void) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, target: string) => void;
  onMakeDetail: (id: string, parentId: string) => void;
  onAddAfter: (id: string, text: string) => void;
  onMakeUndated: (id: string, list: string) => void;
  undatedListNames: string[];
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
      {completed.map(item => <Fragment key={item.id}><JournalItem item={item} parentItems={items} previousItem={previousItem(item.id)} date={date} onChange={change => onChange(item.id,change)} onEdit={change => onEdit(item.id,change)} onDelete={() => onDelete(item.id)} onMove={target => onMove(item.id,target)} onMakeDetail={parentId => onMakeDetail(item.id, parentId)} onMakeUndated={list => onMakeUndated(item.id,list)} undatedListNames={undatedListNames} onStartNext={() => setDraftAfterId(item.id)}/>{draftAfterId === item.id && <AddItem inline autoFocus onAdd={text => onAddAfter(item.id,text)} onCancel={() => setDraftAfterId(null)}/>}</Fragment>)}
    </SortableContext></div></CompletedClip>
    <Divider aria-hidden="true"/>
    {(upcoming.length > 0 || selected) && <SectionCaption>upcoming</SectionCaption>}
    <SortableContext items={upcoming.map(item => item.id)} strategy={verticalListSortingStrategy}>
      {upcoming.map(item => <Fragment key={item.id}><JournalItem item={item} parentItems={items} previousItem={previousItem(item.id)} date={date} onChange={change => onChange(item.id,change)} onEdit={change => onEdit(item.id,change)} onDelete={() => onDelete(item.id)} onMove={target => onMove(item.id,target)} onMakeDetail={parentId => onMakeDetail(item.id, parentId)} onMakeUndated={list => onMakeUndated(item.id,list)} undatedListNames={undatedListNames} onStartNext={() => setDraftAfterId(item.id)}/>{draftAfterId === item.id && <AddItem inline autoFocus onAdd={text => onAddAfter(item.id,text)} onCancel={() => setDraftAfterId(null)}/>}</Fragment>)}
    </SortableContext>
  </>;
}

export default function App() {
  useJournalFieldResize();
  const [popout] = useState(readPopoutScope);
  const [state, setState] = useState<TodoState | null>(null);
  const current = useRef<TodoState>(emptyState());
  const previousDocument = useRef<TodoDocument | null>(null);
  const [initialRange] = useState(readSavedRange);
  const [selectedDate, setSelectedDate] = useState(() => popout?.kind === 'dated' ? popout.from : todayString());
  const [dateFormat, setDateFormatState] = useState(getDateFormat);
  const [timeZone, setTimeZoneState] = useState(getTimeZone);
  const [weekStart, setWeekStartState] = useState(getWeekStart);
  const [holidayCountry, setHolidayCountryState] = useState(getHolidayCountry);
  const [holidayMode, setHolidayModeState] = useState<HolidayMode>(getHolidayMode);
  const [holidaysEnabled, setHolidaysEnabledState] = useState(getHolidaysEnabled);
  const [pastUnfinishedScope, setPastUnfinishedScopeState] = useState<PastUnfinishedScope>(getPastUnfinishedScope);
  const [holidayStatus, setHolidayStatus] = useState('');
  const [viewHolidays, setViewHolidays] = useState<Record<string, PublicHoliday[]>>({});
  const viewHolidayCache = useRef<Map<string, Promise<HolidayYear>>>(new Map());
  const holidayImport = useRef<AbortController | null>(null);
  const [viewMode, setViewMode] = useState<'day' | 'range'>(() => popout?.kind === 'dated' && popout.from === popout.to ? 'day' : 'range');
  const [activeTab, setActiveTab] = useState<'dated' | 'undated' | 'scratchpad'>(() => popout?.kind ?? 'dated');
  const [scopePrompt, setScopePrompt] = useState<{ date: string; id: string; label: string } | null>(null);
  const scopedChange = useRef<((item: TodoItem, items: TodoItem[]) => void) | null>(null);
  const scopedMove = useRef<string | null>(null);
  const scopedDelete = useRef(false);
  const [activeRange, setActiveRange] = useState<DateSpan>(() => popout?.kind === 'dated' ? { from: popout.from, to: popout.to } : initialRange ?? weekRange(todayString(), getWeekStart()));
  const [rangeCustomized, setRangeCustomized] = useState(!!initialRange || popout?.kind === 'dated');
  const [expandedEarlierKey, setExpandedEarlierKey] = useState<string | null>(null);
  const journalViewport = useRef<HTMLDivElement>(null);
  const positionedView = useRef<string | null>(null);
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
  const [popoutChooser, setPopoutChooser] = useState<'dated' | 'undated' | null>(null);
  const [popoutFrom, setPopoutFrom] = useState(todayString);
  const [popoutTo, setPopoutTo] = useState(todayString);
  const [popoutLists, setPopoutLists] = useState<string[]>([]);
  const [scratchUndo, setScratchUndo] = useState<ScratchpadUndo | null>(null);
  const [scratchReloadToken, setScratchReloadToken] = useState(0);
  const [review, setReview] = useState<FileReviewState | null>(null);
  const [choices, setChoices] = useState<Record<string, MergeChoice>>({});
  const [rawEdit, setRawEdit] = useState('');
  const [message, setMessage] = useState('');
  const [feedbackNotice, setFeedbackNotice] = useState<UndoNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const undoStack = useRef<TodoDocument[]>([]);
  const redoStack = useRef<TodoDocument[]>([]);
  const journalQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingJournal = useRef(0);
  const journalGeneration = useRef(0);
  const activeHistoryTransition = useRef<{ transition: ViewTransition; rows: Set<HTMLElement> } | null>(null);
  const today = todayString();
  const shownHolidayYears = (viewMode === 'range' ? datesInRange(activeRange) : [selectedDate]).map(date => Number(date.slice(0, 4)));
  const holidayYearsKey = [...new Set(shownHolidayYears)].join(',');
  useEffect(() => {
    if (!holidaysEnabled || holidayMode !== 'view') { setViewHolidays({}); return; }
    let active = true;
    const yearsShown = holidayYearsKey.split(',').filter(Boolean);
    if (!yearsShown.every(year => viewHolidayCache.current.has(`${holidayCountry}:${year}`))) setViewHolidays({});
    const requests = yearsShown.map(year => {
      const key = `${holidayCountry}:${year}`;
      let request = viewHolidayCache.current.get(key);
      if (!request) {
        request = fetchHolidayYear(holidayCountry, Number(year));
        viewHolidayCache.current.set(key, request);
        void request.catch(() => viewHolidayCache.current.delete(key));
      }
      return request;
    });
    void Promise.all(requests)
      .then(years => { if (active) {
        const byDate: Record<string, PublicHoliday[]> = {};
        years.flatMap(result => result.holidays).forEach(holiday => (byDate[holiday.date] ??= []).push(holiday));
        setViewHolidays(byDate);
        setHolidayStatus('');
      } })
      .catch(error => { if (active) setHolidayStatus(`Could not show holidays: ${String(error)}`); });
    return () => { active = false; };
  }, [holidaysEnabled, holidayMode, holidayCountry, holidayYearsKey]);
  const dragSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  useEffect(() => {
    if (popout) return;
    try {
      if (viewMode === 'range' && rangeCustomized) localStorage.setItem(SAVED_RANGE_KEY, JSON.stringify(activeRange));
      else localStorage.removeItem(SAVED_RANGE_KEY);
    } catch { /* The visible range still works for this session. */ }
  }, [viewMode, activeRange, rangeCustomized, popout]);

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
  useEffect(() => {
    let deferred = false;
    const refresh = () => {
      if (pendingJournal.current) return;
      if ((document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLInputElement) && document.activeElement.hasAttribute('data-journal-entry')) { deferred = true; return; }
      deferred = false;
      const generation = journalGeneration.current;
      void loadTodoState().then(latest => {
        if (pendingJournal.current || generation !== journalGeneration.current) return;
        if (latest.revision <= current.current.revision) return;
        current.current = latest;
        undoStack.current = [];
        redoStack.current = [];
        setFeedbackNotice(null);
        setState(latest);
      }).catch(error => setMessage(`Could not refresh journal: ${String(error)}`));
    };
    const onBlur = () => { if (deferred) window.setTimeout(refresh,0); };
    document.addEventListener('focusout',onBlur);
    const unsubscribe = subscribeStore('journal',refresh);
    return () => { document.removeEventListener('focusout',onBlur); unsubscribe(); };
  }, []);
  useEffect(() => { if (state) previousDocument.current = state.document; }, [state?.document]);
  useEffect(() => {
    if (!feedbackNotice) return;
    const timeout = window.setTimeout(() => setFeedbackNotice(null), 6000);
    return () => window.clearTimeout(timeout);
  }, [feedbackNotice]);
  const enqueueJournal = (work: () => Promise<TodoState | null>) => {
    const generation = ++journalGeneration.current;
    pendingJournal.current++;
    const task = journalQueue.current.then(work);
    journalQueue.current = task.then(() => undefined, () => undefined);
    void task.finally(async () => {
      pendingJournal.current--;
      if (pendingJournal.current) return;
      try {
        const latest = await loadTodoState();
        if (pendingJournal.current || generation !== journalGeneration.current) return;
        current.current = latest;
        setState(latest);
      } catch (error) { setMessage(`Could not refresh journal: ${String(error)}`); }
    }).catch(() => undefined);
    return task;
  };
  const persistSnapshot = (next: TodoState, before: TodoState) => enqueueJournal(() => mutateTodoState(latest => {
    if (serializeTodoText(latest.document) !== serializeTodoText(before.document)) throw new Error('The journal changed in another window. Your edit was not saved; reload and try again.');
    return { ...next, revision: latest.revision };
  }));
  const commitState = async (next: TodoState) => {
    const before = current.current;
    const stamped = { ...next, revision: before.revision + 1 };
    current.current = stamped;
    setState(stamped);
    await persistSnapshot(stamped, before);
  };
  const persistEdit = (before: TodoDocument, optimistic: TodoDocument, change: (document: TodoDocument) => void) => enqueueJournal(() => mutateTodoState(latest => {
    if (serializeTodoText(latest.document) === serializeTodoText(before)) return { ...latest, document: optimistic };
    const oldItems = itemSnapshots(before);
    const newItems = itemSnapshots(optimistic);
    const incomingItems = itemSnapshots(latest.document);
    const changedIds = new Set([...oldItems.keys(), ...newItems.keys()].filter(id => oldItems.get(id) !== newItems.get(id)));
    if ([...changedIds].some(id => oldItems.get(id) !== incomingItems.get(id))) throw new Error('The same item changed in another window. Your edit was not saved; reload and try again.');
    const document = cloneDocument(latest.document);
    change(document);
    document.days = document.days.filter(day => day.items.length || day.keepEmpty);
    advanceRecurrences(latest.document, document, todayString());
    validateDocument(document);
    return { ...latest, document };
  }));
  const replayState = (documentData: TodoDocument) => {
    const next = { ...current.current, document: documentData };
    const before = current.current;
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
      void persistSnapshot(stamped,before).catch(error => setMessage(`Could not save: ${String(error)}`));
    } else if (!reduceMotion) {
      const beforeRows = visibleHistoryRows();
      const changed = changedHistoryIds(current.current.document, documentData);
      const stamped = { ...next, revision: Math.max(current.current.revision, next.revision) + 1 };
      current.current = stamped;
      flushSync(() => setState(stamped));
      animateHistoryFallback(beforeRows, changed);
      void persistSnapshot(stamped,before).catch(error => setMessage(`Could not save: ${String(error)}`));
    } else void commitState(next).catch(error => setMessage(`Could not save: ${String(error)}`));
  };
  const commitDocumentState = async (next: TodoState) => {
    if (serializeTodoText(current.current.document) !== serializeTodoText(next.document)) {
      undoStack.current.push(current.current.document);
      if (undoStack.current.length > 100) undoStack.current.shift();
      redoStack.current = [];
    }
    setFeedbackNotice(null);
    await commitState(next);
  };
  const edit = (change: (document: TodoDocument) => void, feedback?: DeletionFeedback) => {
    const before = current.current.document;
    const document = cloneDocument(before);
    change(document);
    document.days = document.days.filter(day => day.items.length || day.keepEmpty);
    advanceRecurrences(before, document, todayString());
    try { validateDocument(document); } catch (error) { setMessage(String(error)); return; }
    if (serializeTodoText(before) === serializeTodoText(document)) return;
    const priorItems = new Map(before.days.flatMap(day => day.items.map(item => [item.id, item] as const)));
    const completed = document.days.flatMap(day => day.items).find(item => item.completed && priorItems.get(item.id)?.completed === false);
    undoStack.current.push(before);
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
    const stamped = { ...current.current, document, revision: current.current.revision + 1 };
    current.current = stamped;
    setState(stamped);
    void persistEdit(before,document,change).catch(error => setMessage(`Could not save: ${String(error)}`));
    setFeedbackNotice(completed ? { kind: 'completion', text: parseTimeBlock(completed.text)?.title ?? completed.text, document } : feedback ? { ...feedback, document } : null);
  };
  const undo = () => { const previous = undoStack.current.pop(); if (!previous) return; setFeedbackNotice(null); redoStack.current.push(current.current.document); replayState(previous); };
  const redo = () => { const next = redoStack.current.pop(); if (!next) return; setFeedbackNotice(null); undoStack.current.push(current.current.document); replayState(next); };
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
    const view = projectItemsForDate(document, date).find(item => item.id === id);
    if (!view) return;
    if (view.projection?.kind === 'series') {
      const destinationDate = view.projection.originalDate;
      let destination = document.days.find(day => day.date === destinationDate);
      if (!destination) { destination = { date: destinationDate, items: [] }; document.days.push(destination); }
      const override = materializeOccurrence(view);
      destination.items.push(override);
      change(override, destination.items);
      detachRecurringOverride(document,override);
      return;
    }
    const source = document.days.find(day => day.items.some(item => item.id === (view.projection?.masterId ?? id)));
    const item = source?.items.find(item => item.id === (view.projection?.masterId ?? id));
    if (source && item) { change(item, source.items); detachRecurringOverride(document,item); }
  });
  const requestScopedEdit = (date: string, id: string, change: (item: TodoItem, items: TodoItem[]) => void) => {
    const view = projectItemsForDate(current.current.document, date).find(item => item.id === id);
    if (!view || (!view.repeat || view.repeat.kind === 'after') && !view.replaces) { mutateItem(date,id,change); return; }
    scopedChange.current = change;
    setScopePrompt({ date, id, label: parseTimeBlock(view.text)?.title ?? view.text });
  };
  const deleteItem = (date: string, id: string) => {
    const view = projectItemsForDate(current.current.document,date).find(item => item.id === id);
    if (!view) return;
    if ((!view.repeat || view.repeat.kind === 'after') && !view.replaces) {
      mutateItem(date,id,(item,items) => { items.splice(items.indexOf(item),1); });
      return;
    }
    scopedDelete.current = true;
    scopedChange.current = () => undefined;
    setScopePrompt({ date, id, label: parseTimeBlock(view.text)?.title ?? view.text });
  };
  const applyScope = (scope: 'this' | 'following' | 'all') => {
    const pending = scopePrompt; const change = scopedChange.current;
    const moveTarget = scopedMove.current;
    const deleting = scopedDelete.current;
    setScopePrompt(null); scopedChange.current = null; scopedMove.current = null; scopedDelete.current = false;
    if (!pending || !change) return;
    const { date, id } = pending;
    const before = current.current.document;
    const view = projectItemsForDate(before,date).find(item => item.id === id);
    if (!view) return;
    const originalDate = view.projection?.originalDate ?? view.replaces?.on ?? date;
    const series = view.projection?.series ?? view.replaces?.series ?? view.repeat?.series;
    if (!series) { mutateItem(date,id,change); return; }
    if (deleting) {
      edit(document => {
        const masterDay = document.days.find(day => day.items.some(item => item.repeat?.series === series && item.repeat.kind !== 'after'));
        const master = masterDay?.items.find(item => item.repeat?.series === series && item.repeat.kind !== 'after');
        if (!master || !masterDay) return;
        if (scope === 'all' || scope === 'following' && originalDate <= masterDay.date) {
          masterDay.items.splice(masterDay.items.indexOf(master),1);
          for (const day of document.days) day.items = day.items.filter(item => item.replaces?.series !== series);
          return;
        }
        if (scope === 'following') {
          const cutoff = shiftDate(originalDate,-1);
          if (master.repeat?.kind === 'scheduled') master.repeat = { ...master.repeat, end: { kind: 'on', date: cutoff } };
          else if (master.repeat) master.repeat = { ...master.repeat, endsOn: cutoff };
          master.skips = master.skips?.filter(value => value < originalDate);
          for (const day of document.days) day.items = day.items.filter(item => !(item.replaces?.series === series && item.replaces.on >= originalDate));
          return;
        }
        if (!master.skips?.includes(originalDate)) (master.skips ??= []).push(originalDate);
        for (const day of document.days) day.items = day.items.filter(item => !(item.replaces?.series === series && item.replaces.on === originalDate));
      });
      return;
    }
    if (scope === 'this') {
      if (moveTarget) {
        edit(document => {
          const currentView = projectItemsForDate(document,date).find(item => item.id === id);
          if (!currentView) return;
          let moved: TodoItem;
          let movedFrom = originalDate;
          if (currentView.replaces) {
            const source = document.days.find(day => day.items.some(item => item.id === id));
            if (!source) return;
            movedFrom = source.date;
            moved = source.items.splice(source.items.findIndex(item => item.id === id),1)[0];
          } else if (currentView.projection?.kind === 'series') moved = materializeOccurrence(currentView);
          else {
            const master = document.days.flatMap(day => day.items).find(item => item.id === id);
            if (!master) return;
            moved = { ...structuredClone(master), id: newId(), repeat: undefined, skips: undefined, replaces: { series, on: originalDate } };
          }
          let destination = document.days.find(day => day.date === moveTarget);
          if (!destination) { destination = { date: moveTarget, items: [] }; document.days.push(destination); }
          shiftItemSpan(moved,movedFrom,moveTarget);
          destination.items.push(moved);
        });
        setSelectedDate(moveTarget); setViewMode('day');
        return;
      }
      if (view.projection?.kind === 'series') { mutateItem(date,id,change); return; }
      if (view.replaces) { mutateItem(date,id,change); return; }
      edit(document => {
        const master = document.days.flatMap(day => day.items).find(item => item.id === id);
        if (!master) return;
        const day = document.days.find(day => day.date === date)!;
        const override: TodoItem = { ...structuredClone(master), id: newId(), repeat: undefined, skips: undefined, replaces: { series, on: originalDate } };
        day.items.push(override); change(override,day.items); detachRecurringOverride(document,override);
      });
      return;
    }
    edit(document => {
      const masterDay = document.days.find(day => day.items.some(item => item.repeat?.series === series && item.repeat.kind !== 'after'));
      const master = masterDay?.items.find(item => item.repeat?.series === series && item.repeat.kind !== 'after');
      if (!master || !masterDay?.date) return;
      if (scope === 'all' || originalDate <= masterDay.date) {
        change(master,masterDay.items);
        if (!master.repeat || master.repeat.kind === 'after') {
          for (const day of document.days) for (const item of day.items) if (item.replaces?.series === series) item.replaces = undefined;
          master.skips = undefined;
        }
        if (moveTarget && master.repeat) {
          const movedDate = shiftDate(masterDay.date,Math.round((Date.parse(`${moveTarget}T12:00:00Z`) - Date.parse(`${originalDate}T12:00:00Z`)) / 86400000));
          shiftSeriesExceptions(document,series,masterDay.date,masterDay.date,movedDate);
          master.repeat = moveRule(master.repeat,masterDay.date,movedDate);
          shiftItemSpan(master,masterDay.date,movedDate);
          masterDay.items.splice(masterDay.items.indexOf(master),1);
          let destination = document.days.find(day => day.date === movedDate);
          if (!destination) { destination = { date: movedDate, items: [] }; document.days.push(destination); }
          destination.items.push(master);
        }
        return;
      }
      const cutoff = shiftDate(originalDate,-1);
      const rule = master.repeat!;
      const oldSkips = master.skips ?? [];
      const newSeries = newSeriesId(master.text,originalDate);
      const count = remainingCount(rule,masterDay.date,originalDate);
      const nextRule: RecurrenceRule = rule.kind === 'scheduled'
        ? { ...structuredClone(rule), from: originalDate, series: newSeries, occurrence: 1,
          ...(count !== null ? { end: { kind: 'after' as const, count } } : {}) }
        : { ...structuredClone(rule), series: newSeries, occurrence: undefined, endsOn: undefined };
      if (rule.kind === 'scheduled') master.repeat = { ...rule, end: { kind: 'on', date: cutoff } };
      else master.repeat = { ...rule, endsOn: cutoff };
      master.skips = oldSkips.filter(value => value < originalDate);
      const next: TodoItem = { ...structuredClone(master), id: newId(), repeat: nextRule, completed: false, completedOn: undefined,
        details: master.details.map(detail => ({ text: detail.text, completed: false })), skips: oldSkips.filter(value => value >= originalDate) };
      shiftItemSpan(next,masterDay.date,originalDate);
      let target = document.days.find(day => day.date === originalDate);
      if (!target) { target = { date: originalDate, items: [] }; document.days.push(target); }
      target.items.push(next);
      for (const day of document.days) for (const item of day.items) if (item.replaces?.series === series && item.replaces.on >= originalDate) item.replaces.series = newSeries;
      change(next,target.items);
      if (!next.repeat || next.repeat.kind === 'after') {
        for (const day of document.days) for (const item of day.items) if (item.replaces?.series === newSeries) item.replaces = undefined;
        next.skips = undefined;
      }
      if (moveTarget && next.repeat) {
        shiftSeriesExceptions(document,newSeries,originalDate,originalDate,moveTarget);
        next.repeat = moveRule(next.repeat,originalDate,moveTarget);
        shiftItemSpan(next,originalDate,moveTarget);
        target.items.splice(target.items.indexOf(next),1);
        let destination = document.days.find(day => day.date === moveTarget);
        if (!destination) { destination = { date: moveTarget, items: [] }; document.days.push(destination); }
        destination.items.push(next);
      }
    });
    if (moveTarget) { setSelectedDate(moveTarget); setViewMode('day'); }
  };
  const dropItem = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const visibleSource = visibleDays.find(day => day.items.some(item => item.id === activeId))?.date;
    const visibleTarget = dateForDrop(overId) ?? visibleDays.find(day => day.items.some(item => item.id === overId))?.date;
    if (visibleSource && visibleTarget && visibleSource !== visibleTarget) { moveItem(visibleSource,activeId,visibleTarget,true); return; }
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
      document.days = document.days.filter(day => day.items.length || day.keepEmpty);
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
  const editUndated = (listName: string, id: string, change: (item: TodoItem, items: TodoItem[]) => void, feedback?: DeletionFeedback) => edit(document => {
    const items = document.undated?.find(list => list.name === listName)?.items;
    const item = items?.find(item => item.id === id);
    if (items && item) change(item,items);
  }, feedback);
  const removeUndated = (listName: string, id: string, detailIndex?: number) => {
    const item = current.current.document.undated?.find(list => list.name === listName)?.items.find(item => item.id === id);
    if (!item) return;
    if (detailIndex === undefined) {
      editUndated(listName,id,(_,items) => { items.splice(items.findIndex(entry => entry.id === id),1); }, { kind: 'item-deletion', text: item.text });
      return;
    }
    const detail = item.details[detailIndex];
    if (!detail) return;
    editUndated(listName,id,item => { item.details.splice(detailIndex,1); }, { kind: 'detail-deletion', text: detail.text });
  };
  const addUndated = (listName: string, text: string) => edit(document => {
    let list = document.undated?.find(list => list.name === listName);
    if (!list) { list = { name: listName, items: [] }; (document.undated ??= []).push(list); }
    list.items.push({ id: newId(), text, details: [], completed: false });
  });
  const addUndatedAfter = (listName: string, id: string, text: string) => edit(document => {
    const items = document.undated?.find(list => list.name === listName)?.items;
    const index = items?.findIndex(item => item.id === id) ?? -1;
    if (items && index >= 0) items.splice(index + 1, 0, { id: newId(), text, details: [], completed: false });
  });
  const dateUndated = (listName: string, id: string, date: string) => {
    edit(document => {
      const list = document.undated?.find(list => list.name === listName);
      const index = list?.items.findIndex(item => item.id === id) ?? -1;
      if (!list || index < 0) return;
      const [item] = list.items.splice(index,1);
      let day = document.days.find(day => day.date === date);
      if (!day) { day = { date, items: [] }; document.days.push(day); }
      day.items.push({ ...item, completed: false, details: item.details.map(detail => ({ ...detail, completed: false })) });
    });
    setActiveTab('dated'); setSelectedDate(date); setViewMode('day');
  };
  const makeUndated = (date: string, id: string, listName: string) => {
    edit(document => {
      const view = projectItemsForDate(document,date).find(item => item.id === id);
      if (!view) return;
      const source = document.days.find(day => day.items.some(item => item.id === (view.projection?.masterId ?? id)));
      const stored = source?.items.find(item => item.id === (view.projection?.masterId ?? id));
      if (!source || !stored) return;
      if (view.replaces) {
        const master = document.days.flatMap(day => day.items).find(item => item.repeat?.series === view.replaces!.series);
        if (master && !master.skips?.includes(view.replaces.on)) (master.skips ??= []).push(view.replaces.on);
        source.items.splice(source.items.indexOf(stored),1);
      } else if (view.repeat?.series && view.repeat.kind !== 'after') {
        const occurrence = view.projection?.originalDate ?? date;
        if (!stored.skips?.includes(occurrence)) (stored.skips ??= []).push(occurrence);
      } else source.items.splice(source.items.indexOf(stored),1);
      let list = document.undated?.find(list => list.name === listName);
      if (!list) { list = { name: listName, items: [] }; (document.undated ??= []).push(list); }
      const copy = { ...structuredClone(view), id: newId(), repeat: undefined, skips: undefined, replaces: undefined, completed: false, completedOn: undefined, span: undefined,
        details: view.details.map(detail => ({ text: detail.text, completed: false })) };
      delete (copy as ViewItem).projection;
      const time = parseTimeBlock(copy.text);
      if (time) { copy.text = time.title; copy.details.unshift({ text: `Time: ${time.start}–${time.end}`, completed: false }); }
      if (view.span) copy.details.unshift({ text: `Span: ${view.span.kind === 'all-day' ? `all-day${view.span.through ? ` through ${view.span.through}` : ''}` : `${view.span.start} to ${view.span.endDate} ${view.span.end}`}`, completed: false });
      list.items.push(copy);
    });
    setActiveTab('undated');
  };
  const makeDetail = (date: string, id: string, parentId: string) => edit(document => {
    const items = document.days.find(day => day.date === date)?.items;
    const index = items?.findIndex(item => item.id === id) ?? -1;
    const parent = items?.find(item => item.id === parentId);
    if (!items || index < 0 || !parent || id === parentId || items[index].repeat || items[index].span || items[index].replaces || parseTimeBlock(items[index].text)) return;
    const [child] = items.splice(index, 1);
    parent.details.push({ text: child.text, completed: child.completed }, ...child.details);
    parent.completed = parent.details.every(detail => detail.completed);
  });
  const moveItem = (date: string, id: string, target: string, keepRange = false) => {
    if (!validDate(target) || target === date) return;
    const candidate = projectItemsForDate(current.current.document,date).find(item => item.id === id);
    if (candidate && ((candidate.repeat && candidate.repeat.kind !== 'after') || candidate.replaces)) {
      scopedMove.current = target;
      scopedChange.current = () => undefined;
      setScopePrompt({ date, id, label: parseTimeBlock(candidate.text)?.title ?? candidate.text });
      return;
    }
    edit(document => {
      const view = projectItemsForDate(document,date).find(item => item.id === id);
      if (!view) return;
      const source = document.days.find(day => day.items.some(item => item.id === (view.projection?.masterId ?? id)));
      const index = source?.items.findIndex(item => item.id === (view.projection?.masterId ?? id)) ?? -1;
      if (!source || index < 0) return;
      const item = view.projection?.kind === 'series' ? materializeOccurrence(view) : source.items.splice(index, 1)[0];
      shiftItemSpan(item,source.date,target);
      let destination = document.days.find(day => day.date === target);
      if (!destination) { destination = { date: target, items: [] }; document.days.push(destination); }
      destination.items.push(item);
      document.days = document.days.filter(day => day.items.length || day.keepEmpty);
      document.days.sort((a,b) => a.date.localeCompare(b.date));
    });
    setSelectedDate(target);
    if (!keepRange) setViewMode('day');
  };
  const imported = async (raw: string, original = raw) => {
    const diagnosis = doctorTodoText(raw);
    if (diagnosis.findings.length) {
      setRawEdit(diagnosis.candidate);
      setReview({ kind: 'doctor', original, checked: diagnosis.candidate, findings: diagnosis.findings });
      return;
    }
    const parsed = parseTodoText(raw);
    if (parsed.issues.length) throw new Error('The TODO.txt doctor found a format issue after review.');
    const proposal = proposeMerge(current.current.document, parsed.document, current.current.baseline);
    if (proposal.conflicts.length) { setChoices({}); setReview({ kind: 'merge', raw, proposal }); return; }
    const merged = resolveMerge(proposal, {});
    advanceRecurrences(current.current.document, merged, todayString(), true, current.current.baseline);
    validateDocument(merged);
    await commitDocumentState({ ...current.current, document: merged, baseline: fileBaseline(proposal) });
    setReview(null);
    setMessage('TODO.txt imported.');
  };
  const importFile = async (file: File) => { setBusy(true); try { await imported(await file.text()); } catch (error) { setMessage(String(error)); } finally { setBusy(false); } };
  const download = async (fileName: string, lineEnding: LineEnding) => {
    const output = serializeTodoText(current.current.document);
    const fileText = lineEnding === 'crlf' ? output.replace(/\n/g, '\r\n') : output;
    downloadTextFile(fileText, fileName);
    setExportOpen(false);
    await commitState({ ...current.current, baseline: cloneDocument(current.current.document) });
    setMessage('TODO.txt downloaded.');
  };
  const applyReview = async () => {
    if (!review) return;
    setBusy(true);
    try {
      if (review.kind === 'doctor') {
        if (rawEdit !== review.checked || review.findings.some(finding => finding.level === 'review')) return;
        await imported(rawEdit, review.original);
        return;
      }
      const merged = resolveMerge(review.proposal, choices);
      advanceRecurrences(current.current.document, merged, todayString(), true, current.current.baseline);
      validateDocument(merged);
      await commitDocumentState({ ...current.current, document: merged, baseline: fileBaseline(review.proposal) });
      setReview(null); setMessage('TODO.txt imported.');
    } catch (error) { setMessage(String(error)); } finally { setBusy(false); }
  };
  const reparse = async () => { const original = review?.kind === 'doctor' ? review.original : rawEdit; setReview(null); try { await imported(rawEdit, original); } catch (error) { setMessage(String(error)); } };
  const doctorAction = (finding: DoctorFinding, action: DoctorAction, value?: string) => {
    if (review?.kind !== 'doctor') return;
    const updated = applyDoctorAction(rawEdit, finding, action, value);
    const diagnosis = doctorTodoText(updated);
    setRawEdit(diagnosis.candidate);
    setReview({ kind: 'doctor', original: review.original, checked: diagnosis.candidate, findings: diagnosis.findings });
  };
  const documentData = state?.document ?? emptyDocument();
  const priorDocument = previousDocument.current;
  const priorItems = new Map(priorDocument?.days.flatMap(day => day.items.map(item => [item.id, item] as const)));
  const draggingItem = draggingId ? [...documentData.days.flatMap(day => day.items), ...datesInRange(activeRange).flatMap(date => projectItemsForDate(documentData,date))].find(item => item.id === draggingId) : null;
  const dateForDrop = (id: string | undefined) => id ? id.startsWith('date:') ? id.slice(5) : documentData.days.find(day => day.items.some(item => item.id === id))?.date ?? null : null;
  const rangeActive = viewMode === 'range';
  const moveDateView = (direction: -1 | 1) => {
    if (rangeActive) {
      const shifted = shiftRange(activeRange, direction * datesInRange(activeRange).length);
      setActiveRange(shifted);
      setRangeCustomized(true);
    } else setSelectedDate(date => shiftDate(date, direction));
  };
  const openPopout = (scope: PopoutScope) => {
    const params = new URLSearchParams();
    params.set('popout', scope.kind);
    if (scope.kind === 'dated') { params.set('from',scope.from); params.set('to',scope.to); }
    if (scope.kind === 'undated') scope.lists.forEach(name => params.append('list',name));
    const url = `${window.location.pathname}?${params}`;
    const opened = window.open(url, '_blank', 'popup=yes,width=600,height=780');
    if (!opened) setMessage('The browser blocked the popout. Allow popups for Shio Pan and try again.');
  };
  const openPopoutChooser = () => {
    if (activeTab === 'scratchpad') { openPopout({ kind: 'scratchpad' }); return; }
    if (activeTab === 'dated') {
      setPopoutFrom(viewMode === 'range' ? activeRange.from : selectedDate);
      setPopoutTo(viewMode === 'range' ? activeRange.to : selectedDate);
      setPopoutChooser('dated');
    } else {
      setPopoutLists((documentData.undated ?? []).map(list => list.name));
      setPopoutChooser('undated');
    }
  };
  const allTags = useMemo(() => [...new Set([...documentData.days.flatMap(day => day.items), ...(documentData.undated ?? []).flatMap(list => list.items)].flatMap(item => [item.text, ...item.details.map(detail => detail.text)].flatMap(tagsIn)))].sort(), [documentData]);
  const unfinishedDates = useMemo(() => ({ has: (date: string) => projectItemsForDate(documentData,date).some(item => !item.completed) }), [documentData]);
  const baseDates = useMemo(() => rangeActive ? datesInRange(activeRange) : [selectedDate], [rangeActive, activeRange, selectedDate]);
  const earlierViewKey = `${viewMode}:${activeRange.from}:${activeRange.to}:${selectedDate}`;
  const globalEarlierDays = useMemo(() => pastUnfinishedScope === 'all' && state ? earlierUnfinishedDays(documentData,today) : [], [pastUnfinishedScope, state?.document, today]);
  const expandedEarlier = pastUnfinishedScope === 'all' && expandedEarlierKey === earlierViewKey && !query && !tag;
  const visibleDays = useMemo(() => {
    const daysByDate = new Map(documentData.days.map(day => [day.date, day] as const));
    const dates = query || tag
      ? [selectedDate, ...[...daysByDate.keys()].filter(date => date !== selectedDate).sort((a,b) => b.localeCompare(a))]
      : expandedEarlier
        ? [...new Set([...globalEarlierDays.map(day => day.date).filter(date => !baseDates.includes(date)), ...baseDates])].sort()
        : baseDates;
    return dates.map(date => ({ date, items: projectItemsForDate(documentData,date) }));
  }, [documentData, selectedDate, query, tag, expandedEarlier, globalEarlierDays, baseDates]);
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
  const visibleEarlier = filteredDays.filter(day => day.date < today && baseDates.includes(day.date) && day.upcoming.length);
  const earlierCount = pastUnfinishedScope === 'all'
    ? globalEarlierDays.reduce((total, day) => total + day.count, 0)
    : visibleEarlier.reduce((total, day) => total + day.upcoming.length, 0);
  const earlierDayCount = pastUnfinishedScope === 'all' ? globalEarlierDays.length : visibleEarlier.length;
  const scrollToJournalDate = (date: string, smooth = false) => {
    const viewport = journalViewport.current;
    const target = [...(viewport?.querySelectorAll<HTMLElement>('[data-journal-date]') ?? [])].find(element => element.dataset.journalDate === date);
    if (!viewport || !target) return;
    const targetTop = viewport.scrollTop + target.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
    viewport.style.paddingBottom = `${Math.max(24, viewport.clientHeight - target.offsetHeight + 12)}px`;
    viewport.scrollTo({ top: targetTop, behavior: smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant' });
  };
  useLayoutEffect(() => {
    if (!state || !journalViewport.current) return;
    const key = `${activeTab}:${earlierViewKey}:${query}:${tag ?? ''}:${expandedEarlier}`;
    if (positionedView.current === key) return;
    positionedView.current = key;
    const viewport = journalViewport.current;
    viewport.style.paddingBottom = activeTab === 'dated' ? '24px' : '0px';
    viewport.scrollTop = 0;
    if (activeTab !== 'dated' || query || tag) return;
    if (expandedEarlier && globalEarlierDays.length) scrollToJournalDate(globalEarlierDays[0].date);
    else if (baseDates.includes(today)) scrollToJournalDate(today);
  }, [state !== null, activeTab, earlierViewKey, query, tag, expandedEarlier, today, baseDates, globalEarlierDays]);
  const hasResults = filteredDays.some(day => day.completed.length + day.upcoming.length > 0);
  if (!state) return <Page $dated><Muted role="status">{message || 'Opening journal…'}</Muted></Page>;
  return <Page $dated={activeTab !== 'undated'}>
    <a href="#journal-content" className="skip-link">Skip to journal</a>
    <VisuallyHidden as="h1">Shio Pan journal and scratchpad</VisuallyHidden>
    <Header $revealed={!!popout || searchOpen || dateOpen}>
    {popout && <HeaderBrand>Shio Pan · {activeTab === 'scratchpad' ? 'Scratchpad' : activeTab === 'dated' ? 'Dated' : 'Undated'}</HeaderBrand>}
    <Toolbar>
      <SearchBox id="journal-search-panel" hidden={!searchOpen}>{searchOpen && <><SearchField ref={searchInput} id="journal-search" type="search" aria-label="Search journal" placeholder="Search the text file" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if(event.key==='Escape') { setSearchOpen(false); setQuery(''); searchButton.current?.focus(); } }}/>
        {query && <ClearSearch aria-label="Clear search" onClick={() => setQuery('')}><X size={15}/></ClearSearch>}</>}</SearchBox>
      {!searchOpen && activeTab === 'dated' && <>
      <Icon aria-label={rangeActive?'Previous range':'Previous day'} onClick={() => moveDateView(-1)}><ChevronLeft size={17}/></Icon>
      <DateControl ref={dateControlRef} $range={rangeActive}>
        <DateText aria-label={rangeActive ? `Viewing ${activeRange.from} to ${activeRange.to}; go to today` : `Go to today from ${selectedDate}`} title="Go to today" onClick={() => { const today = todayString(); setSelectedDate(today); setActiveRange(weekRange(today, weekStart)); setRangeCustomized(false); setViewMode('range'); setDateOpen(false); }}><span className="full">{rangeActive ? `${navDate(activeRange.from)} – ${navDate(activeRange.to)}` : navDate(selectedDate)}</span><span className="compact">{rangeActive ? compactRange(activeRange) : navDate(selectedDate)}</span></DateText>
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
      {activeTab !== 'scratchpad' && <Icon ref={searchButton} aria-label={searchOpen?'Close search':'Open search'} aria-expanded={searchOpen} aria-controls="journal-search-panel" onClick={() => { if (searchOpen) { setSearchOpen(false); setQuery(''); } else { setDateOpen(false); setSearchOpen(true); requestAnimationFrame(() => searchInput.current?.focus()); } }}>{searchOpen?<X size={17}/>:<Search size={17}/>}</Icon>}
      {!popout && activeTab !== 'scratchpad' && <><Icon title="Import TODO.txt" aria-label="Import TODO.txt" onClick={() => importInput.current?.click()}><FileInput size={17}/></Icon>
      <Icon title="Download TODO.txt" aria-label="Download TODO.txt" onClick={() => setExportOpen(true)}><Download size={17}/></Icon></>}
      {!popout && <Icon title="Open view in browser window" aria-label="Open view in browser window" onClick={openPopoutChooser}><PanelsTopLeft size={17}/></Icon>}
      <Icon title="Shio Pan settings" aria-label="Shio Pan settings" onClick={() => { setDateOpen(false); setSettingsOpen(true); }}><Settings2 size={17}/></Icon>
    </Tools>
    </Header>
    <input ref={importInput} type="file" accept=".txt,text/plain" hidden aria-label="Import a TODO.txt file" onChange={event => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = ''; }}/>
    {!popout && <ViewTabs aria-label="Views"><ViewTab $active={activeTab === 'dated'} aria-current={activeTab === 'dated' ? 'page' : undefined} onClick={() => setActiveTab('dated')}>Dated</ViewTab><ViewTab $active={activeTab === 'undated'} aria-current={activeTab === 'undated' ? 'page' : undefined} onClick={() => setActiveTab('undated')}>Undated</ViewTab><ViewTab $active={activeTab === 'scratchpad'} aria-current={activeTab === 'scratchpad' ? 'page' : undefined} onClick={() => { setTag(null); setQuery(''); setSearchOpen(false); setActiveTab('scratchpad'); }}><NotebookPen size={15} style={{verticalAlign:'-2px',marginRight:5}}/>Scratchpad</ViewTab></ViewTabs>}
    {activeTab === 'dated' && holidaysEnabled && holidayMode === 'view' && holidayStatus.startsWith('Could not show holidays') && <HolidayLoadError role="status">Public holidays could not load. Check Settings for details.</HolidayLoadError>}
    {activeTab !== 'scratchpad' && !!allTags.length && <TagRail $bounded={activeTab === 'dated'} aria-label="Tags"><TagPill $active={!tag} onClick={() => setTag(null)}>all</TagPill>{allTags.map(name => <TagPill key={name} $active={tag === name} onClick={() => setTag(tag === name ? null : name)}>#{name}</TagPill>)}</TagRail>}
    {legacyRawDraft !== null && <Notice role="status">An unfinished TODO.txt draft from the old editor is available. <Button type="button" onClick={() => {
      downloadTextFile(legacyRawDraft, 'TODO-draft.txt');
      setLegacyRawDraft(null);
      try { sessionStorage.removeItem(LEGACY_RAW_DRAFT_KEY); } catch { /* The downloaded copy remains available. */ }
    }}>download draft</Button><Dismiss aria-label="Dismiss draft notice" onClick={() => setLegacyRawDraft(null)}>×</Dismiss></Notice>}
    {message && <Notice role="status">{message} <Dismiss aria-label="Dismiss message" onClick={() => setMessage('')}>×</Dismiss></Notice>}
    {scratchUndo && <Notice role="status">Scratchpad text became journal items. <Button onClick={() => { void undoScratchpadConversion(scratchUndo).then(({ journal }) => { current.current = journal; setState(journal); setScratchReloadToken(value => value + 1); setScratchUndo(null); setMessage('Conversion undone.'); }).catch(error => { setScratchUndo(null); setMessage(String(error)); }); }}>Undo</Button><Dismiss aria-label="Dismiss conversion undo" onClick={() => setScratchUndo(null)}>×</Dismiss></Notice>}
    <UndoFeedback notice={feedbackNotice} onDismiss={() => setFeedbackNotice(null)} onUndo={() => {
      if (feedbackNotice && current.current.document === feedbackNotice.document) undo();
      else setFeedbackNotice(null);
    }}/>
    {activeTab === 'dated' && !query && !tag && earlierCount > 0 && <EarlierLink type="button" aria-expanded={pastUnfinishedScope === 'all' ? expandedEarlier : undefined} onClick={() => {
      if (pastUnfinishedScope === 'all') {
        if (expandedEarlier) setExpandedEarlierKey(null);
        else setExpandedEarlierKey(earlierViewKey);
      } else if (visibleEarlier.length) scrollToJournalDate(visibleEarlier[0].date,true);
    }}><CircleAlert size={14} aria-hidden="true"/>{earlierCount} unfinished from earlier {earlierDayCount === 1 ? 'day' : 'days'}{expandedEarlier ? ' · show current range' : ''}</EarlierLink>}
    <JournalViewport id="journal-content" ref={journalViewport} $dated={activeTab !== 'undated'} tabIndex={-1} role="region" aria-label={activeTab === 'scratchpad' ? 'Scratchpad' : activeTab === 'dated' ? 'Dated journal' : 'Undated journal'}>
    {activeTab === 'scratchpad' ? <ScratchpadView listNames={(documentData.undated ?? []).map(list => list.name)} today={today} reloadToken={scratchReloadToken} beforeConvert={() => journalQueue.current} onJournalCommitted={(journal, undo) => {
      current.current = journal;
      setState(journal);
      undoStack.current = [];
      redoStack.current = [];
      setScratchUndo(undo);
    }}/>
    : activeTab === 'undated' ? <UndatedView lists={documentData.undated} visibleNames={popout?.kind === 'undated' ? popout.lists : undefined} query={query} tag={tag}
      onAddList={name => edit(document => { if (!(document.undated ?? []).some(list => list.name === name)) (document.undated ??= []).push({ name, items: [] }); })}
      onDeleteList={name => edit(document => { document.undated = (document.undated ?? []).filter(list => list.name !== name); })}
      onAdd={addUndated}
      onAddAfter={addUndatedAfter}
      onReorderItems={(list,fromId,toId) => edit(document => {
        const items = document.undated?.find(entry => entry.name === list)?.items;
        if (!items) return;
        const from = items.findIndex(item => item.id === fromId);
        const to = items.findIndex(item => item.id === toId);
        if (from >= 0 && to >= 0) items.splice(0,items.length,...arrayMove(items,from,to));
      })}
      onEdit={(list,id,text) => editUndated(list,id,item => { item.text = text; })}
      onAddDetail={(list,id,text) => editUndated(list,id,item => { item.details.push({ text, completed: false }); })}
      onEditDetail={(list,id,index,text) => editUndated(list,id,item => { item.details[index].text = text; })}
      onDeleteDetail={(list,id,index) => removeUndated(list,id,index)}
      onReorderDetails={(list,id,from,to) => editUndated(list,id,item => { item.details = arrayMove(item.details,from,to); })}
      onMakeDetail={(sourceList,id,parentList,parentId) => edit(document => {
        const source = document.undated?.find(list => list.name === sourceList);
        const target = document.undated?.find(list => list.name === parentList);
        const sourceIndex = source?.items.findIndex(item => item.id === id) ?? -1;
        const parent = target?.items.find(item => item.id === parentId);
        if (!source || !target || sourceIndex < 0 || !parent || id === parentId) return;
        const [moved] = source.items.splice(sourceIndex,1);
        parent.details.push({ text: moved.text, completed: false }, ...moved.details.map(detail => ({ text: detail.text, completed: false })));
      })}
      onMakeItem={(list,id,index) => editUndated(list,id,(item,items) => {
        if (index < 0 || index >= item.details.length) return;
        const [detail] = item.details.splice(index,1);
        items.splice(items.indexOf(item)+1,0,{ id: newId(), text: detail.text, details: [], completed: false });
      })}
      onDate={dateUndated}
      onDelete={(list,id) => removeUndated(list,id)}/>
    : <>
    {(query || tag) && !hasResults && <EmptyResults role="status">No lines match this search</EmptyResults>}
    <DndContext sensors={dragSensors} collisionDetection={taskCollisionDetection}
      onDragStart={({ active }) => { setDraggingId(String(active.id)); setDragOverDate(null); }}
      onDragOver={({ over }) => setDragOverDate(dateForDrop(over ? String(over.id) : undefined))}
      onDragCancel={() => { setDraggingId(null); setDragOverDate(null); }}
      onDragEnd={event => { dropItem(event); setDraggingId(null); setDragOverDate(null); }}>
    {filteredDays.map(day => {
      const { completed, upcoming } = day;
      if ((query || tag) && !completed.length && !upcoming.length) return null;
      return <DaySection key={`${day.date}:${day.date===selectedDate?'selected':'other'}`} $selected={day.date===selectedDate} data-journal-date={day.date} aria-label={`${dateLabel(day.date,today)}, ${day.date}`}>
        <DateHeading date={day.date} today={today} format={dateFormat} highlighted={!!draggingId && dragOverDate === day.date} unfinished={upcoming.length} holidays={holidaysEnabled && holidayMode === 'view' ? viewHolidays[day.date] ?? [] : []}/>
        {day.items.length === 0 && !query && !tag ? <AddItem label={day.date === selectedDate ? 'New daily item' : `New item for ${day.date}`} onAdd={text => addItem(day.date,text)}/> : <>
        <DayItems date={day.date} items={day.items} selected={day.date === selectedDate} filterActive={!!(query||tag)} completed={completed} upcoming={upcoming} previousItem={id=>priorItems.get(id)} onChange={(id,change) => mutateItem(day.date,id,change)} onEdit={(id,change) => requestScopedEdit(day.date,id,change)} onDelete={id => deleteItem(day.date,id)} onMove={(id,target) => moveItem(day.date,id,target)} onMakeDetail={(id,parentId) => makeDetail(day.date,id,parentId)} onMakeUndated={(id,list) => makeUndated(day.date,id,list)} undatedListNames={(documentData.undated ?? []).map(list => list.name)} onAddAfter={(id,text) => addItemAfter(day.date,id,text)}/>
        </>}
      </DaySection>;
    })}
    {createPortal(<DragOverlay dropAnimation={null} modifiers={[restrictToWindowEdges]} style={{ width: 'min(360px, calc(100vw - 32px))' }} zIndex={40}>{draggingItem && <DragPreview aria-label={`Dragging ${draggingItem.text}`}><PreviewCircle $done={draggingItem.completed}/><PreviewText $done={draggingItem.completed}>{draggingItem.text}</PreviewText></DragPreview>}</DragOverlay>, window.document.body)}
    </DndContext>
    </>}
    </JournalViewport>
    <Modal open={!!scopePrompt} onClose={() => { setScopePrompt(null); scopedChange.current = null; scopedMove.current = null; scopedDelete.current = false; }} title="Choose recurring edit scope" compact>
      <ScopeTitle>Change “{scopePrompt?.label}”</ScopeTitle><ScopeHint>Choose which occurrences this change applies to.</ScopeHint>
      <ScopeOption onClick={() => applyScope('this')}>This item</ScopeOption>
      <ScopeOption onClick={() => applyScope('following')}>This and following items</ScopeOption>
      <ScopeOption onClick={() => applyScope('all')}>All items</ScopeOption>
    </Modal>
    <Modal open={popoutChooser !== null} onClose={() => setPopoutChooser(null)} title={popoutChooser === 'dated' ? 'Open dated window' : 'Open undated window'} compact>
      {popoutChooser === 'dated' ? <>
        <ScopeHint>Choose any day or date range for this window.</ScopeHint>
        <PopoutField>From<Field aria-label="Popout start date" type="date" value={popoutFrom} onChange={event => setPopoutFrom(event.target.value)}/></PopoutField>
        <PopoutField>To<Field aria-label="Popout end date" type="date" value={popoutTo} onChange={event => setPopoutTo(event.target.value)}/></PopoutField>
      </> : <><ScopeHint>Choose the lists to show in this window.</ScopeHint><PopoutList>{(documentData.undated?.length ? documentData.undated : [{ name: 'Inbox', items: [] }]).map(list => <PopoutCheck key={list.name}><input type="checkbox" checked={popoutLists.includes(list.name)} onChange={event => setPopoutLists(previous => event.target.checked ? [...previous,list.name] : previous.filter(name => name !== list.name))}/>{list.name}</PopoutCheck>)}</PopoutList></>}
      <PopoutActions><Button onClick={() => setPopoutChooser(null)}>Cancel</Button><Button $primary disabled={popoutChooser === 'dated' ? !validDate(popoutFrom) || !validDate(popoutTo) || popoutFrom > popoutTo : !popoutLists.length} onClick={() => {
        if (popoutChooser === 'dated') openPopout({ kind: 'dated', from: popoutFrom, to: popoutTo });
        else if (popoutChooser === 'undated') openPopout({ kind: 'undated', lists: popoutLists });
        setPopoutChooser(null);
      }}>Open window</Button></PopoutActions>
    </Modal>
    <ExportPreview open={exportOpen} text={exportOpen ? serializeTodoText(state.document) : ''} onClose={() => setExportOpen(false)} onDownload={(fileName, lineEnding) => { void download(fileName, lineEnding).catch(error => setMessage(`Could not download: ${String(error)}`)); }}/>
    <AppearanceSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} dateFormat={dateFormat} onDateFormatChange={value => { setDateFormat(value); setDateFormatState(value); }}
      timeZone={timeZone} onTimeZoneChange={value => { const wasToday = selectedDate === today; setTimeZone(value); setTimeZoneState(value); if (wasToday) setSelectedDate(todayString()); if (!rangeCustomized) setActiveRange(weekRange(todayString(), weekStart)); }}
      weekStart={weekStart} onWeekStartChange={value => {
        setWeekStart(value); setWeekStartState(value);
        if (!rangeCustomized) setActiveRange(weekRange(selectedDate, value));
        else if (datesInRange(activeRange).length === 7 && activeRange.from === weekRange(activeRange.from, weekStart).from)
          setActiveRange(weekRange(shiftDate(activeRange.from, 3), value));
      }}
      pastUnfinishedScope={pastUnfinishedScope} onPastUnfinishedScopeChange={value => { setPastUnfinishedScope(value); setPastUnfinishedScopeState(value); setExpandedEarlierKey(null); }}
      holidaysEnabled={holidaysEnabled} onHolidaysEnabledChange={value => { if (!value) holidayImport.current?.abort(); setHolidaysEnabled(value); setHolidaysEnabledState(value); setHolidayStatus(''); }}
      holidayMode={holidayMode} onHolidayModeChange={value => { if (value !== 'saved') holidayImport.current?.abort(); setHolidayMode(value); setHolidayModeState(value); setHolidayStatus(''); }}
      holidayCountry={holidayCountry} onHolidayCountryChange={value => { holidayImport.current?.abort(); setHolidayCountry(value); setHolidayCountryState(value); setViewHolidays({}); setHolidayStatus(''); }}
      holidayStatus={holidayStatus} onImportHolidays={(country, year) => { holidayImport.current?.abort(); const controller = new AbortController(); holidayImport.current = controller; setHolidayStatus(`Loading ${year} holidays…`); void fetchHolidayYear(country, year, controller.signal).then(({ holidays, source }) => {
        if (controller.signal.aborted) return;
        let added = 0;
        edit(document => { added = addSavedHolidays(document, holidays, todayString(), newId); });
        setHolidayStatus(`${added} ${added === 1 ? 'holiday' : 'holidays'} added from ${source}${holidays.length > added ? `; ${holidays.length - added} already present` : ''}.`);
      }).catch(error => { if (!controller.signal.aborted) setHolidayStatus(`Could not add holidays: ${String(error)}`); }).finally(() => { if (holidayImport.current === controller) holidayImport.current = null; }); }}/>
    <FileReview review={review} rawEdit={rawEdit} choices={choices} busy={busy}
      onClose={() => setReview(null)} onRawEdit={setRawEdit}
      onChoice={(key, choice) => setChoices(previous => ({ ...previous, [key]: choice }))}
      onReparse={() => void reparse()} onApply={() => void applyReview()} onDoctorAction={doctorAction}/>
  </Page>;
}
