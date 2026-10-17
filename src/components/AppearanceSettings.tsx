import { useState } from 'react';
import styled from 'styled-components';
import { Button } from '../styles';
import { dateFormatOptions, fontOptions, getFont, getTheme, getScratchpadMapping, getScratchpadMoveMode, setFont, setTheme, setScratchpadMapping, setScratchpadMoveMode, type AppFont, type DateFormat, type HolidayMode, type PastUnfinishedScope, type WeekStart } from '../preferences';
import type { ScratchpadMapping, ScratchpadMoveMode } from '../scratchpad';
import { holidayCountries } from '../holidayCountries';
import { todayString } from '../todoText';
import { colorThemes, type Theme } from '../themes';
import { Modal } from './Modal';

const FontField = styled.label`display: grid; gap: 6px; margin-top: 14px; font-size: 13px;`;
const FontSelect = styled.select`width: 100%; min-height: 44px; background: var(--field); border: 1px solid var(--line); border-radius: 7px; padding: 0 8px; @media(pointer:coarse){font-size:16px;}`;
const YearInput = styled.input`width: 100%; min-height: 44px; background: var(--field); border: 1px solid var(--line); border-radius: 7px; padding: 0 8px; color:var(--ink); @media(pointer:coarse){font-size:16px;}`;
const Actions = styled.div`display: flex; justify-content: flex-end; margin-top: 20px;`;
const SectionTitle = styled.h2`font-size:14px; margin:24px 0 8px; padding-top:15px; border-top:1px solid var(--line);`;
const CheckField = styled.label`display:flex; align-items:center; gap:10px; min-height:44px; font-size:13px; input{width:18px;height:18px;accent-color:var(--link);}`;
const Hint = styled.p`margin:7px 0 0;color:var(--muted);font-size:12px;line-height:1.45;`;
const ImportButton = styled(Button)`margin-top:12px;min-height:44px;`;
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function AppearanceSettings({ open, onClose, dateFormat, onDateFormatChange, timeZone, onTimeZoneChange, weekStart, onWeekStartChange, pastUnfinishedScope, onPastUnfinishedScopeChange, holidaysEnabled, onHolidaysEnabledChange, holidayMode, onHolidayModeChange, holidayCountry, onHolidayCountryChange, onImportHolidays, holidayStatus }: {
  open: boolean; onClose: () => void; dateFormat: DateFormat; onDateFormatChange: (value: DateFormat) => void;
  timeZone: string; onTimeZoneChange: (value: string) => void; weekStart: WeekStart; onWeekStartChange: (value: WeekStart) => void;
  pastUnfinishedScope: PastUnfinishedScope; onPastUnfinishedScopeChange: (value: PastUnfinishedScope) => void;
  holidaysEnabled: boolean; onHolidaysEnabledChange: (value: boolean) => void; holidayMode: HolidayMode; onHolidayModeChange: (value: HolidayMode) => void;
  holidayCountry: string; onHolidayCountryChange: (value: string) => void; onImportHolidays: (country: string, year: number) => void; holidayStatus: string;
}) {
  const [theme, setThemeState] = useState(getTheme);
  const [font, setFontState] = useState(getFont);
  const [scratchpadMapping, setMappingState] = useState(getScratchpadMapping);
  const [scratchpadMoveMode, setMoveModeState] = useState(getScratchpadMoveMode);
  const [holidayYear, setHolidayYear] = useState(() => Number(todayString().slice(0, 4)));
  const chooseTheme = (next: Theme) => { setTheme(next); setThemeState(next); };
  return <Modal open={open} onClose={onClose} title="Shio Pan settings" compact>
    <FontField>Color scheme<FontSelect value={theme} onChange={event => chooseTheme(event.target.value as Theme)}><option value="day">Shio Pan Day</option><option value="night">Shio Pan Night</option>{colorThemes.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</FontSelect></FontField>
    <FontField>Font<FontSelect aria-label="Font" value={font} onChange={event => { const next = event.target.value as AppFont; setFont(next); setFontState(next); }}>{fontOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</FontSelect></FontField>
    <FontField>Date headings<FontSelect value={dateFormat} onChange={event => onDateFormatChange(event.target.value as DateFormat)}>{dateFormatOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</FontSelect></FontField>
    <SectionTitle>Scratchpad</SectionTitle>
    <FontField>Selected lines become<FontSelect value={scratchpadMapping} onChange={event => { const value = event.target.value as ScratchpadMapping; setScratchpadMapping(value); setMappingState(value); }}><option value="details">First line as title, rest as details</option><option value="items">One item per nonempty line</option><option value="single">One title joining all lines</option></FontSelect></FontField>
    <FontField>After creating an item<FontSelect value={scratchpadMoveMode} onChange={event => { const value = event.target.value as ScratchpadMoveMode; setScratchpadMoveMode(value); setMoveModeState(value); }}><option value="cut">Remove selected scratchpad text</option><option value="ask">Ask whether to remove or keep it</option></FontSelect></FontField>
    <Hint>Scratchpad text is stored only in this browser. Move text into dated or undated items to include it in TODO.txt.</Hint>
    <SectionTitle>Calendar</SectionTitle>
    <FontField>Time zone<FontSelect value={timeZone} onChange={event => onTimeZoneChange(event.target.value)}>{Intl.supportedValuesOf('timeZone').map(zone => <option key={zone} value={zone}>{zone.replaceAll('_', ' ')}</option>)}</FontSelect></FontField>
    <Hint>This sets which date counts as today. Item times remain the wall times written in TODO.txt.</Hint>
    <FontField>Week starts on<FontSelect value={weekStart} onChange={event => onWeekStartChange(Number(event.target.value) as WeekStart)}>{weekdays.map((day, index) => <option key={day} value={index}>{day}</option>)}</FontSelect></FontField>
    <FontField>Earlier unfinished items<FontSelect value={pastUnfinishedScope} onChange={event => onPastUnfinishedScopeChange(event.target.value as PastUnfinishedScope)}><option value="visible">Current visible range</option><option value="all">Every earlier date</option></FontSelect></FontField>
    <Hint>Choose which earlier items appear in the count above the dated journal.</Hint>
    <SectionTitle>Public holidays</SectionTitle>
    <CheckField><input type="checkbox" checked={holidaysEnabled} onChange={event => { onHolidaysEnabledChange(event.target.checked); if (event.target.checked && holidayMode === 'saved') onImportHolidays(holidayCountry, holidayYear); }}/>Use public holidays</CheckField>
    <FontField>How to use holidays<FontSelect value={holidayMode} onChange={event => { const next = event.target.value as HolidayMode; onHolidayModeChange(next); if (holidaysEnabled && next === 'saved') onImportHolidays(holidayCountry, holidayYear); }}><option value="saved">Add as Shio Pan items</option><option value="view">Show on dates only</option></FontSelect></FontField>
    <FontField>Holiday country<FontSelect value={holidayCountry} onChange={event => onHolidayCountryChange(event.target.value)}>{holidayCountries.map(country => <option key={country.code} value={country.code}>{country.name}</option>)}</FontSelect></FontField>
    {holidayMode === 'saved' ? <><FontField>Year to add<YearInput type="number" min={1900} max={2100} value={holidayYear} onChange={event => setHolidayYear(Number(event.target.value))}/></FontField>
      {holidaysEnabled && <ImportButton type="button" disabled={!Number.isInteger(holidayYear) || holidayYear < 1900 || holidayYear > 2100} onClick={() => onImportHolidays(holidayCountry, holidayYear)}>Add {holidayYear} holidays</ImportButton>}
      <Hint>Added holidays become ordinary all-day Shio Pan items in TODO.txt. Turning this setting off keeps them. Importing the same unchanged holiday twice will not duplicate it.</Hint></>
      : <Hint>Holidays appear beside their dates while this is on. This view stays current and adds nothing to TODO.txt. Outside Singapore, only countrywide holidays are shown.</Hint>}
    {holidayStatus && <Hint role="status">{holidayStatus}</Hint>}
    <Actions><Button onClick={onClose}>close</Button></Actions>
  </Modal>;
}
