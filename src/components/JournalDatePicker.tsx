import { useState } from 'react';
import type { DateRange } from '@daypicker/react';
import styled from 'styled-components';
import { Button } from '../styles';
import type { DateSpan } from '../dayWindow';
import { CalendarPanel, dateFromString, dateToString } from './CalendarPanel';

const Controls = styled.div`display:flex; align-items:center; justify-content:flex-end; padding:2px 4px 6px;`;
const RangeToggle = styled.button<{ $active:boolean }>`min-height:40px; padding:6px 10px; border:0; border-radius:6px; background:${({$active})=>$active?'var(--date-bg)':'transparent'}; color:${({$active})=>$active?'var(--link)':'var(--muted)'}; font-size:12px; &:hover{background:var(--soft); color:var(--ink);}`;
const Footer = styled.div`display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; padding:7px 4px 2px; border-top:1px solid var(--line);`;
const Hint = styled.span`min-width:0; flex:1 1 110px; color:var(--muted); font-size:12px;`;
const FooterActions = styled.div`display:flex; gap:6px; margin-left:auto;`;
const WeekButton = styled.button`min-height:40px; padding:6px 8px; border:0; border-radius:6px; background:transparent; color:var(--link); font-size:12px; &:hover{background:var(--soft);}`;
const ApplyButton = styled(Button)`min-height:40px; padding:7px 12px; &:disabled{opacity:.45;cursor:default;}`;

function shortDate(date: Date) {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function JournalDatePicker({ selectedDate, activeRange, rangeActive, unfinishedDates, onSelectDate, onShowWeek, onExitRange, onApplyRange, onClose }: {
  selectedDate: string;
  activeRange: DateSpan | null;
  rangeActive: boolean;
  unfinishedDates: ReadonlySet<string>;
  onSelectDate: (date: string) => void;
  onShowWeek: () => void;
  onExitRange: () => void;
  onApplyRange: (range: DateSpan) => void;
  onClose: () => void;
}) {
  const [selectingRange, setSelectingRange] = useState(rangeActive);
  const [draft, setDraft] = useState<DateRange | undefined>(activeRange ? { from: dateFromString(activeRange.from), to: dateFromString(activeRange.to) } : undefined);
  const complete = !!draft?.from && !!draft?.to;
  const toggleRange = () => {
    setSelectingRange(value => !value);
    if (selectingRange && rangeActive) onExitRange();
  };
  return <CalendarPanel label="Choose journal date" value={selectingRange && draft?.from ? dateToString(draft.from) : selectedDate}
    unfinishedDates={unfinishedDates} onSelect={onSelectDate}
    range={selectingRange ? draft : undefined} onRangeSelect={selectingRange ? setDraft : undefined}
    header={<Controls><RangeToggle type="button" aria-label="Select date range" aria-pressed={selectingRange} $active={selectingRange} onClick={toggleRange}>range</RangeToggle></Controls>}>
    <Footer>
      {selectingRange ? <>
        <Hint role="status">{complete ? `${shortDate(draft!.from!)} – ${shortDate(draft!.to!)}` : draft?.from ? 'Choose an end date' : 'Choose a start date'}</Hint>
        <FooterActions><WeekButton type="button" onClick={onClose}>cancel</WeekButton><ApplyButton $primary type="button" disabled={!complete} onClick={() => { if (draft?.from && draft.to) onApplyRange({ from: dateToString(draft.from), to: dateToString(draft.to) }); }}>apply</ApplyButton></FooterActions>
      </> : <><Hint>Choose a day, or show its week.</Hint><WeekButton type="button" onClick={onShowWeek}>show week</WeekButton></>}
    </Footer>
  </CalendarPanel>;
}
