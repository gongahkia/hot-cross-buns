// keyboard shortcuts service for power-user productivity

export interface ShortcutCallbacks {
  focusQuickAdd: () => void;
  closeDetail: () => void;
  deleteSelectedTask: () => void;
  setPriority: (level: number) => void;
  switchToToday: () => void;
  switchToCalendar: () => void;
  showShortcutsModal: () => void;
}

export function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

export function registerShortcuts(callbacks: ShortcutCallbacks): () => void {
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      callbacks.closeDetail();
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      return;
    }
    if (isInputFocused()) return;
    switch (e.key) {
      case 'n': e.preventDefault(); callbacks.focusQuickAdd(); break;
      case 'Delete':
      case 'Backspace': e.preventDefault(); callbacks.deleteSelectedTask(); break;
      case '1': e.preventDefault(); callbacks.setPriority(1); break;
      case '2': e.preventDefault(); callbacks.setPriority(2); break;
      case '3': e.preventDefault(); callbacks.setPriority(3); break;
      case '0': e.preventDefault(); callbacks.setPriority(0); break;
      case 't': e.preventDefault(); callbacks.switchToToday(); break;
      case 'c': e.preventDefault(); callbacks.switchToCalendar(); break;
      case '?': e.preventDefault(); callbacks.showShortcutsModal(); break;
    }
  }
  document.addEventListener('keydown', handleKeydown);
  return () => { document.removeEventListener('keydown', handleKeydown); };
}
