import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { Search, type LucideIcon } from 'lucide-react';
import { Modal } from './Modal';

export const commandKey = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
export type PaletteCommand = {
  id: 'search' | 'import' | 'download' | 'window' | 'settings';
  label: string; keywords: string; icon: LucideIcon; run: () => void;
};
const SearchRow = styled.div`display:flex;align-items:center;gap:8px;height:48px;flex-shrink:0;padding:0 12px;border-bottom:1px solid var(--line);color:var(--muted);`;
const Input = styled.input`width:100%;min-width:0;height:100%;padding:0;border:0;background:transparent;color:var(--ink);font-size:14px;outline:none;::placeholder{color:var(--muted);}@media(pointer:coarse){font-size:16px;}`;
const Options = styled.div`min-height:0;max-height:300px;overflow-y:auto;overflow-x:hidden;padding:4px 8px;scroll-padding-block:4px;overscroll-behavior:contain;`;
const Option = styled.button`display:flex;align-items:center;gap:10px;min-height:44px;width:100%;padding:10px 8px;border:0;border-radius:6px;background:transparent;color:var(--ink);font-size:14px;text-align:left;transition:background 100ms ease-out;&[aria-selected='true']{background:var(--soft);}svg{color:var(--muted);}span{flex:1;min-width:0;}`;
const Empty = styled.p`padding:24px 12px;text-align:center;font-size:13px;color:var(--muted);`;
const Footer = styled.div`display:flex;align-items:center;gap:16px;flex-shrink:0;padding:8px 12px;border-top:1px solid var(--line);font-size:12px;color:var(--muted);span,button{display:inline-flex;align-items:center;gap:4px;}button{min-height:28px;margin-left:auto;padding:0;border:0;border-radius:4px;background:transparent;font-size:12px;color:inherit;}kbd{padding:1px 4px;border-radius:4px;background:var(--soft);font:inherit;}@media(pointer:coarse){button{min-height:44px;}}`;

export function CommandPalette({ open, commands, onOpenChange }: {
  open: boolean; commands: PaletteCommand[]; onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const filtered = commands.filter(command => words.every(word => (command.label + ' ' + command.keywords).toLowerCase().includes(word)));
  const index = Math.min(highlighted, filtered.length - 1);
  const selectedId = index >= 0 ? listId + '-' + filtered[index].id : undefined;
  useLayoutEffect(() => { if (open) { setQuery(''); setHighlighted(0); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => input.current?.focus());
    const viewport = () => dialog.current?.style.setProperty('--palette-viewport-height', (visualViewport?.height ?? innerHeight) + 'px');
    viewport(); visualViewport?.addEventListener('resize', viewport);
    return () => { cancelAnimationFrame(frame); visualViewport?.removeEventListener('resize', viewport); };
  }, [open]);
  useEffect(() => {
    if (open && selectedId) document.getElementById(selectedId)?.scrollIntoView({ block: 'nearest' });
  }, [open, selectedId]);
  const run = (command: PaletteCommand | undefined) => {
    if (!open || !command) return;
    // release modal focus and inertness before dispatching browser-activated actions.
    dialog.current?.close();
    onOpenChange(false);
    command.run();
  };
  return <Modal open={open} palette dialogRef={dialog} onClose={() => onOpenChange(false)} title="Command palette">
    <SearchRow><Search size={20} aria-hidden="true"/><Input ref={input} role="combobox" aria-label="Filter commands" aria-autocomplete="list" aria-expanded={open} aria-controls={listId} aria-activedescendant={selectedId} autoComplete="off" spellCheck={false} placeholder="Type a command…" value={query}
      onChange={event => { setQuery(event.target.value); setHighlighted(0); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Tab') { event.preventDefault(); closeButton.current?.focus(); return; }
        if (!event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? filtered.length - 1 : event.key === 'ArrowDown' ? index + 1 : index - 1;
          setHighlighted(Math.max(0, Math.min(next, filtered.length - 1)));
        }
        if (event.key === 'Enter') { event.preventDefault(); run(filtered[index]); }
      }}/></SearchRow>
    <Options id={listId} role="listbox" aria-label="Commands">
      {filtered.map((command, position) => <Option key={command.id} id={listId + '-' + command.id} type="button" role="option" aria-label={command.label} aria-selected={position === index} tabIndex={-1} onMouseDown={event => event.preventDefault()} onPointerMove={() => setHighlighted(position)} onClick={() => run(command)}>
        <command.icon size={17} aria-hidden="true"/><span>{command.label}</span>
      </Option>)}
      {!filtered.length && <Empty role="status">No matching commands.</Empty>}
    </Options>
    <Footer><span><span aria-hidden="true">↑↓</span> Navigate</span><span><span aria-hidden="true">↵</span> Select</span><button ref={closeButton} type="button" aria-label="Close command palette" onClick={() => onOpenChange(false)} onKeyDown={event => { if (event.key === 'Tab') { event.preventDefault(); input.current?.focus(); } }}><kbd>esc</kbd> Close</button></Footer>
  </Modal>;
}
