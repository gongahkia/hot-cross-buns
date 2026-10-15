import { CalendarDays } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import styled from 'styled-components';
import { formatDateHeading, getDateFormat } from '../preferences';
import { CalendarPanel } from './CalendarPanel';

const Field = styled.div`
  display: grid; gap: 5px; min-width: 0; font-size: 13px;
`;
const Trigger = styled.button`
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  width: 100%; min-height: 44px; padding: 8px 10px;
  border: 1px solid var(--line); border-radius: 7px;
  background: var(--field); color: var(--ink); text-align: left; cursor: pointer;
  &:hover:not(:disabled) { background: var(--soft); }
  &:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  &:disabled { opacity: .5; cursor: default; }
  svg { flex: none; }
`;
const Popup = styled.div`
  width: max-content; max-width: 100%;
  animation: calendar-appear 150ms ease-out both;
  @keyframes calendar-appear { from { opacity: 0; transform: translateY(-4px); } }
  @media (max-width: 350px) { width: calc(100vw - 16px); max-width: none; margin-left: -16px; }
  @media (prefers-reduced-motion: reduce) { animation: none; }
`;

export function CalendarDateField({ label, caption, value, onChange, disabled = false, minDate }: {
  label: string; caption?: string; value: string; onChange: (value: string) => void; disabled?: boolean; minDate?: string;
}) {
  const [open, setOpen] = useState(false);
  const fieldRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupId = useId();
  const displayedDate = formatDateHeading(value, getDateFormat());

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!fieldRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [open]);

  return <Field ref={fieldRef} onKeyDown={event => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
  }}>
    {caption && <span>{caption}</span>}
    <Trigger ref={triggerRef} type="button" aria-label={`${label}: ${displayedDate}`} aria-expanded={open && !disabled}
      aria-controls={open && !disabled ? popupId : undefined} disabled={disabled}
      onClick={() => setOpen(current => !current)}>
      <span>{displayedDate}</span><CalendarDays size={18} aria-hidden="true"/>
    </Trigger>
    {open && !disabled && <Popup id={popupId}>
      <CalendarPanel label={`Choose ${label.toLowerCase()}`} value={value} minDate={minDate}
        onSelect={date => { onChange(date); setOpen(false); triggerRef.current?.focus(); }}/>
    </Popup>}
  </Field>;
}
