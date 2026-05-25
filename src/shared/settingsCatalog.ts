export const hotkeyActionIds = [
  "task.create",
  "task.quickCapture",
  "note.create",
  "calendar.create",
  "commandPalette.open",
  "print.today",
  "sync.refresh",
  "sync.forceFullResync",
  "navigation.today",
  "navigation.tasks",
  "navigation.calendar",
  "navigation.notes",
  "navigation.search",
  "navigation.settings",
  "navigation.sidebar.toggle",
  "navigation.notifications.toggle",
  "calendar.view.agenda",
  "calendar.view.day",
  "calendar.view.multiDay",
  "calendar.view.week",
  "calendar.view.month"
] as const;

export type HotkeyActionId = (typeof hotkeyActionIds)[number];

export const defaultKeybindings: Record<HotkeyActionId, string | null> = {
  "task.create": "CmdOrCtrl+N",
  "task.quickCapture": "CmdOrCtrl+Shift+Space",
  "note.create": "CmdOrCtrl+Shift+N",
  "calendar.create": "CmdOrCtrl+Shift+E",
  "commandPalette.open": "CmdOrCtrl+P",
  "print.today": "CmdOrCtrl+Shift+P",
  "sync.refresh": "CmdOrCtrl+R",
  "sync.forceFullResync": "CmdOrCtrl+Shift+R",
  "navigation.today": "CmdOrCtrl+0",
  "navigation.tasks": "CmdOrCtrl+1",
  "navigation.calendar": "CmdOrCtrl+2",
  "navigation.notes": "CmdOrCtrl+3",
  "navigation.search": "CmdOrCtrl+4",
  "navigation.settings": "CmdOrCtrl+,",
  "navigation.sidebar.toggle": "CmdOrCtrl+S",
  "navigation.notifications.toggle": "CmdOrCtrl+Shift+A",
  "calendar.view.agenda": "CmdOrCtrl+Alt+1",
  "calendar.view.day": "CmdOrCtrl+Alt+2",
  "calendar.view.multiDay": "CmdOrCtrl+Alt+3",
  "calendar.view.week": "CmdOrCtrl+Alt+4",
  "calendar.view.month": "CmdOrCtrl+Alt+5"
};

export const historyCategoryIds = [
  "created",
  "edited",
  "deleted",
  "completedReopened",
  "duplicated",
  "movedBetweenLists",
  "clipboard",
  "restored",
  "bulkActions",
  "syncDiffs",
  "other"
] as const;

export type HistoryCategoryId = (typeof historyCategoryIds)[number];

export const defaultHistoryCategoryVisibility: Record<HistoryCategoryId, boolean> = {
  created: true,
  edited: true,
  deleted: true,
  completedReopened: true,
  duplicated: true,
  movedBetweenLists: true,
  clipboard: true,
  restored: true,
  bulkActions: true,
  syncDiffs: false,
  other: true
};
