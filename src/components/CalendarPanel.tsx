import { DayPicker, labelDayButton, type DateRange } from '@daypicker/react';
import type { ReactNode } from 'react';
import styled from 'styled-components';
import { todayString, validDate } from '../todoText';

const Surface = styled.div`
  width: max-content; max-width: calc(100vw - 16px); padding: 12px;
  border: 1px solid var(--line); border-radius: 10px;
  background: var(--surface); color: var(--ink);
  box-shadow: 0 12px 32px #0003;
  .rdp-root { --rdp-accent-color: var(--link); --rdp-today-color: var(--link);
    --rdp-accent-background-color: var(--date-bg);
    --rdp-range_start-color: var(--paper); --rdp-range_end-color: var(--paper);
    --rdp-range_middle-background-color: var(--date-bg);
    --rdp-day-width: 40px; --rdp-day-height: 40px;
    --rdp-day_button-width: 38px; --rdp-day_button-height: 38px;
    font-size: 13px; }
  .rdp-month_caption { font-size: 14px; font-weight: 600; }
  .rdp-dropdown_root { padding: 4px 6px; border-radius: 6px; cursor: pointer; }
  .rdp-dropdown_root:hover { background: var(--soft); }
  .rdp-dropdown_root:focus-within { outline: 2px solid var(--focus); outline-offset: 2px; }
  .rdp-dropdown_root .rdp-chevron { width: 12px; height: 12px; margin-left: 4px; }
  .rdp-selected { font-size: inherit; }
  .rdp-selected:not(.rdp-range_middle) .rdp-day_button { background: var(--link); color: var(--paper); border-color: var(--link); }
  .rdp-range_middle .rdp-day_button { background: transparent; color: var(--ink); }
  .rdp-day_button:hover:not(:disabled) { background: var(--soft); }
  .rdp-selected:not(.rdp-range_middle) .rdp-day_button:hover { background: var(--link); }
  .rdp-day.has-unfinished .rdp-day_button { position: relative; }
  .rdp-day.has-unfinished .rdp-day_button::after { content: ''; position: absolute; top: 5px; right: 5px; width: 5px; height: 5px; border-radius: 50%; background: var(--link); }
  .rdp-day.has-unfinished.rdp-selected:not(.rdp-range_middle) .rdp-day_button::after { background: var(--paper); }
  .rdp-chevron { fill: var(--ink); }
  .rdp-weekday { color: var(--muted); }
  @media(pointer:coarse) { .rdp-root { --rdp-day-width: 44px; --rdp-day-height: 44px;
    --rdp-day_button-width: 44px; --rdp-day_button-height: 44px; } }
  @media(max-width: 390px) { .rdp-root { --rdp-day-width: 38px; --rdp-day-height: 40px;
    --rdp-day_button-width: 38px; --rdp-day_button-height: 40px; } }
`;

export function dateFromString(value: string) {
  if (!validDate(value)) return new Date();
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function dateToString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function CalendarPanel({ value, onSelect, children, header, label, minDate, unfinishedDates, range, onRangeSelect }: {
  value: string; onSelect?: (value: string) => void; children?: ReactNode; header?: ReactNode; label: string; minDate?: string;
  unfinishedDates?: ReadonlySet<string>; range?: DateRange; onRangeSelect?: (range: DateRange | undefined) => void;
}) {
  const selected = dateFromString(value);
  const year = selected.getFullYear();
  const common = {
    defaultMonth: selected,
    captionLayout: 'dropdown' as const,
    startMonth: new Date(Math.min(1900, year - 100), 0),
    endMonth: new Date(Math.max(2100, year + 100), 11),
    today: dateFromString(todayString()),
    showOutsideDays: true,
    fixedWeeks: true,
    modifiers: unfinishedDates ? { unfinished: (date: Date) => unfinishedDates.has(dateToString(date)) } : undefined,
    modifiersClassNames: { unfinished: 'has-unfinished' },
    labels: unfinishedDates ? { labelDayButton: (date: Date, modifiers: Parameters<typeof labelDayButton>[1]) => `${labelDayButton(date, modifiers)}${modifiers.unfinished ? ', unfinished items' : ''}` } : undefined,
    disabled: minDate ? { before: dateFromString(minDate) } : undefined,
  };
  return <Surface role="group" aria-label={label}>
    {header}
    {onRangeSelect
      ? <DayPicker {...common} mode="range" min={1} resetOnSelect selected={range} onSelect={onRangeSelect}/>
      : <DayPicker {...common} mode="single" required selected={selected} onSelect={date => { if (date) onSelect?.(dateToString(date)); }}/>}
    {children}
  </Surface>;
}
