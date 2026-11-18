import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import styled from 'styled-components';
import { Check, Plus, Repeat2 } from 'lucide-react';
import { calendarClock, type CalendarDay, type CalendarEntry, type CalendarMode } from '../calendar';
import { Button } from '../styles';

const Month = styled.div`min-width:0;`;
const Weekdays = styled.div`display:grid;grid-template-columns:repeat(7,minmax(0,1fr));padding-bottom:8px;color:var(--muted);font-size:12px;text-align:center;`;
const Grid = styled.div`display:grid;grid-template-columns:repeat(7,minmax(0,1fr));border-top:1px solid var(--line);border-left:1px solid var(--line);[role=row]{display:contents;}`;
const Cell = styled.div<{ $outside?: boolean }>`min-width:0;min-height:142px;padding:4px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);color:${({ $outside }) => $outside ? 'var(--muted)' : 'var(--ink)'};&:focus-within{background:var(--soft);}@media(max-width:600px){padding:2px;min-height:112px;}`;
const DateButton = styled.button<{ $today?: boolean }>`display:block;min-width:36px;min-height:36px;margin:0 0 3px;padding:4px 7px;border:0;border-radius:6px;background:${({ $today }) => $today ? 'var(--date-bg)' : 'transparent'};color:inherit;font:inherit;font-size:13px;font-weight:${({ $today }) => $today ? 600 : 400};&:hover{background:var(--soft);}@media(pointer:coarse){min-width:44px;min-height:44px;}`;
const EntryButton = styled.button<{ $compact?: boolean; $done?: boolean }>`display:flex;align-items:center;gap:5px;width:100%;min-width:0;min-height:${({ $compact }) => $compact ? '30px' : '40px'};padding:5px;border:0;border-radius:4px;background:transparent;color:${({ $done }) => $done ? 'var(--muted)' : 'inherit'};font:inherit;font-size:${({ $compact }) => $compact ? '12px' : '13px'};text-align:left;&:hover,&:focus-visible{background:var(--soft);}span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}small{display:block;color:var(--muted);font-size:11px;text-decoration:none;}@media(pointer:coarse){min-height:44px;}`;
const EntryText = styled.span`display:block;flex:1;`;
const More = styled.button`min-height:32px;max-width:100%;padding:3px 5px;border:0;border-radius:4px;background:transparent;color:var(--link);font:inherit;font-size:12px;text-align:left;&:hover{background:var(--soft);}@media(pointer:coarse){min-height:44px;}`;
const Columns = styled.div<{ $week: boolean }>`display:grid;grid-template-columns:${({ $week }) => $week ? 'repeat(7,minmax(142px,1fr))' : 'minmax(0,1fr)'};min-width:${({ $week }) => $week ? '994px' : '0'};`;
const Scroll = styled.div`max-height:calc(100dvh - 225px);min-height:260px;overflow:auto;overscroll-behavior:contain;border-top:1px solid var(--line);`;
const Column = styled.section`min-width:0;padding:0 9px 16px;border-right:1px solid var(--line);&:last-child{border-right:0;}`;
const ColumnHeader = styled.div`position:sticky;top:0;z-index:1;padding:8px 0;background:var(--paper);`;
const Caption = styled.h3`margin:15px 4px 6px;color:var(--muted);font-size:12px;font-weight:400;`;
const EntryRow = styled.div`display:flex;align-items:flex-start;min-width:0;label{display:inline-flex;align-items:center;justify-content:center;min-width:30px;min-height:40px;}input{accent-color:var(--link);}@media(pointer:coarse){label{min-width:44px;min-height:44px;}}`;
const Empty = styled.p`padding:12px 4px;color:var(--muted);font-size:13px;`;
const Actions = styled.div`display:flex;align-items:center;gap:8px;margin:0 0 12px;button{display:inline-flex;align-items:center;gap:6px;}`;
const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function timing(entry: CalendarEntry): string {
  const clock = entry.kind === 'timed' ? `${calendarClock(entry.start!)}–${calendarClock(entry.end!)}` : entry.kind === 'all-day' ? 'All day' : 'Untimed';
  return `${entry.continuation ? 'Continues · ' : ''}${clock}${entry.continues ? ' · continues' : ''}`;
}

export function CalendarView({ days, mode, selectedDate, today, weekStart, onShowDay, onOpenDocument, onOpenEntry, onToggle }: { days: CalendarDay[]; mode: CalendarMode; selectedDate: string; today: string; weekStart: number; onShowDay: (date: string) => void; onOpenDocument: (date: string, compose?: boolean) => void; onOpenEntry: (date: string, entry: CalendarEntry) => void; onToggle: (date: string, entry: CalendarEntry) => void }) {
  const [focused, setFocused] = useState(selectedDate), grid = useRef<HTMLDivElement>(null);
  useEffect(() => setFocused(selectedDate), [selectedDate, mode]);
  const active = days.some(day => day.date === focused) ? focused : days.some(day => day.date === selectedDate) ? selectedDate : days[0]?.date;
  const entryButton = (entry: CalendarEntry, date: string, compact = false) => <EntryButton key={entry.item.id} type="button" $compact={compact} $done={entry.item.completed} tabIndex={compact && date !== active ? -1 : 0} aria-label={`Open ${entry.title} on ${date}`} aria-description={`${timing(entry)}${entry.item.kind === 'note' ? '' : entry.item.completed ? ', completed task' : ', open task'}`} onClick={() => onOpenEntry(date, entry)}>
    {compact && entry.item.completed && <Check size={12} aria-hidden="true"/>}<EntryText>{entry.title}{(compact || entry.kind === 'timed' || entry.continuation || entry.continues) && <small>{timing(entry)}</small>}</EntryText>{entry.item.repeat && <Repeat2 size={12} aria-label="Repeats"/>}
  </EntryButton>;
  const row = (entry: CalendarEntry, date: string) => <EntryRow key={entry.item.id}>{entry.item.kind !== 'note' && <label><input type="checkbox" checked={entry.item.completed} aria-label={`${entry.item.completed ? 'Reopen' : 'Complete'} ${entry.title} on ${date}`} onChange={() => onToggle(date, entry)}/></label>}{entryButton(entry, date)}</EntryRow>;
  if (mode !== 'month') return <Scroll aria-label={`${mode === 'day' ? 'Day' : 'Week'} calendar`}><Columns $week={mode === 'week'}>{days.map(day => <Column key={day.date} aria-label={`Calendar for ${day.date}`}>
    <ColumnHeader><DateButton $today={day.date === today} onClick={() => mode === 'day' ? onOpenDocument(day.date) : onShowDay(day.date)} aria-label={mode === 'day' ? `Open document for ${day.date}` : `Show day ${day.date}`}>{dateLabel(day.date)}</DateButton><More onClick={() => onOpenDocument(day.date)}>Open writing</More></ColumnHeader>
    {!!day.allDay.length && <><Caption>All day</Caption>{day.allDay.map(entry => row(entry, day.date))}</>}
    {!!day.untimed.length && <><Caption>Untimed</Caption>{day.untimed.map(entry => row(entry, day.date))}</>}
    {day.timed.map((group, index) => <div key={index}>{group.entries.length > 1 && <Caption>Overlapping times</Caption>}{group.entries.map(entry => row(entry, day.date))}</div>)}
    {!day.entries.length && <Empty>No scheduled entries.</Empty>}
    <More onClick={() => onOpenDocument(day.date, true)} aria-label={`Add writing to ${day.date}`}><Plus size={13} aria-hidden="true"/> Add writing</More>
  </Column>)}</Columns></Scroll>;
  const offset = days.length ? (new Date(`${days[0].date}T12:00:00Z`).getUTCDay() - weekStart + 7) % 7 : 0;
  const cells: Array<CalendarDay | null> = [...Array(offset).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  const keydown = (event: KeyboardEvent<HTMLButtonElement>, date: string) => {
    if (event.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const index = days.findIndex(day => day.date === date), position = index + offset, rowStart = Math.max(0, Math.floor(position / 7) * 7 - offset), rowEnd = Math.min(days.length - 1, Math.floor(position / 7) * 7 + 6 - offset);
    const next = event.key === 'Home' ? event.ctrlKey || event.metaKey ? 0 : rowStart : event.key === 'End' ? event.ctrlKey || event.metaKey ? days.length - 1 : rowEnd : event.key === 'ArrowLeft' ? Math.max(0, index - 1) : event.key === 'ArrowRight' ? Math.min(days.length - 1, index + 1) : event.key === 'ArrowUp' ? Math.max(0, index - 7) : Math.min(days.length - 1, index + 7);
    event.preventDefault();
    const target = days[next]?.date;
    if (target) { setFocused(target); grid.current?.querySelector<HTMLButtonElement>(`[data-calendar-date="${target}"]`)?.focus(); }
  };
  return <Month><Actions><Button type="button" onClick={() => active && onOpenDocument(active, true)}><Plus size={14} aria-hidden="true"/>Add writing</Button></Actions>
    <Weekdays aria-hidden="true">{Array.from({ length: 7 }, (_, index) => <span key={index}>{weekdayLabels[(weekStart + index) % 7]}</span>)}</Weekdays>
    <Grid ref={grid} role="grid" aria-label="Month calendar" aria-colcount={7} aria-rowcount={cells.length / 7}>{Array.from({ length: cells.length / 7 }, (_, week) => <div role="row" key={week}>{cells.slice(week * 7, week * 7 + 7).map((day, column) => day ? <Cell role="gridcell" key={day.date} aria-label={day.date} aria-selected={day.date === active} $outside={day.date.slice(0, 7) !== selectedDate.slice(0, 7)}>
      <DateButton data-calendar-date={day.date} $today={day.date === today} aria-current={day.date === today ? 'date' : undefined} aria-label={`Show day ${day.date}`} tabIndex={day.date === active ? 0 : -1} onFocus={() => setFocused(day.date)} onKeyDown={event => keydown(event, day.date)} onClick={() => onShowDay(day.date)}>{Number(day.date.slice(8))}</DateButton>
      {day.entries.slice(0, 3).map(entry => entryButton(entry, day.date, true))}
      {day.entries.length > 3 && <More tabIndex={day.date === active ? 0 : -1} onClick={() => onShowDay(day.date)} aria-label={`Show all ${day.entries.length} entries on ${day.date}`}>+{day.entries.length - 3} more</More>}
    </Cell> : <Cell role="gridcell" key={`empty-${column}`} aria-hidden="true"/>)}</div>)}</Grid>
  </Month>;
}
