// Keyboard shortcuts service for power-user productivity

export interface ShortcutCallbacks {
  focusQuickAdd: () => void;
  closeDetail: () => void;
  deleteSelectedTask: () => void;
  setPriority: (level: number) => void;
  switchToToday: () => void;
  switchToCalendar: () => void;
  switchToWeek: () => void;
  switchToSchedule: () => void;
  switchToUpcoming: () => void;
  switchToNext7Days: () => void;
  showShortcutsModal: () => void;
}

/**
 * Returns true when the currently focused element is a text input,
 * textarea, select, or any element with contenteditable.
 * Shortcuts should be suppressed while the user is typing.
 */
export function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

/**
 * Registers a global keydown listener that dispatches to the provided
 * callbacks. Returns a cleanup function that removes the listener.
 */
export function registerShortcuts(callbacks: ShortcutCallbacks): () => void {
  function handleKeydown(e: KeyboardEvent) {
    // Escape always works, even when input is focused
    if (e.key === 'Escape') {
      callbacks.closeDetail();
      // Also blur the active element so subsequent shortcuts work
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      return;
    }

    // All other shortcuts are suppressed when an input is focused
    if (isInputFocused()) return;

    switch (e.key) {
      case 'n':
        e.preventDefault();
        callbacks.focusQuickAdd();
        break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        callbacks.deleteSelectedTask();
        break;
      case '1':
        e.preventDefault();
        callbacks.setPriority(1);
        break;
      case '2':
        e.preventDefault();
        callbacks.setPriority(2);
        break;
      case '3':
        e.preventDefault();
        callbacks.setPriority(3);
        break;
      case '0':
        e.preventDefault();
        callbacks.setPriority(0);
        break;
      case 't':
        e.preventDefault();
        callbacks.switchToToday();
        break;
      case 'c':
        e.preventDefault();
        callbacks.switchToCalendar();
        break;
      case 'w':
        e.preventDefault();
        callbacks.switchToWeek();
        break;
      case 's':
        e.preventDefault();
        callbacks.switchToSchedule();
        break;
      case 'u':
        e.preventDefault();
        callbacks.switchToUpcoming();
        break;
      case '7':
        e.preventDefault();
        callbacks.switchToNext7Days();
        break;
      case '?':
        e.preventDefault();
        callbacks.showShortcutsModal();
        break;
    }
  }

  document.addEventListener('keydown', handleKeydown);

  return () => {
    document.removeEventListener('keydown', handleKeydown);
  };
}
