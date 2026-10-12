import styled from 'styled-components';
import { Modal } from './Modal';
import type { AppFont } from '../preferences';
import { supportedTimezones, systemTimezone } from '../preferences';

const Panel = styled.div`display: grid; gap: 24px; padding: 8px 10px 10px;`;
const Header = styled.div`display: grid; gap: 3px;`;
const Title = styled.h2`font-size: 18px;`;
const Intro = styled.p`font-size: 12px; color: var(--muted);`;
const Section = styled.fieldset`display: grid; gap: 9px; min-width: 0; padding: 0; border: 0;`;
const Legend = styled.legend`margin-bottom: 9px; padding: 0; color: var(--muted); font-size: 12px;`;
const FontGrid = styled.div`display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px;`;
const FontChoice = styled.button<{ $font: AppFont; $selected: boolean }>`
  min-height: 52px; padding: 8px 11px; border: 1px solid ${({ $selected }) => $selected ? 'var(--link)' : 'var(--line)'};
  border-radius: 8px; background: ${({ $selected }) => $selected ? 'var(--date-bg)' : 'transparent'};
  color: ${({ $selected }) => $selected ? 'var(--link)' : 'var(--ink)'}; text-align: left;
  font-family: ${({ $font }) => $font === 'sohne' ? "'Sohne', sans-serif" : $font === 'dm-sans' ? "'DM Sans', sans-serif" : $font === 'lora' ? "'Lora', serif" : "system-ui, sans-serif"};
  font-size: 15px; font-weight: 400;
  transition: background-color 120ms ease-out, border-color 120ms ease-out, color 120ms ease-out, scale 150ms ease-out;
  &:hover { border-color: var(--link); }
  &:active { scale: .96; }
`;
const Select = styled.select`
  width: 100%; min-height: 44px; padding: 8px 34px 8px 11px; border: 1px solid var(--line); border-radius: 8px;
  background: var(--field); color: var(--ink); font-size: 14px;
`;
const Hint = styled.p`font-size: 11px; color: var(--muted);`;

const fontOptions: { id: AppFont; label: string }[] = [
  { id: 'sohne', label: 'Söhne' },
  { id: 'dm-sans', label: 'DM Sans' },
  { id: 'lora', label: 'Lora' },
  { id: 'system', label: 'System' },
];

export function SettingsModal({ open, font, timezone, onClose, onFontChange, onTimezoneChange }: {
  open: boolean;
  font: AppFont;
  timezone: string;
  onClose: () => void;
  onFontChange: (font: AppFont) => void;
  onTimezoneChange: (timezone: string) => void;
}) {
  return <Modal open={open} onClose={onClose} title="Jing settings" compact>
    <Panel>
      <Header><Title>Jing settings</Title><Intro>Appearance and local date preferences.</Intro></Header>
      <Section>
        <Legend>Typeface</Legend>
        <FontGrid>{fontOptions.map(option => <FontChoice key={option.id} type="button" $font={option.id} $selected={font === option.id}
          aria-pressed={font === option.id} onClick={() => onFontChange(option.id)}>{option.label}</FontChoice>)}</FontGrid>
      </Section>
      <Section>
        <Legend>Timezone</Legend>
        <Select aria-label="Timezone" value={timezone} onChange={event => onTimezoneChange(event.target.value)}>
          {supportedTimezones().map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
        </Select>
        <Hint>Controls day boundaries, journal dates, statistics, and session times. Device timezone: {systemTimezone().replaceAll('_', ' ')}.</Hint>
      </Section>
    </Panel>
  </Modal>;
}
