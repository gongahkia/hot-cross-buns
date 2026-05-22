import type {
  CalendarEventSummary,
  NativeAction,
  NativeCapabilityReport,
  NativeCapabilitiesResponse,
  NativeFeatureState,
  NativeNotificationPermissionResponse,
  NativeRoute,
  SettingsSnapshot,
  SyncRunNowRequest,
  TaskSummary
} from "@shared/ipc/contracts";

export const HCB_DEEP_LINK_SCHEME = "hotcrossbuns";

export interface NativeOperationResult {
  ok: boolean;
  state?: NativeFeatureState;
  message?: string;
}

export interface NativeAppPaths {
  configDirectory: string;
  dataDirectory: string;
  cacheDirectory: string;
  logsDirectory: string;
  diagnosticsDirectory: string;
  tempDirectory: string;
}

export type NativePackageFormat = NativeCapabilityReport["packageFormat"];

export interface NativePlatformCapabilities {
  platform: NativeCapabilitiesResponse["platform"];
  adapterId: string;
  notifications: boolean;
  globalShortcuts: boolean;
  tray: boolean;
  deepLinks: boolean;
  updaterChecks: boolean;
  capabilityReport: NativeCapabilityReport;
}

export interface NativeTrayActions {
  primaryClick: () => void;
  openMainWindow: () => void;
  showOrHideMainWindow: () => void;
  quickCapture: () => void;
  refresh: () => void;
  openSettings: () => void;
  openRoute: (route: NativeRoute) => void;
  snapshot: () => NativeMenuBarSnapshot;
  quit: () => void;
}

export interface NativeMenuBarItem {
  label: string;
  detail?: string;
  route?: NativeRoute;
  action?: "quickCapture" | "refresh" | "openSettings" | "showWindow";
}

export interface NativeMenuBarSection {
  title?: string;
  items: NativeMenuBarItem[];
}

export interface NativeMenuBarSnapshot {
  panelStyle: SettingsSnapshot["menuBarPanelStyle"];
  primaryClickAction: SettingsSnapshot["trayClickAction"];
  title: string;
  subtitle?: string;
  badgeLabel?: string;
  tooltip: string;
  sections: NativeMenuBarSection[];
}

export interface NativeNotificationRequest {
  id: string;
  title: string;
  body: string;
  deliveryDate: Date;
  action?: NativeAction;
}

export interface ScheduledNativeNotification {
  id: string;
  cancel: () => void;
}

export interface NativePlatformAdapter {
  appPaths: () => NativeAppPaths;
  capabilities: () => NativePlatformCapabilities;
  credentialStorageStatus: () => NativeOperationResult;
  installAppMenu: (actions: NativeTrayActions) => NativeOperationResult;
  createTray: (actions: NativeTrayActions) => NativeOperationResult;
  destroyTray: () => void;
  registerGlobalShortcut: (
    accelerator: string,
    action: () => void
  ) => NativeOperationResult;
  unregisterGlobalShortcut: (accelerator?: string) => void;
  registerProtocolClient: (scheme: typeof HCB_DEEP_LINK_SCHEME) => NativeOperationResult;
  requestNotificationPermission: () => NativeNotificationPermissionResponse;
  scheduleNotification: (
    request: NativeNotificationRequest,
    onClick: () => void
  ) => ScheduledNativeNotification | undefined;
  clearScheduledNotifications: () => void;
  setAutostart: (enabled: boolean) => NativeOperationResult;
  autostartStatus: () => NativeOperationResult;
  checkForUpdates: () => NativeOperationResult | Promise<NativeOperationResult>;
  openExternalUrl: (url: string) => NativeOperationResult | Promise<NativeOperationResult>;
  openPath: (path: string) => NativeOperationResult | Promise<NativeOperationResult>;
  collectDiagnostics: () => NativeOperationResult;
  dispose: () => void;
}

export interface NativePlannerSnapshotSource {
  listTasks: (request: { status: "active"; limit: number }) => { items: TaskSummary[] };
  listCalendarEvents: (request: {
    start: string;
    end: string;
    limit: number;
  }) => { items: CalendarEventSummary[] };
}

export interface NativeSettingsSource {
  get: () => SettingsSnapshot;
}

export interface NativeShellWindowActions {
  showMainWindow: () => void;
  hideMainWindow: () => void;
  showOrHideMainWindow: () => void;
  quit: () => void;
  dispatchAction: (action: NativeAction) => void;
}

export interface NativeShellSyncActions {
  runNow: (request: SyncRunNowRequest) => void | Promise<unknown>;
}
