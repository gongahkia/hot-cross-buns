import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import { Info, X } from 'lucide-react';

export type StatusNotice = { id: number; text: string };
type Phase = 'entering' | 'visible' | 'leaving';
const Toast = styled.div<{ $phase: Phase; $aboveUndo: boolean }>`
  position:fixed;inset:auto;margin:0;z-index:100;bottom:max(${({ $aboveUndo }) => $aboveUndo ? 88 : 16}px,calc(env(safe-area-inset-bottom) + ${({ $aboveUndo }) => $aboveUndo ? 80 : 8}px));right:max(16px,env(safe-area-inset-right));
  display:flex;align-items:flex-start;gap:10px;width:min(420px,calc(100vw - 32px));max-height:50dvh;overflow:auto;padding:8px 6px 8px 14px;
  border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink);box-shadow:0 8px 30px #0003;font:13px/1.5 var(--app-font);
  opacity:${({ $phase }) => $phase === 'visible' ? 1 : 0};transform:translateY(${({ $phase }) => $phase === 'visible' ? 0 : 8}px);
  transition:opacity 160ms ease-out,transform 180ms cubic-bezier(.2,0,0,1);pointer-events:${({ $phase }) => $phase === 'visible' ? 'auto' : 'none'};
  &::backdrop{background:transparent;pointer-events:none;}
`;
const Text = styled.span`flex:1;min-width:0;padding:9px 0;overflow-wrap:anywhere;`;
const Icon = styled(Info)`flex:none;margin-top:11px;color:var(--muted);`;
const Dismiss = styled.button`display:grid;place-items:center;flex:none;width:40px;height:40px;border:0;border-radius:6px;background:transparent;color:var(--muted);&:hover{background:var(--soft);color:var(--ink);}@media(pointer:coarse){width:44px;height:44px;}`;

export function StatusToast({ notice, onDismiss, aboveUndo = false, persistent = false }: { notice: StatusNotice | null; onDismiss: (id: number) => void; aboveUndo?: boolean; persistent?: boolean }) {
  const [displayed, setDisplayed] = useState<StatusNotice | null>(null);
  const [phase, setPhase] = useState<Phase>('entering');
  const [host, setHost] = useState<HTMLElement>(document.body);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const element = useRef<HTMLDivElement>(null);
  const dismiss = useRef(onDismiss); dismiss.current = onDismiss;
  const popover = 'showPopover' in HTMLElement.prototype;
  useEffect(() => {
    if (!notice) { setPhase('leaving'); setHovered(false); setFocused(false); return; }
    setDisplayed(notice); setPhase('entering');
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => { secondFrame = requestAnimationFrame(() => setPhase('visible')); });
    return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame); };
  }, [notice]);
  useEffect(() => {
    if (!notice || hovered || focused || persistent) return;
    const timeout = window.setTimeout(() => dismiss.current(notice.id), 8000);
    return () => clearTimeout(timeout);
  }, [notice, hovered, focused, persistent]);
  useEffect(() => {
    if (phase !== 'leaving' || !displayed) return;
    const timeout = window.setTimeout(() => setDisplayed(current => current === displayed ? null : current), 180);
    return () => clearTimeout(timeout);
  }, [phase, displayed]);
  useEffect(() => {
    if (!displayed) return;
    // keep notifications accessible above a modal, and move them out when it closes.
    const locate = () => setHost([...document.querySelectorAll<HTMLDialogElement>('dialog[open]:not([data-state="closed"])')].at(-1) ?? document.body);
    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open', 'data-state'] });
    return () => observer.disconnect();
  }, [!!displayed]);
  useLayoutEffect(() => {
    const toast = element.current;
    if (!toast || !popover || !displayed) return;
    try { toast.showPopover(); } catch { toast.removeAttribute('popover'); }
    return () => { try { toast.hidePopover(); } catch { /* a removed or closed popover needs no cleanup. */ } };
  }, [displayed, host, popover]);
  if (!displayed) return null;
  return createPortal(<Toast ref={element} popover={popover ? 'manual' : undefined} $phase={phase} $aboveUndo={aboveUndo} data-phase={phase} role="status" aria-label="Notification" aria-live="polite" aria-atomic="true" aria-hidden={phase !== 'visible'} inert={phase !== 'visible'}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <Icon size={17} aria-hidden="true"/><Text>{displayed.text}</Text><Dismiss type="button" aria-label="Dismiss message" onClick={() => dismiss.current(displayed.id)}><X size={16} aria-hidden="true"/></Dismiss>
  </Toast>, host);
}
