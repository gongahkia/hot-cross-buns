import { useState } from 'react';
import styled from 'styled-components';
import { Button } from '../styles';
import { formatRecurrence, parseRecurrence, type RecurrenceRule } from '../recurrence';
import { parseTimeBlock, setTimeBlock, validTime } from '../timeBlock';
import type { TodoItem } from '../todoText';
import { Modal } from './Modal';

const Heading = styled.h2`font-size: 18px; margin: 2px 4px 16px;`;
const Form = styled.form`display: grid; gap: 13px; padding: 4px;`;
const Label = styled.label`display: grid; gap: 5px; font-size: 13px;`;
const Input = styled.input`min-height: 44px; width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 7px; background: var(--field); color: var(--ink);`;
const Select = styled.select`min-height: 44px; width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 7px; background: var(--field); color: var(--ink);`;
const Days = styled.div`display: flex; flex-wrap: wrap; gap: 5px;`;
const Day = styled.label`display: inline-flex; align-items: center; gap: 4px; min-height: 36px; padding: 5px 7px; border: 1px solid var(--line); border-radius: 6px; font-size: 12px; &:has(input:checked) { border-color: var(--link); color: var(--link); background: var(--date-bg); }`;
const Inline = styled.div`display: flex; gap: 9px; align-items: end; > * { flex: 1; min-width: 0; }`;
const Actions = styled.div`display: flex; justify-content: flex-end; gap: 7px; margin-top: 4px;`;
const Error = styled.p`font-size: 12px; color: var(--danger);`;
const weekdayNames = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

type EditorKind = 'time' | 'repeat';
type RepeatMode = 'none' | RecurrenceRule['kind'];

export function ScheduleEditor({ kind, item, date, onClose, onTime, onRepeat }: {
  kind: EditorKind; item: TodoItem; date: string; onClose: () => void;
  onTime: (text: string) => void; onRepeat: (rule: RecurrenceRule | undefined) => void;
}) {
  const block = parseTimeBlock(item.text);
  const [start, setStart] = useState(block?.start ?? '09:00');
  const [end, setEnd] = useState(block?.end ?? '10:00');
  const [mode, setMode] = useState<RepeatMode>(item.repeat?.kind ?? 'none');
  const weekday = weekdayNames[(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7];
  const [weeklyDays, setWeeklyDays] = useState<string[]>(item.repeat?.kind === 'weekly' ? item.repeat.days : [weekday]);
  const [monthDay, setMonthDay] = useState(item.repeat?.kind === 'monthly' ? item.repeat.day : Number(date.slice(8, 10)));
  const [yearlyMonth, setYearlyMonth] = useState(item.repeat?.kind === 'yearly' ? item.repeat.month : Number(date.slice(5, 7)));
  const [yearlyDay, setYearlyDay] = useState(item.repeat?.kind === 'yearly' ? item.repeat.day : Number(date.slice(8, 10)));
  const [every, setEvery] = useState(item.repeat?.kind === 'after' ? item.repeat.every : 1);
  const [unit, setUnit] = useState<'days' | 'weeks' | 'months' | 'years'>(item.repeat?.kind === 'after' ? item.repeat.unit : 'days');
  const [error, setError] = useState('');
  const save = () => {
    if (kind === 'time') {
      if (!validTime(start) || !validTime(end) || start >= end) { setError('End time must be later than start time.'); return; }
      onTime(setTimeBlock(item.text, start, end));
    } else {
      let rule: RecurrenceRule | undefined;
      switch (mode) {
        case 'none': break;
        case 'daily': rule = { kind: 'daily' }; break;
        case 'weekdays': rule = { kind: 'weekdays' }; break;
        case 'weekly':
          if (!weeklyDays.length) { setError('Choose at least one day.'); return; }
          rule = { kind: 'weekly', days: weekdayNames.filter(day => weeklyDays.includes(day)) };
          break;
        case 'monthly':
          if (!Number.isInteger(monthDay) || monthDay < 1 || monthDay > 31) { setError('Choose a day from 1 to 31.'); return; }
          rule = { kind: 'monthly', day: monthDay };
          break;
        case 'yearly':
          rule = parseRecurrence(`yearly on ${String(yearlyMonth).padStart(2, '0')}-${String(yearlyDay).padStart(2, '0')}`) ?? undefined;
          if (!rule) { setError('Choose a valid month and day.'); return; }
          break;
        case 'after':
          if (!Number.isSafeInteger(every) || every < 1 || every > 999) { setError('Choose an interval from 1 to 999.'); return; }
          rule = { kind: 'after', every, unit };
          break;
      }
      onRepeat(rule);
    }
    onClose();
  };
  return <Modal open onClose={onClose} title={kind === 'time' ? `Time block for ${item.text}` : `Repeat ${item.text}`} compact>
    <Heading>{kind === 'time' ? 'time block' : 'repeat'}</Heading>
    <Form onSubmit={event => { event.preventDefault(); save(); }}>
      {kind === 'time' ? <Inline><Label>start<Input aria-label="Start time" type="time" value={start} onChange={event => setStart(event.target.value)}/></Label><Label>end<Input aria-label="End time" type="time" value={end} onChange={event => setEnd(event.target.value)}/></Label></Inline> : <>
        <Label>rule<Select aria-label="Repeat rule" value={mode} onChange={event => setMode(event.target.value as RepeatMode)}>
          <option value="none">does not repeat</option><option value="daily">daily</option><option value="weekdays">weekdays</option><option value="weekly">weekly on selected days</option><option value="monthly">monthly on a day</option><option value="yearly">yearly on a date</option><option value="after">interval after completion</option>
        </Select></Label>
        {mode === 'weekly' && <Days aria-label="Repeat weekdays">{weekdayNames.map(day => <Day key={day}><input type="checkbox" checked={weeklyDays.includes(day)} onChange={event => setWeeklyDays(current => event.target.checked ? [...current, day] : current.filter(value => value !== day))}/>{day}</Day>)}</Days>}
        {mode === 'monthly' && <Label>day of month<Input aria-label="Day of month" type="number" min="1" max="31" value={monthDay} onChange={event => setMonthDay(Number(event.target.value))}/></Label>}
        {mode === 'yearly' && <Inline><Label>month<Input aria-label="Repeat month" type="number" min="1" max="12" value={yearlyMonth} onChange={event => setYearlyMonth(Number(event.target.value))}/></Label><Label>day<Input aria-label="Repeat day" type="number" min="1" max="31" value={yearlyDay} onChange={event => setYearlyDay(Number(event.target.value))}/></Label></Inline>}
        {mode === 'after' && <Inline><Label>every<Input aria-label="Repeat interval" type="number" min="1" max="999" value={every} onChange={event => setEvery(Number(event.target.value))}/></Label><Label>unit<Select aria-label="Repeat interval unit" value={unit} onChange={event => setUnit(event.target.value as typeof unit)}><option value="days">days</option><option value="weeks">weeks</option><option value="months">months</option><option value="years">years</option></Select></Label></Inline>}
        {mode !== 'none' && <p style={{fontSize:12,color:'var(--muted)'}}>{mode === 'after' ? `Next item: ${every} ${every === 1 ? unit.slice(0, -1) : unit} after completion` : `Next item: the first ${mode === 'weekly' ? weeklyDays.join(', ') : mode === 'monthly' ? `day ${monthDay} of a month` : mode === 'yearly' ? `${String(yearlyMonth).padStart(2, '0')}-${String(yearlyDay).padStart(2, '0')}` : mode} after completion`}</p>}
      </>}
      {error && <Error role="alert">{error}</Error>}
      <Actions>{kind === 'time' && block && <Button type="button" onClick={() => { onTime(setTimeBlock(item.text, null, null)); onClose(); }}>remove time</Button>}<Button type="button" onClick={onClose}>cancel</Button><Button $primary type="submit">save</Button></Actions>
    </Form>
    {kind === 'repeat' && item.repeat && <p style={{fontSize:11,color:'var(--muted)',margin:'8px 4px 0'}}>TODO.txt: @repeat: {formatRecurrence(item.repeat)}</p>}
  </Modal>;
}
