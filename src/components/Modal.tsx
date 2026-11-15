import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import styled, { css } from 'styled-components';
import { VisuallyHidden } from '../styles';

const Sheet = styled.dialog<{ $visible: boolean; $wide: boolean; $compact: boolean; $preview: boolean; $palette: boolean }>`
  width: min(${({ $palette, $preview, $wide, $compact }) => $palette ? '512px' : $preview ? '1100px' : $compact ? '420px' : $wide ? '720px' : '620px'}, calc(100vw - 32px)); max-width: none; max-height: calc(100dvh - 40px);
  padding: ${({ $palette, $compact }) => $palette ? '0' : $compact ? '12px' : '32px'}; border: 0; border-radius: 16px; color: var(--ink); background: var(--surface);
  box-shadow: ${({ $compact }) => $compact ? '' : '0 0 0 1px #00000008,'} 0 16px 60px #202a2526; overflow-y: auto;
  opacity: ${({ $visible }) => $visible ? 1 : 0};
  transform: ${({ $visible, $palette }) => $palette ? `scale(${$visible ? 1 : .95})` : `translateY(${$visible ? 0 : 8}px)`};
  transition: opacity ${({ $palette }) => $palette ? 200 : 160}ms ${({ $palette, $visible }) => $palette && !$visible ? 'ease-in' : 'ease-out'}, transform ${({ $palette }) => $palette ? 200 : 160}ms ${({ $palette, $visible }) => $palette && !$visible ? 'ease-in' : 'ease-out'};
  &::backdrop { background: var(--backdrop); backdrop-filter: blur(3px); }
  @media (max-width: 500px) {
    width: calc(100vw - 16px); max-height: calc(100dvh - max(16px, env(safe-area-inset-top)) - max(16px, env(safe-area-inset-bottom)));
    padding: ${({ $palette, $compact }) => $palette ? '0' : $compact ? '12px' : '22px 18px'}; border-radius: 18px;
  }
  /* palette geometry and motion follow the archived browser palette at 8f2c2b2. */
  ${({ $palette, $visible }) => $palette && css`
    &[open] { display:flex; flex-direction:column; }
    max-height: min(calc(100dvh - 32px), calc(var(--palette-viewport-height, 100dvh) - 16px));
    border:1px solid var(--line); border-radius:10px; overflow:hidden; background:var(--paper);
    box-shadow:0 10px 24px #0000001f;
    &::backdrop { background:#0000002e; backdrop-filter:none; opacity:${$visible ? 1 : 0}; transition:opacity 200ms ${$visible ? 'ease-out' : 'ease-in'}; }
    :root[data-theme='night'] & { background:color-mix(in srgb, var(--surface) 60%, transparent); border-color:color-mix(in srgb, var(--line) 50%, transparent); backdrop-filter:blur(24px); }
    :root[data-theme='night'] &::backdrop { background:#0000004d; }
    input:focus { box-shadow:none !important; }
    @media(max-width:600px) { width:calc(100vw - 16px); margin: max(8px, env(safe-area-inset-top)) auto auto; }
  `}
`;

export function Modal({ open, onClose, title, children, wide = false, compact = false, preview = false, palette = false, dialogRef }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; compact?: boolean; preview?: boolean; palette?: boolean; dialogRef?: RefObject<HTMLDialogElement | null>;
}) {
  const internalRef = useRef<HTMLDialogElement>(null);
  const ref = dialogRef ?? internalRef;
  const titleId = useId();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const dialog = ref.current!;
    if (open) {
      if (!dialog.open) dialog.showModal();
      let secondFrame = 0;
      const frame = requestAnimationFrame(() => {
        if (palette) secondFrame = requestAnimationFrame(() => setVisible(true));
        else setVisible(true);
      });
      return () => { cancelAnimationFrame(frame); cancelAnimationFrame(secondFrame); };
    }
    setVisible(false);
    const duration = palette ? window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200 : 160;
    const timeout = setTimeout(() => dialog.close(), duration);
    return () => clearTimeout(timeout);
  }, [open, palette, ref]);
  return <Sheet ref={ref} $wide={wide} $compact={compact} $preview={preview} $palette={palette} $visible={visible} data-command-palette={palette ? 'true' : undefined} data-state={open ? 'open' : 'closed'} aria-labelledby={titleId} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => {
    if (e.target === e.currentTarget) {
      const rect = e.currentTarget.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) onClose();
    }
  }}>
    <VisuallyHidden id={titleId}>{title}</VisuallyHidden>
    {children}
  </Sheet>;
}
