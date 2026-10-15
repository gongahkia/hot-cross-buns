import { useState } from 'react';
import styled from 'styled-components';
import { Button } from '../styles';
import { formatRecurrence, newSeriesId, parseRecurrence, type Ordinal, type RecurrenceRule, type ScheduleEnd, type ScheduledPattern, type Weekday } from '../recurrence';
import { parseTimeBlock, setTimeBlock, validTime } from '../timeBlock';
import { validDate, type TodoItem } from '../todoText';
import { CalendarDateField } from './CalendarDateField';
import { Modal } from './Modal';

const Heading = styled.h2`font-size: 18px; margin: 2px 4px 16px;`;
const Form = styled.form`display: grid; gap: 13px; padding: 4px;`;
const Label = styled.label`display: grid; gap: 5px; font-size: 13px;`;
const Input = styled.input`min-height: 44px; width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 7px; background: var(--field); color: var(--ink);`;
const Select = styled.select`min-height: 44px; width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 7px; background: var(--field); color: var(--ink);`;
const Days = styled.div`display: flex; flex-wrap: wrap; gap: 5px;`;
const Day = styled.label`display: inline-flex; align-items: center; gap: 4px; min-height: 40px; padding: 5px 7px; border: 1px solid var(--line); border-radius: 6px; font-size: 12px; &:has(input:checked) { border-color: var(--link); color: var(--link); background: var(--date-bg); } @media(pointer:coarse){min-height:44px;}`;
const Inline = styled.div`display: flex; gap: 9px; align-items: end; > * { flex: 1; min-width: 0; } @media(max-width:500px){flex-wrap:wrap;}`;
const EndOption = styled.label`display:flex; align-items:center; gap:8px; min-height:40px; cursor:pointer; @media(pointer:coarse){min-height:44px;}`;
const EndDateField = styled.div`margin-left: 22px;`;
const Actions = styled.div`display: flex; justify-content: flex-end; gap: 7px; margin-top: 4px;`;
const Error = styled.p`font-size: 12px; color: var(--danger);`;
const weekdayNames = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const ordinalNames = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', '-1': 'last' } as const;
const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
type EditorKind = 'time' | 'repeat';
type RepeatMode = 'none' | 'daily' | 'weekly' | 'monthlyWeekday' | 'yearly' | 'weekdays' | 'custom' | 'after';
type Unit = 'days' | 'weeks' | 'months' | 'years';

export function ScheduleEditor({ kind, item, date, onClose, onTime, onRepeat }: {
  kind: EditorKind; item: TodoItem; date: string; onClose: () => void;
  onTime: (text: string) => void; onRepeat: (rule: RecurrenceRule | undefined) => void;
}) {
  const block = parseTimeBlock(item.text);
  const scheduled = item.repeat?.kind === 'scheduled' ? item.repeat : null;
  const dayNumber = Number(date.slice(8, 10));
  const monthNumber = Number(date.slice(5, 7));
  const weekday = weekdayNames[(new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7];
  const ordinal = Math.ceil(dayNumber / 7) as Ordinal;
  const [start, setStart] = useState(block?.start ?? '09:00');
  const [end, setEnd] = useState(block?.end ?? '10:00');
  const [mode, setMode] = useState<RepeatMode>(() => {
    if (!item.repeat) return 'none';
    if (item.repeat.kind === 'scheduled' || item.repeat.kind === 'weekly' || item.repeat.kind === 'monthly' || item.repeat.kind === 'yearly') return 'custom';
    if (item.repeat.kind === 'after') return 'after';
    return item.repeat.kind;
  });
  const [every, setEvery] = useState(scheduled?.every ?? 1);
  const [unit, setUnit] = useState<Unit>(scheduled?.pattern.unit ?? (item.repeat?.kind === 'weekly' ? 'weeks' : item.repeat?.kind === 'monthly' ? 'months' : item.repeat?.kind === 'yearly' ? 'years' : 'weeks'));
  const [anchor, setAnchor] = useState(scheduled?.from ?? date);
  const [weeklyDays, setWeeklyDays] = useState<Weekday[]>(scheduled?.pattern.unit === 'weeks' ? scheduled.pattern.days : item.repeat?.kind === 'weekly' ? item.repeat.days : [weekday]);
  const [monthOn, setMonthOn] = useState<'day' | 'weekday'>(scheduled?.pattern.unit === 'months' ? scheduled.pattern.on.kind : 'day');
  const [monthDay, setMonthDay] = useState(scheduled?.pattern.unit === 'months' && scheduled.pattern.on.kind === 'day' ? scheduled.pattern.on.day : item.repeat?.kind === 'monthly' ? item.repeat.day : dayNumber);
  const [repeatOrdinal, setRepeatOrdinal] = useState<Ordinal>(scheduled?.pattern.unit === 'months' && scheduled.pattern.on.kind === 'weekday' ? scheduled.pattern.on.ordinal : scheduled?.pattern.unit === 'years' && scheduled.pattern.on.kind === 'weekday' ? scheduled.pattern.on.ordinal : ordinal);
  const [patternWeekday, setPatternWeekday] = useState<Weekday>(scheduled?.pattern.unit === 'months' && scheduled.pattern.on.kind === 'weekday' ? scheduled.pattern.on.weekday : scheduled?.pattern.unit === 'years' && scheduled.pattern.on.kind === 'weekday' ? scheduled.pattern.on.weekday : weekday);
  const [yearOn, setYearOn] = useState<'date' | 'weekday'>(scheduled?.pattern.unit === 'years' ? scheduled.pattern.on.kind : 'date');
  const [yearlyMonth, setYearlyMonth] = useState(scheduled?.pattern.unit === 'years' ? scheduled.pattern.on.month : item.repeat?.kind === 'yearly' ? item.repeat.month : monthNumber);
  const [yearlyDay, setYearlyDay] = useState(scheduled?.pattern.unit === 'years' && scheduled.pattern.on.kind === 'date' ? scheduled.pattern.on.day : item.repeat?.kind === 'yearly' ? item.repeat.day : dayNumber);
  const [endMode, setEndMode] = useState<'never' | 'on' | 'after'>(scheduled?.end?.kind ?? 'never');
  const [endDate, setEndDate] = useState(scheduled?.end?.kind === 'on' ? scheduled.end.date : new Date(Date.parse(date + 'T12:00:00Z') + 30 * 86400000).toISOString().slice(0, 10));
  const [endCount, setEndCount] = useState(scheduled?.end?.kind === 'after' ? scheduled.end.count : 10);
  const [afterEvery, setAfterEvery] = useState(item.repeat?.kind === 'after' ? item.repeat.every : 1);
  const [afterUnit, setAfterUnit] = useState<Unit>(item.repeat?.kind === 'after' ? item.repeat.unit : 'days');
  const [error, setError] = useState('');

  const save = () => {
    if (kind === 'time') {
      if (!validTime(start) || !validTime(end) || start >= end) { setError('End time must be later than start time.'); return; }
      onTime(setTimeBlock(item.text, start, end));
    } else if (mode === 'none') {
      onRepeat(undefined);
    } else if (mode === 'after') {
      if (!Number.isSafeInteger(afterEvery) || afterEvery < 1 || afterEvery > 999) { setError('Choose an interval from 1 to 999.'); return; }
      const existing = item.repeat?.kind === 'after' && item.repeat.series && item.repeat.occurrence ? item.repeat : null;
      onRepeat({ kind: 'after', every: afterEvery, unit: afterUnit, series: existing?.series ?? newSeriesId(item.text, date), occurrence: existing?.occurrence ?? 1 });
    } else {
      const frequency: Unit = mode === 'daily' ? 'days' : mode === 'weekly' || mode === 'weekdays' ? 'weeks' : mode === 'monthlyWeekday' ? 'months' : mode === 'yearly' ? 'years' : unit;
      const interval = mode === 'custom' ? every : 1;
      if (!Number.isSafeInteger(interval) || interval < 1 || interval > 999) { setError('Choose an interval from 1 to 999.'); return; }
      const from = mode === 'custom' ? anchor : date;
      if (!validDate(from)) { setError('Choose a valid starting date.'); return; }
      let pattern: ScheduledPattern;
      if (frequency === 'days') pattern = { unit: 'days' };
      else if (frequency === 'weeks') {
        const days = mode === 'weekdays' ? weekdayNames.slice(0, 5) : mode === 'weekly' ? [weekday] : weekdayNames.filter(day => weeklyDays.includes(day));
        if (!days.length) { setError('Choose at least one weekday.'); return; }
        pattern = { unit: 'weeks', days: [...days] };
      } else if (frequency === 'months') {
        const useWeekday = mode === 'monthlyWeekday' || mode === 'custom' && monthOn === 'weekday';
        if (useWeekday) pattern = { unit: 'months', on: { kind: 'weekday', ordinal: mode === 'monthlyWeekday' ? ordinal : repeatOrdinal, weekday: mode === 'monthlyWeekday' ? weekday : patternWeekday } };
        else {
          if (!Number.isInteger(monthDay) || monthDay < 1 || monthDay > 31) { setError('Choose a day from 1 to 31.'); return; }
          pattern = { unit: 'months', on: { kind: 'day', day: monthDay } };
        }
      } else {
        const useWeekday = mode === 'custom' && yearOn === 'weekday';
        const month = mode === 'yearly' ? monthNumber : yearlyMonth;
        const day = mode === 'yearly' ? dayNumber : yearlyDay;
        if (!Number.isInteger(month) || month < 1 || month > 12) { setError('Choose a month from 1 to 12.'); return; }
        if (useWeekday) pattern = { unit: 'years', on: { kind: 'weekday', month, ordinal: repeatOrdinal, weekday: patternWeekday } };
        else {
          const candidate = String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
          if (!parseRecurrence('yearly on ' + candidate)) { setError('Choose a valid month and day.'); return; }
          pattern = { unit: 'years', on: { kind: 'date', month, day } };
        }
      }
      let endRule: ScheduleEnd | undefined;
      if (endMode === 'on') {
        if (!validDate(endDate) || endDate < date) { setError('The end date must include this item.'); return; }
        endRule = { kind: 'on', date: endDate };
      }
      if (endMode === 'after') {
        const currentNumber = mode === 'custom' && scheduled ? scheduled.occurrence : 1;
        if (!Number.isSafeInteger(endCount) || endCount < currentNumber || endCount > 9999) { setError('The end count must include this occurrence and be at most 9999.'); return; }
        endRule = { kind: 'after', count: endCount };
      }
      const continued = mode === 'custom' ? scheduled : null;
      onRepeat({ kind: 'scheduled', every: interval, pattern, from, series: continued?.series ?? newSeriesId(item.text, from), occurrence: continued?.occurrence ?? 1, ...(endRule ? { end: endRule } : {}) });
    }
    onClose();
  };

  return <Modal open onClose={onClose} title={kind === 'time' ? 'Time block for ' + item.text : 'Repeat ' + item.text} compact>
    <Heading>{kind === 'time' ? 'time block' : 'repeat'}</Heading>
    <Form onSubmit={event => { event.preventDefault(); save(); }}>
      {kind === 'time' ? <Inline><Label>start<Input aria-label="Start time" type="time" value={start} onChange={event => setStart(event.target.value)}/></Label><Label>end<Input aria-label="End time" type="time" value={end} onChange={event => setEnd(event.target.value)}/></Label></Inline> : <>
        <Label>rule<Select aria-label="Repeat rule" value={mode} onChange={event => { setMode(event.target.value as RepeatMode); setError(''); }}>
          <option value="none">does not repeat</option>
          <option value="daily">daily</option>
          <option value="weekly">weekly on {weekday}</option>
          <option value="monthlyWeekday">monthly on the {ordinalNames[ordinal]} {weekday}</option>
          <option value="yearly">annually on {monthNames[monthNumber - 1]} {dayNumber}</option>
          <option value="weekdays">every weekday (Mon–Fri)</option>
          <option value="custom">custom…</option>
          <option value="after">interval after completion</option>
        </Select></Label>
        {mode === 'custom' && <>
          <Inline><Label>repeat every<Input aria-label="Repeat interval" type="number" min="1" max="999" value={every} onChange={event => setEvery(Number(event.target.value))}/></Label><Label>unit<Select aria-label="Repeat unit" value={unit} onChange={event => setUnit(event.target.value as Unit)}><option value="days">days</option><option value="weeks">weeks</option><option value="months">months</option><option value="years">years</option></Select></Label></Inline>
          {unit === 'weeks' && <div><span style={{ fontSize:13 }}>repeat on</span><Days aria-label="Repeat weekdays">{weekdayNames.map(day => <Day key={day}><input type="checkbox" checked={weeklyDays.includes(day)} onChange={event => setWeeklyDays(current => event.target.checked ? [...current, day] : current.filter(value => value !== day))}/>{day}</Day>)}</Days></div>}
          {unit === 'months' && <><Label>repeat on<Select aria-label="Monthly pattern" value={monthOn} onChange={event => setMonthOn(event.target.value as typeof monthOn)}><option value="day">day of month</option><option value="weekday">weekday of month</option></Select></Label>{monthOn === 'day' ? <Label>day<Input aria-label="Day of month" type="number" min="1" max="31" value={monthDay} onChange={event => setMonthDay(Number(event.target.value))}/></Label> : <Inline><Label>which<Select aria-label="Monthly ordinal" value={repeatOrdinal} onChange={event => setRepeatOrdinal(Number(event.target.value) as Ordinal)}>{Object.entries(ordinalNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</Select></Label><Label>weekday<Select aria-label="Monthly weekday" value={patternWeekday} onChange={event => setPatternWeekday(event.target.value as Weekday)}>{weekdayNames.map(day => <option key={day} value={day}>{day}</option>)}</Select></Label></Inline>}</>}
          {unit === 'years' && <><Label>repeat on<Select aria-label="Yearly pattern" value={yearOn} onChange={event => setYearOn(event.target.value as typeof yearOn)}><option value="date">calendar date</option><option value="weekday">weekday of month</option></Select></Label><Inline><Label>month<Select aria-label="Repeat month" value={yearlyMonth} onChange={event => setYearlyMonth(Number(event.target.value))}>{monthNames.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}</Select></Label>{yearOn === 'date' ? <Label>day<Input aria-label="Repeat day" type="number" min="1" max="31" value={yearlyDay} onChange={event => setYearlyDay(Number(event.target.value))}/></Label> : <><Label>which<Select aria-label="Yearly ordinal" value={repeatOrdinal} onChange={event => setRepeatOrdinal(Number(event.target.value) as Ordinal)}>{Object.entries(ordinalNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</Select></Label><Label>weekday<Select aria-label="Yearly weekday" value={patternWeekday} onChange={event => setPatternWeekday(event.target.value as Weekday)}>{weekdayNames.map(day => <option key={day} value={day}>{day}</option>)}</Select></Label></>}</Inline></>}
          <CalendarDateField label="Schedule starts" caption="schedule starts" value={anchor} onChange={setAnchor}/>
        </>}
        {mode === 'after' && <Inline><Label>every<Input aria-label="Repeat interval" type="number" min="1" max="999" value={afterEvery} onChange={event => setAfterEvery(Number(event.target.value))}/></Label><Label>unit<Select aria-label="Repeat interval unit" value={afterUnit} onChange={event => setAfterUnit(event.target.value as Unit)}><option value="days">days</option><option value="weeks">weeks</option><option value="months">months</option><option value="years">years</option></Select></Label></Inline>}
        {mode !== 'none' && mode !== 'after' && <fieldset style={{ border:0, padding:0, margin:0, display:'grid', gap:8 }}><legend style={{ padding:0, marginBottom:7, fontSize:13 }}>ends</legend><EndOption><input type="radio" name="repeat-end" checked={endMode === 'never'} onChange={() => setEndMode('never')}/> never</EndOption><EndOption><input type="radio" name="repeat-end" checked={endMode === 'on'} onChange={() => setEndMode('on')}/> on</EndOption><EndDateField><CalendarDateField label="Repeat ends on" value={endDate} disabled={endMode !== 'on'} minDate={date} onChange={setEndDate}/></EndDateField><Inline><EndOption><input type="radio" name="repeat-end" checked={endMode === 'after'} onChange={() => setEndMode('after')}/> after</EndOption><Input aria-label="Repeat ends after" type="number" min="1" max="9999" disabled={endMode !== 'after'} value={endCount} onChange={event => { setEndCount(Number(event.target.value)); setEndMode('after'); }}/><span style={{ fontSize:12, color:'var(--muted)' }}>items</span></Inline></fieldset>}
        {mode !== 'none' && <p style={{ fontSize:12, color:'var(--muted)' }}>The next item appears when this one is completed.</p>}
      </>}
      {error && <Error role="alert">{error}</Error>}
      <Actions>{kind === 'time' && block && <Button type="button" onClick={() => { onTime(setTimeBlock(item.text, null, null)); onClose(); }}>remove time</Button>}<Button type="button" onClick={onClose}>cancel</Button><Button $primary type="submit">save</Button></Actions>
    </Form>
    {kind === 'repeat' && item.repeat && <p style={{ fontSize:11, color:'var(--muted)', margin:'8px 4px 0', overflowWrap:'anywhere' }}>TODO.txt: @repeat: {formatRecurrence(item.repeat)}</p>}
  </Modal>;
}
