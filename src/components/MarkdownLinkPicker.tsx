import { useId, useMemo, useState } from 'react';
import styled from 'styled-components';
import { suggestMarkdownLinks, type MarkdownNavigation, type MarkdownTarget } from '../markdownNavigation';
import { Button, Field, Muted } from '../styles';

const Picker = styled.div`margin:8px 0;padding:8px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);input{width:100%;min-height:40px;}[role=listbox]{max-height:220px;overflow:auto;margin:6px 0;}button[role=option]{display:block;width:100%;min-height:40px;padding:6px 8px;border:0;border-radius:4px;background:transparent;color:var(--ink);font:inherit;text-align:left;}button[aria-selected=true],button[role=option]:hover{background:var(--soft);}small{display:block;color:var(--muted);font-size:11px;}@media(pointer:coarse){input,button[role=option]{min-height:44px;}}`;

export function MarkdownLinkPicker({ navigation, onSelect, onClose }: { navigation: MarkdownNavigation; onSelect: (target: MarkdownTarget) => void; onClose: () => void }) {
  const [query, setQuery] = useState(''), [active, setActive] = useState(0), id = useId();
  const targets = useMemo(() => suggestMarkdownLinks(navigation, query), [navigation, query]);
  const selected = Math.min(active, Math.max(0, targets.length - 1));
  return <Picker aria-label="Insert Markdown link">
    <Field autoFocus role="combobox" aria-label="Find an entry or heading" aria-expanded="true" aria-controls={`${id}-results`} aria-activedescendant={targets.length ? `${id}-${selected}` : undefined} value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} onKeyDown={event => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive((selected + (event.key === 'ArrowDown' ? 1 : -1) + targets.length) % Math.max(1, targets.length)); }
      if (event.key === 'Enter' && targets[selected]) { event.preventDefault(); onSelect(targets[selected]); }
    }}/>
    <div role="listbox" id={`${id}-results`} aria-label="Link destinations">{targets.map((target, index) => <button key={`${target.kind}:${target.range.start}`} id={`${id}-${index}`} role="option" aria-selected={selected === index} type="button" tabIndex={-1} onMouseDown={event => event.preventDefault()} onClick={() => onSelect(target)}>{target.label}<small>{target.kind === 'heading' ? 'Heading' : target.date ?? target.list}</small></button>)}{!targets.length && <Muted>No matching entry or heading.</Muted>}</div>
    <Button type="button" onClick={onClose}>Cancel link</Button>
  </Picker>;
}
