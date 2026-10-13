import { useState } from 'react';
import styled from 'styled-components';
import { Button } from '../styles';
import { dateFormatOptions, fontOptions, getFont, getTheme, setFont, setTheme, type AppFont, type DateFormat } from '../preferences';
import { colorThemes, type Theme } from '../themes';
import { Modal } from './Modal';

const FontField = styled.label`display: grid; gap: 6px; margin-top: 14px; font-size: 13px;`;
const FontSelect = styled.select`width: 100%; min-height: 44px; background: var(--field); border: 1px solid var(--line); border-radius: 7px; padding: 0 8px;`;
const Actions = styled.div`display: flex; justify-content: flex-end; margin-top: 20px;`;

export function AppearanceSettings({ open, onClose, dateFormat, onDateFormatChange }: { open: boolean; onClose: () => void; dateFormat: DateFormat; onDateFormatChange: (value: DateFormat) => void }) {
  const [theme, setThemeState] = useState(getTheme);
  const [font, setFontState] = useState(getFont);
  const chooseTheme = (next: Theme) => { setTheme(next); setThemeState(next); };
  return <Modal open={open} onClose={onClose} title="Hito settings" compact>
    <FontField>Color scheme<FontSelect value={theme} onChange={event => chooseTheme(event.target.value as Theme)}><option value="day">Hito Day</option><option value="night">Hito Night</option>{colorThemes.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</FontSelect></FontField>
    <FontField>Font<FontSelect value={font} onChange={event => { const next = event.target.value as AppFont; setFont(next); setFontState(next); }}>{fontOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</FontSelect></FontField>
    <FontField>Date headings<FontSelect value={dateFormat} onChange={event => onDateFormatChange(event.target.value as DateFormat)}>{dateFormatOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</FontSelect></FontField>
    <Actions><Button onClick={onClose}>close</Button></Actions>
  </Modal>;
}
