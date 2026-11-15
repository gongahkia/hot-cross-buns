import { useEffect, useState } from 'react';

/** Editor leases defer incoming integration across tabs without blocking persisted outgoing edits. */
export function useJournalEditing() {
  const [draft, setDraft] = useState(false);
  useEffect(() => {
    let release: (() => void) | undefined;
    let acquiring = false, generation = 0;
    let editor: HTMLInputElement | HTMLTextAreaElement | null = null;
    let initial = '';
    const wanted = () => !!editor || !!document.querySelector('dialog[open][data-journal-editor="true"]:not([data-state="closed"])');
    const updateLease = () => {
      if (editor && (!editor.isConnected || document.activeElement !== editor)) { editor = null; setDraft(false); }
      if (!wanted()) { generation++; release?.(); release = undefined; acquiring = false; return; }
      if (release || acquiring || !navigator.locks) return;
      acquiring = true; const token = ++generation;
      void navigator.locks.request('hot-cross-buns-journal-editor', { mode: 'shared' }, () => new Promise<void>(resolve => {
        if (token !== generation || !wanted()) { resolve(); return; }
        acquiring = false; release = resolve;
      })).catch(() => { acquiring = false; });
    };
    const leave = () => { editor = null; setDraft(false); updateLease(); };
    const focus = () => {
      const active = document.activeElement;
      if (!(active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement && ['text', 'search', 'email', 'url', 'tel'].includes(active.type)) || active.closest('dialog') || active.getAttribute('aria-label') === 'Scratchpad text') { leave(); return; }
      if (active === editor) return;
      editor = active; initial = active.value; setDraft(false); updateLease();
    };
    const input = () => setDraft(!!editor && editor.value !== initial);
    const hide = () => { if (document.visibilityState === 'hidden') editor?.blur(); };
    const unload = (event: BeforeUnloadEvent) => { if (editor && editor.value !== initial) { event.preventDefault(); event.returnValue = ''; } };
    const observer = new MutationObserver(updateLease);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open', 'data-state', 'data-journal-editor'] });
    document.addEventListener('input', input); document.addEventListener('focusin', focus); document.addEventListener('focusout', leave); document.addEventListener('visibilitychange', hide); window.addEventListener('beforeunload', unload);
    focus();
    return () => { observer.disconnect(); generation++; release?.(); document.removeEventListener('input', input); document.removeEventListener('focusin', focus); document.removeEventListener('focusout', leave); document.removeEventListener('visibilitychange', hide); window.removeEventListener('beforeunload', unload); };
  }, []);
  return draft;
}
