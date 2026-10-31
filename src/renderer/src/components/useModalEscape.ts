import { useLayoutEffect, useRef } from 'react';

type Entry = { close: () => void; priority: number };
const stack: Entry[] = [];
const handleEscape = (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || !stack.length) return;
  const top = stack.reduce((a, b) => b.priority >= a.priority ? b : a);
  // Consume Escape before document-level Radix listeners and shell shortcuts.
  // Radix updates its highest-layer listeners in a passive effect; that leaves
  // a brief window where a newly painted child can dismiss its parent instead.
  event.preventDefault();
  event.stopImmediatePropagation();
  top.close();
};

export function useModalEscape(open: boolean, close: () => void, priority = 80): void {
  const callback = useRef(close);
  callback.current = close;
  useLayoutEffect(() => {
    if (!open) return;
    const entry: Entry = { close: () => callback.current(), priority };
    stack.push(entry);
    if (stack.length === 1) window.addEventListener('keydown', handleEscape, true);
    return () => {
      const index = stack.indexOf(entry);
      if (index !== -1) stack.splice(index, 1);
      if (!stack.length) window.removeEventListener('keydown', handleEscape, true);
    };
  }, [open, priority]);
}
