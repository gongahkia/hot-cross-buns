import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { ArrowLeft, FileText, Search, X, type LucideIcon } from 'lucide-react';
import { Modal } from './Modal';

export const commandKey = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
export type PaletteCommand = {
  id: 'search' | 'import' | 'download' | 'window' | 'settings' | 'history' | 'source' | 'outlines';
  hidden?: boolean;
  label: string; keywords: string; icon: LucideIcon; run: () => void;
};
export type PaletteResult = {
  id: string; itemId: string; kind: 'dated' | 'undated'; location: string;
  label: string; context: string; detail?: string; completed: boolean;
};
export type CompletionFilter = 'all' | 'open' | 'done';
const SearchRow = styled.div`display:flex;align-items:center;gap:8px;height:48px;flex-shrink:0;padding:0 12px;border-bottom:1px solid var(--line);color:var(--muted);button{display:grid;place-items:center;flex-shrink:0;width:32px;height:40px;padding:0;border:0;border-radius:4px;background:transparent;color:inherit;}`;
const Input = styled.input`width:100%;min-width:0;height:100%;padding:0 4px 0 0;border:0;background:transparent;color:var(--ink);font-size:14px;outline:none;::placeholder{color:var(--muted);}@media(pointer:coarse){font-size:16px;}`;
const Body = styled.div`min-height:0;max-height:420px;overflow-y:auto;overflow-x:hidden;scroll-padding-block:4px;overscroll-behavior:contain;`;
const Options = styled.div`padding:4px 8px;`;
const Option = styled.button`display:flex;align-items:center;gap:10px;min-height:44px;width:100%;padding:10px 8px;border:0;border-radius:6px;background:transparent;color:var(--ink);font-size:14px;text-align:left;transition:background 100ms ease-out;&[aria-selected='true']{background:var(--soft);}svg{color:var(--muted);flex-shrink:0;}&>span{flex:1;min-width:0;}`;
const ResultText = styled.span`strong,small{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}strong{font-weight:400;}small{margin-top:3px;font-size:12px;color:var(--muted);}`;
const GroupLabel = styled.div`padding:7px 8px 3px;font-size:11px;color:var(--muted);`;
const Empty = styled.p`padding:18px 12px;text-align:center;font-size:13px;color:var(--muted);`;
const Filters = styled.div`display:flex;align-items:center;gap:4px;flex-wrap:wrap;flex-shrink:0;padding:4px 8px;border-bottom:1px solid var(--line);button{min-height:36px;padding:4px 10px;border:0;border-radius:5px;background:transparent;color:var(--muted);font-size:12px;&[aria-pressed='true'],&:hover{background:var(--soft);color:var(--ink);}}@media(pointer:coarse){button{min-height:44px;}}`;
const Tags = styled(Filters)`max-height:76px;overflow-y:auto;overscroll-behavior:contain;button{min-height:32px;}@media(pointer:coarse){button{min-height:44px;}}`;
const Footer = styled.div`display:flex;align-items:center;gap:16px;flex-shrink:0;padding:8px 12px;border-top:1px solid var(--line);font-size:12px;color:var(--muted);span,button{display:inline-flex;align-items:center;gap:4px;}button{min-height:28px;margin-left:auto;padding:0;border:0;border-radius:4px;background:transparent;font-size:12px;color:inherit;}kbd{padding:1px 4px;border-radius:4px;background:var(--soft);font:inherit;}@media(pointer:coarse){button{min-height:44px;}}`;

export function CommandPalette({ open, commands, onOpenChange, query, onQueryChange, mode, onCommands, focusRequest, scope, completion, onCompletionChange, results, searchError, onSelectResult, tags, tag, onTagChange }: {
  open: boolean; commands: PaletteCommand[]; onOpenChange: (open: boolean) => void;
  query: string; onQueryChange: (query: string) => void; mode: 'commands' | 'journal'; onCommands: () => void; focusRequest: number;
  scope: 'dated' | 'undated' | null; completion: CompletionFilter; onCompletionChange: (filter: CompletionFilter) => void;
  tags: string[]; tag: string | null; onTagChange: (tag: string | null) => void;
  results: PaletteResult[]; searchError: string | null; onSelectResult: (result: PaletteResult) => void;
}) {
  const [highlighted, setHighlighted] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const searching = !!scope && (mode === 'journal' || !!query.trim() || !!tag || completion !== 'all');
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const filtered = mode === 'commands' ? commands.filter(command => (!command.hidden || words.length > 0) && words.every(word => (command.label + ' ' + command.keywords).toLowerCase().includes(word))) : [];
  const shownResults = searching && !searchError ? results.slice(0, 50) : [];
  const count = filtered.length + shownResults.length;
  const index = Math.min(highlighted, count - 1);
  const selectedId = index >= 0 ? listId + '-' + index : undefined;
  useLayoutEffect(() => setHighlighted(0), [open, query, mode, completion]);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => { input.current?.focus(); if (focusRequest) input.current?.select(); });
    const viewport = () => dialog.current?.style.setProperty('--palette-viewport-height', (visualViewport?.height ?? innerHeight) + 'px');
    const trapTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const controls = [...dialog.current!.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button:not([tabindex="-1"])')].filter(control => !control.disabled && control.getClientRects().length);
      const current = controls.indexOf(document.activeElement as HTMLInputElement);
      event.preventDefault(); controls[(current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
    };
    viewport(); visualViewport?.addEventListener('resize', viewport); dialog.current!.addEventListener('keydown', trapTab);
    const element = dialog.current!;
    return () => { cancelAnimationFrame(frame); visualViewport?.removeEventListener('resize', viewport); element.removeEventListener('keydown', trapTab); };
  }, [open, mode, focusRequest]);
  useEffect(() => { if (open && selectedId) document.getElementById(selectedId)?.scrollIntoView({ block: 'nearest' }); }, [open, selectedId, query, completion, mode]);
  const run = (position: number) => {
    if (!open || position < 0) return;
    const command = filtered[position];
    if (command?.id === 'search') { command.run(); return; }
    const result = shownResults[position - filtered.length];
    if (!command && !result) return;
    // release modal focus before dispatching browser actions or focusing a journal entry.
    dialog.current?.close(); onOpenChange(false);
    if (command) command.run(); else onSelectResult(result);
  };
  const optionProps = (position: number) => ({ id: listId + '-' + position, role: 'option', 'aria-selected': position === index, tabIndex: -1, onMouseDown: (event: React.MouseEvent) => event.preventDefault(), onPointerMove: () => setHighlighted(position), onClick: () => run(position) });
  return <Modal open={open} palette dialogRef={dialog} onClose={() => onOpenChange(false)} title="Command palette">
    <SearchRow>{mode === 'journal' ? <button type="button" aria-label="Back to commands" onClick={onCommands}><ArrowLeft size={18}/></button> : <Search size={20} aria-hidden="true"/>}
      <Input ref={input} role="combobox" aria-label="Search commands and journal" aria-autocomplete="list" aria-expanded={open} aria-controls={listId} aria-activedescendant={selectedId} autoComplete="off" spellCheck={false} placeholder={mode === 'journal' ? 'Search journal…' : scope ? 'Type a command or search…' : 'Type a command…'} value={query}
        onChange={event => onQueryChange(event.target.value)} onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (count > 0 && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : event.key === 'ArrowDown' ? index + 1 : index - 1;
            setHighlighted(Math.max(0, Math.min(next, count - 1)));
          }
          if (event.key === 'Enter') { event.preventDefault(); run(index); }
        }}/>
      <button type="button" aria-label="Clear search" disabled={!query} aria-hidden={!query} style={{ visibility: query ? 'visible' : 'hidden' }} onMouseDown={event => event.preventDefault()} onClick={() => { onQueryChange(''); input.current?.focus(); }}><X size={16}/></button>
    </SearchRow>
    <Body>
    {searching && scope === 'dated' && <Filters role="group" aria-label="Search completion">{(['all', 'open', 'done'] as const).map(value => <button key={value} type="button" aria-label={value === 'all' ? 'All statuses' : value === 'open' ? 'Open items' : 'Done items'} aria-pressed={completion === value} onClick={() => onCompletionChange(value)}>{value === 'all' ? 'All' : value === 'open' ? 'Open' : 'Done'}</button>)}</Filters>}
    {searching && !!tags.length && <Tags as="nav" aria-label="Tags"><button type="button" aria-label="All tags" aria-pressed={!tag} onClick={() => onTagChange(null)}>all</button>{tags.map(name => <button key={name} type="button" aria-pressed={tag === name} onClick={() => onTagChange(tag === name ? null : name)}>#{name}</button>)}</Tags>}
    <Options id={listId} role="listbox" aria-label="Commands and journal entries">
      {filtered.map((command, position) => <Option key={command.id} type="button" aria-label={command.label} {...optionProps(position)}><command.icon size={17} aria-hidden="true"/><span>{command.label}</span></Option>)}
      {searching && !searchError && <div role="group" aria-label={scope === 'dated' ? 'Dated entries' : 'Undated entries'}>
        <GroupLabel aria-live="polite">{results.length} {results.length === 1 ? 'entry' : 'entries'}{results.length > 50 ? ' · showing first 50, refine your search' : ''}</GroupLabel>
        {shownResults.map((result, position) => <Option key={result.id} type="button" aria-label={`${result.label} · ${result.context}${result.detail ? ' · ' + result.detail : ''}`} {...optionProps(filtered.length + position)}><FileText size={17} aria-hidden="true"/><ResultText><strong>{result.label}</strong><small>{result.context}{result.detail ? ' · ' + result.detail : ''}</small></ResultText></Option>)}
      </div>}
      {searching && searchError && <Empty role="alert">{searchError}</Empty>}
      {!count && !searchError && <Empty role="status">{searching ? 'No matching entries or commands.' : 'No matching commands.'}</Empty>}
    </Options>
    </Body>
    <Footer><span><span aria-hidden="true">↑↓</span> Navigate</span><span><span aria-hidden="true">↵</span> Select</span><button type="button" aria-label="Close command palette" onClick={() => onOpenChange(false)}><kbd>esc</kbd> Close</button></Footer>
  </Modal>;
}
