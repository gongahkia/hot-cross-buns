import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import styled from 'styled-components';
import { VisuallyHidden } from '../styles';

const Sheet = styled.dialog<{ $visible: boolean; $wide: boolean; $compact: boolean }>`
  width: min(${({ $wide, $compact }) => $compact ? '420px' : $wide ? '720px' : '620px'}, calc(100vw - 32px)); max-height: calc(100dvh - 40px);
  padding: ${({ $compact }) => $compact ? '12px' : '32px'}; border: 0; border-radius: 16px; color: var(--ink); background: var(--surface);
  box-shadow: ${({ $compact }) => $compact ? '' : '0 0 0 1px #00000008,'} 0 16px 60px #202a2526; overflow-y: auto;
  opacity: ${({ $visible }) => $visible ? 1 : 0}; transform: translateY(${({ $visible }) => $visible ? '0' : '8px'});
  transition: opacity 160ms ease-out, transform 160ms ease-out;
  &::backdrop { background: var(--backdrop); backdrop-filter: blur(3px); }
  @media (max-width: 500px) {
    width: calc(100vw - 16px); max-height: calc(100dvh - max(16px, env(safe-area-inset-top)) - max(16px, env(safe-area-inset-bottom)));
    padding: ${({ $compact }) => $compact ? '12px' : '22px 18px'}; border-radius: 18px;
  }
`;

export function Modal({ open, onClose, title, children, wide = false, compact = false }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; compact?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const dialog = ref.current!;
    if (open) {
      if (!dialog.open) dialog.showModal();
      const frame = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(frame);
    }
    setVisible(false);
    const timeout = setTimeout(() => dialog.close(), 160);
    return () => clearTimeout(timeout);
  }, [open]);
  return <Sheet ref={ref} $wide={wide} $compact={compact} $visible={visible} aria-labelledby={titleId} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => {
    if (e.target === e.currentTarget) {
      const rect = e.currentTarget.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) onClose();
    }
  }}>
    <VisuallyHidden id={titleId}>{title}</VisuallyHidden>
    {children}
  </Sheet>;
}
