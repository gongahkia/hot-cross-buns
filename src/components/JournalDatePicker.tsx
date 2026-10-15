import { useState } from 'react';
import type { DateRange } from '@daypicker/react';
import styled from 'styled-components';
import type { DateSpan } from '../dayWindow';
import { CalendarPanel, dateFromString, dateToString } from './CalendarPanel';

const Controls = styled.div`display:flex; align-items:center; justify-content:flex-end; padding:2px 4px 6px;`;
const RangeToggle = styled.button<{ $active:boolean }>`min-height:40px; padding:6px 10px; border:0; border-radius:6px; background:${({$active})=>$active?'var(--date-bg)':'transparent'}; color:${({$active})=>$active?'var(--link)':'var(--muted)'}; font-size:12px; &:hover{background:var(--soft); color:var(--ink);} @media(pointer:coarse){min-height:44px;}`;

export function JournalDatePicker({ selectedDate, activeRange, rangeActive, unfinishedDates, onSelectDate, onToggleRange, onSelectRange }: {
  selectedDate: string;
  activeRange: DateSpan;
  rangeActive: boolean;
  unfinishedDates: ReadonlySet<string>;
  onSelectDate: (date: string) => void;
  onToggleRange: (active: boolean) => void;
  onSelectRange: (range: DateSpan) => void;
}) {
  const [draft, setDraft] = useState<DateRange>({ from: dateFromString(activeRange.from), to: dateFromString(activeRange.to) });
  const selectRange = (next: DateRange | undefined) => {
    if (!next) return;
    setDraft(next);
    if (next.from && next.to) onSelectRange({ from: dateToString(next.from), to: dateToString(next.to) });
  };
  return <CalendarPanel label="Choose journal date" value={rangeActive && draft.from ? dateToString(draft.from) : selectedDate}
    unfinishedDates={unfinishedDates} onSelect={onSelectDate}
    range={rangeActive ? draft : undefined} onRangeSelect={rangeActive ? selectRange : undefined}
    header={<Controls><RangeToggle type="button" aria-label="Select date range" aria-pressed={rangeActive} $active={rangeActive} onClick={() => onToggleRange(!rangeActive)}>range</RangeToggle></Controls>}/>;
}
