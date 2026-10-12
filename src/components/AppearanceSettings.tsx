import { useState } from 'react';
import styled from 'styled-components';
import { Moon, Sun } from 'lucide-react';
import { Button } from '../styles';
import { getFont, getTheme, setFont, setTheme, type AppFont, type DateFormat } from '../preferences';
import { Modal } from './Modal';

const Title = styled.h2`font-size: 22px; margin-bottom: 12px;`;
const Intro = styled.p`font-size: 13px; margin-bottom: 15px;`;
const Mode = styled.div`display: flex; gap: 8px; margin-bottom: 14px;`;
const FontField = styled.label`display: grid; gap: 6px; font-size: 13px;`;
const FontSelect = styled.select`min-height: 44px; background: var(--field); border: 1px solid var(--line); border-radius: 7px; padding: 0 8px;`;
const Actions = styled.div`display: flex; justify-content: flex-end; margin-top: 20px;`;

export function AppearanceSettings({ open, onClose, dateFormat, onDateFormatChange }: { open: boolean; onClose: () => void; dateFormat: DateFormat; onDateFormatChange: (value: DateFormat) => void }) {
  const [theme, setThemeState] = useState(getTheme);
  const [font, setFontState] = useState(getFont);
  return <Modal open={open} onClose={onClose} title="Jing settings" compact>
    <Title>settings</Title>
    <Intro>The journal stays in this browser until you export or save TODO.txt.</Intro>
    <Mode><Button onClick={() => { const next = theme === 'day' ? 'night' : 'day'; setTheme(next); setThemeState(next); }}>{theme === 'day' ? <Moon size={15}/> : <Sun size={15}/>} {theme === 'day' ? 'night' : 'day'} mode</Button></Mode>
    <FontField>Font<FontSelect value={font} onChange={event => { const next = event.target.value as AppFont; setFont(next); setFontState(next); }}><option value="sohne">Sohne</option><option value="dm-sans">DM Sans</option><option value="lora">Lora</option><option value="system">System</option></FontSelect></FontField>
    <FontField>Date headings<FontSelect value={dateFormat} onChange={event => onDateFormatChange(event.target.value as DateFormat)}><option value="long">13 October 2026</option><option value="iso">2026-10-13</option><option value="day-first">13/10/2026</option><option value="month-first">10/13/2026</option></FontSelect><small>TODO.txt always keeps YYYY-MM-DD dates.</small></FontField>
    <Actions><Button onClick={onClose}>close</Button></Actions>
  </Modal>;
}
