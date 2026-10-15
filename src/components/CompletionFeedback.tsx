import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { Check, X } from 'lucide-react';

type Notice = { text: string };
type Phase = 'entering' | 'visible' | 'leaving';

const Toast = styled.div<{ $phase: Phase }>`
  position: fixed; z-index: 60; bottom: max(20px, calc(env(safe-area-inset-bottom) + 12px)); left: 50%;
  transform: translate(-50%, ${({ $phase }) => $phase === 'entering' ? '8px' : $phase === 'leaving' ? '-6px' : '0'});
  opacity: ${({ $phase }) => $phase === 'visible' ? 1 : 0};
  transition: opacity ${({ $phase }) => $phase === 'leaving' ? '140ms' : '180ms'} ease-out,
    transform ${({ $phase }) => $phase === 'leaving' ? '140ms' : '180ms'} cubic-bezier(.2, 0, 0, 1);
  pointer-events: ${({ $phase }) => $phase === 'visible' ? 'auto' : 'none'};
  width: max-content; max-width: calc(100vw - 24px); min-height: 52px; display: flex; align-items: center; gap: 10px;
  padding: 5px 6px 5px 14px; border: 1px solid var(--line); border-radius: 10px;
  background: var(--surface); color: var(--ink); box-shadow: 0 8px 30px #0002; font-size: 13px;
`;
const Text = styled.span`min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const Undo = styled.button`min-height: 40px; flex: none; padding: 5px 10px; border: 0; border-radius: 6px; background: transparent; color: var(--link); font-size: 13px; &:hover { background: var(--soft); } @media(pointer:coarse){min-height:44px;}`;
const Dismiss = styled.button`width: 40px; height: 40px; flex: none; display: grid; place-items: center; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--muted); &:hover { background: var(--soft); color: var(--ink); } @media(pointer:coarse){width:44px;height:44px;}`;

export function CompletionFeedback({ notice, onUndo, onDismiss }: { notice: Notice | null; onUndo: () => void; onDismiss: () => void }) {
  const [displayed, setDisplayed] = useState<Notice | null>(null);
  const [phase, setPhase] = useState<Phase>('entering');

  useEffect(() => {
    if (!notice) { setPhase('leaving'); return; }
    setDisplayed(notice);
    setPhase('entering');
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => setPhase('visible'));
    });
    return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame); };
  }, [notice]);

  useEffect(() => {
    if (phase !== 'leaving' || !displayed) return;
    const timeout = window.setTimeout(() => setDisplayed(null), 160);
    return () => window.clearTimeout(timeout);
  }, [phase, displayed]);

  if (!displayed) return null;
  return <Toast $phase={phase} data-phase={phase} role="status" aria-label="Completion confirmation" aria-hidden={phase !== 'visible'} inert={phase !== 'visible'}>
    <Check size={16} color="var(--link)" aria-hidden="true"/>
    <Text title={displayed.text}>Moved to Done: {displayed.text}</Text>
    <Undo type="button" aria-label={`Undo completion of ${displayed.text}`} onClick={onUndo}>Undo</Undo>
    <Dismiss type="button" aria-label="Dismiss completion confirmation" onClick={onDismiss}><X size={15}/></Dismiss>
  </Toast>;
}
