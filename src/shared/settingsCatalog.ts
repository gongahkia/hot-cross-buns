export const hotkeyActionIds = [
  "task.create",
  "note.create",
  "calendar.create",
  "quickAdd.open",
  "commandPalette.open",
  "actionPalette.open",
  "print.today",
  "sync.refresh",
  "sync.forceFullResync",
  "undo.perform",
  "redo.perform",
  "navigation.today",
  "navigation.tasks",
  "navigation.calendar",
  "navigation.notes",
  "navigation.search",
  "navigation.settings",
  "navigation.diagnostics.toggle",
  "navigation.sidebar.toggle",
  "navigation.notifications.toggle",
  "pane.create",
  "pane.close",
  "pane.split.horizontal",
  "pane.split.vertical",
  "pane.focus.left",
  "pane.focus.right",
  "pane.focus.up",
  "pane.focus.down",
  "web.tab.create",
  "calendar.view.agenda",
  "calendar.view.day",
  "calendar.view.multiDay",
  "calendar.view.week",
  "calendar.view.month"
] as const;

export type HotkeyActionId = (typeof hotkeyActionIds)[number];

export const navigationTabIds = ["calendar", "tasks", "notes"] as const;
export type NavigationTabId = (typeof navigationTabIds)[number];
export const defaultNavigationTabOrder: NavigationTabId[] = ["calendar", "tasks", "notes"];

export const toolbarActionIds = [
  "commandPalette",
  "notifications",
  "diagnostics",
  "splitPane",
  "refresh",
  "settings"
] as const;
export type ToolbarActionId = (typeof toolbarActionIds)[number];
export const defaultToolbarActionOrder: ToolbarActionId[] = [
  "commandPalette",
  "notifications",
  "diagnostics",
  "splitPane",
  "refresh",
  "settings"
];

export const defaultKeybindings: Record<HotkeyActionId, string | null> = {
  "task.create": "CmdOrCtrl+N",
  "note.create": "CmdOrCtrl+Shift+N",
  "calendar.create": "CmdOrCtrl+Shift+E",
  "quickAdd.open": null,
  "commandPalette.open": "CmdOrCtrl+P",
  "actionPalette.open": "CmdOrCtrl+Shift+P",
  "print.today": null,
  "sync.refresh": "CmdOrCtrl+R",
  "sync.forceFullResync": "CmdOrCtrl+Shift+R",
  "undo.perform": "CmdOrCtrl+Z",
  "redo.perform": "CmdOrCtrl+Shift+Z",
  "navigation.today": "CmdOrCtrl+0",
  "navigation.tasks": "CmdOrCtrl+1",
  "navigation.calendar": "CmdOrCtrl+2",
  "navigation.notes": "CmdOrCtrl+3",
  "navigation.search": "CmdOrCtrl+4",
  "navigation.settings": "CmdOrCtrl+,",
  "navigation.diagnostics.toggle": "CmdOrCtrl+.",
  "navigation.sidebar.toggle": "CmdOrCtrl+S",
  "navigation.notifications.toggle": "CmdOrCtrl+Shift+A",
  "pane.create": null,
  "pane.close": "CmdOrCtrl+W",
  "pane.split.horizontal": "CmdOrCtrl+D",
  "pane.split.vertical": "CmdOrCtrl+Shift+D",
  "pane.focus.left": "CmdOrCtrl+Alt+Left",
  "pane.focus.right": "CmdOrCtrl+Alt+Right",
  "pane.focus.up": "CmdOrCtrl+Alt+Up",
  "pane.focus.down": "CmdOrCtrl+Alt+Down",
  "web.tab.create": "CmdOrCtrl+T",
  "calendar.view.agenda": "CmdOrCtrl+Alt+1",
  "calendar.view.day": "CmdOrCtrl+Alt+2",
  "calendar.view.multiDay": "CmdOrCtrl+Alt+3",
  "calendar.view.week": "CmdOrCtrl+Alt+4",
  "calendar.view.month": "CmdOrCtrl+Alt+5"
};

export const defaultLeaderKey = "CmdOrCtrl+K";

export const defaultLeaderKeybindings: Record<HotkeyActionId, string | null> = {
  "task.create": "T",
  "note.create": "N",
  "calendar.create": "E",
  "quickAdd.open": "A",
  "commandPalette.open": "O",
  "actionPalette.open": "P",
  "print.today": null,
  "sync.refresh": "R",
  "sync.forceFullResync": "Shift+R",
  "undo.perform": "U",
  "redo.perform": "Shift+U",
  "navigation.today": "0",
  "navigation.tasks": "1",
  "navigation.calendar": "2",
  "navigation.notes": "3",
  "navigation.search": "S",
  "navigation.settings": ",",
  "navigation.diagnostics.toggle": ".",
  "navigation.sidebar.toggle": "B",
  "navigation.notifications.toggle": "I",
  "pane.create": "W",
  "pane.close": "X",
  "pane.split.horizontal": "D",
  "pane.split.vertical": "Shift+D",
  "pane.focus.left": "Left",
  "pane.focus.right": "Right",
  "pane.focus.up": "Up",
  "pane.focus.down": "Down",
  "web.tab.create": "G",
  "calendar.view.agenda": "Alt+1",
  "calendar.view.day": "Alt+2",
  "calendar.view.multiDay": "Alt+3",
  "calendar.view.week": "Alt+4",
  "calendar.view.month": "Alt+5"
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
