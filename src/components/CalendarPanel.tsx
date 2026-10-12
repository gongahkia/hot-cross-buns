import { DayPicker } from '@daypicker/react';
import type { ReactNode } from 'react';
import styled from 'styled-components';
import { todayString, validDate } from '../todoText';

const Surface = styled.div`
  width: max-content; max-width: calc(100vw - 16px); padding: 12px;
  border: 1px solid var(--line); border-radius: 10px;
  background: var(--surface); color: var(--ink);
  box-shadow: 0 12px 32px #0003;
  .rdp-root { --rdp-accent-color: var(--link); --rdp-today-color: var(--link);
    --rdp-day-width: 40px; --rdp-day-height: 40px;
    --rdp-day_button-width: 38px; --rdp-day_button-height: 38px;
    font-size: 13px; }
  .rdp-month_caption { font-size: 14px; font-weight: 600; }
  .rdp-selected { font-size: inherit; }
  .rdp-selected .rdp-day_button { background: var(--link); color: var(--paper); border-color: var(--link); }
  .rdp-day_button:hover:not(:disabled) { background: var(--soft); }
  .rdp-selected .rdp-day_button:hover { background: var(--link); }
  .rdp-chevron { fill: var(--ink); }
  .rdp-weekday { color: var(--muted); }
  @media(pointer:coarse) { .rdp-root { --rdp-day-width: 44px; --rdp-day-height: 44px;
    --rdp-day_button-width: 44px; --rdp-day_button-height: 44px; } }
`;

export function dateFromString(value: string) {
  if (!validDate(value)) return new Date();
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function dateToString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function CalendarPanel({ value, onSelect, children, label }: {
  value: string; onSelect: (value: string) => void; children?: ReactNode; label: string;
}) {
  return <Surface aria-label={label}>
    <DayPicker mode="single" selected={dateFromString(value)} defaultMonth={dateFromString(value)}
      today={dateFromString(todayString())} showOutsideDays fixedWeeks
      onSelect={date => { if (date) onSelect(dateToString(date)); }}/>
    {children}
  </Surface>;
}
