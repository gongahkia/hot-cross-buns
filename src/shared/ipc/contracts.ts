import { z } from "zod";

/**
 * Versioned renderer DTO boundary. The restored Electron renderer defines the
 * complete surface; concrete domain DTOs are progressively narrowed in service
 * modules without exposing database rows or credential material.
 */
export type AgentActionSummary = any;
export type AttachmentEntityKind = any;
export type AttachmentSummary = any;
export type AutoTagReapplyApplyRequest = any;
export type AutoTagReapplyApplyResponse = any;
export type AutoTagReapplyPreviewRequest = any;
export type AutoTagReapplyPreviewResponse = any;
export type AutoTagRule = any;
export type BootstrapGetResponse = any;
export type CalendarEventCompletionScope = any;
export type CalendarEventCreateRequest = any;
export type CalendarEventDetail = any;
export type CalendarEventRecurrence = any;
export type CalendarEventReminder = any;
export type CalendarEventSummary = any;
export type CalendarEventUpdateRequest = {
  id: string;
  startsAt?: string;
  endsAt?: string;
  allDay?: boolean;
  scope?: any;
  [key: string]: any;
};
export type CalendarListRequest = any;
export type CalendarListResponse = any;
export type CalendarListSummary = any;
export type CalendarRangeRequest = any;
export type CalendarRangeResponse = any;
export interface CalendarScheduleSuggestResponse {
  slots: Array<{ startsAt: string; endsAt: string; eventId?: string; taskId?: string; locked: boolean; conflict: boolean }>;
  unscheduled: TaskSummary[];
  overloadMinutes: number;
  availableMinutes?: number;
}
export type CustomizationExtension = any;
export type CustomizationStatusResponse = any;
export type DiagnosticsHealthResponse = any;
export type DiagnosticsHistoryEntry = any;
export type DiagnosticsLogEntry = any;
export type DiagnosticsLogLevel = any;
export type DiagnosticsLogsResponse = any;
export type DiagnosticsPendingMutation = any;
export type DiagnosticsSummaryResponse = any;
export type EventTemplate = any;
export type GoogleCalendarEventColorId = string;
export interface GoogleAccountStatus {
  accountId: string;
  googleAccountId?: string;
  email: string | null;
  displayName: string | null;
  avatarUrl?: string | null;
  timeZone?: string | null;
  connectionState: "connected" | "disconnected" | "error" | "reauth_required" | "local" | string;
  missingScopes: string[];
  grantedScopes?: string[];
  updatedAt?: string;
}
export interface GoogleStatusResponse {
  oauthClientConfigured: boolean;
  clientId: string | null;
  hasClientSecret: boolean;
  account?: GoogleAccountStatus | null;
  accounts: GoogleAccountStatus[];
}
export type HotkeyActionId = string;
export type IcsSubscriptionsResponse = any;
export type LocalPointerListResponse = any;
export type NativeAction = any;
export type NativeCapabilitiesResponse = any;
export type NativeCapabilityDescriptor = any;
export type NativeCapabilityDiagnostic = any;
export type NativeCapabilityFlags = any;
export type NativeCapabilityKey = any;
export type NativeCapabilityReport = any;
export type NativeFeatureState = any;
export type NativeFontFamiliesResponse = any;
export type NativeNotificationPermissionResponse = any;
export type NativeRoute = any;
export type NativeUpdaterStatus = any;
export type NoteDetail = any;
export type NoteEntityKind = any;
export type NoteEntityLink = any;
export type NoteEntityLinksResponse = any;
export type NoteLinkSuggestResponse = any;
export type NoteListRequest = any;
export type NoteListResponse = any;
export type NoteListSummary = any;
export type NoteSummary = any;
export type PortableImportPreview = any;
export type SavedTaskView = any;
export type ScheduledTaskBlockCreateRequest = any;
export type ScheduledTaskBlockListRequest = any;
export type ScheduledTaskBlockListResponse = any;
export type ScheduledTaskBlockMoveRequest = any;
export type ScheduledTaskBlockSummary = any;
export type SearchQueryResponse = any;
export type SearchResultItem = any;
export type SettingsRecoveryActionRequest = any;
export type SettingsRecoveryActionResponse = any;
export interface SettingsSnapshot {
  [key: string]: any;
  historyCategoryVisibility: Record<string, boolean>;
  calendarEventColorOverrides: Record<string, any>;
  perSurfaceFontOverrides: Record<string, any>;
}
export type SettingsUpdateRequest = any;
export interface SmartRescheduleResponse {
  suggestions: Array<{ taskId: string; calendarId: string; startsAt: string; endsAt: string; action: "schedule" | "move"; reason: string }>;
  skipped: Array<{ taskId: string; reason: string }>;
  applied: boolean;
  calendarId: string;
  generatedAt: string;
}
export type SyncRunNowRequest = any;
export interface SyncStatusResponse {
  state: "idle" | "pending" | "syncing" | "error" | string;
  pendingMutationCount: number;
  offline: boolean;
  stale: boolean;
  lastCompletedAt?: string;
  lastErrorCode?: string | null;
  message?: string;
}
export type TagAnalyticsResponse = any;
export type TagBulkApplyRequest = any;
export type TagCreateRequest = any;
export type TagDeleteRequest = any;
export type TagListRequest = any;
export type TagListResponse = any;
export type TagMergeRequest = any;
export type TagMutationResponse = any;
export type TagSummary = any;
export type TagUpdateRequest = any;
export type TaskBulkRescheduleRequest = any;
export type TaskCreateRequest = any;
export type TaskDetail = any;
export type TaskListCreateRequest = any;
export type TaskListRenameRequest = any;
export type TaskListRequest = any;
export type TaskListResponse = any;
export interface TaskListSummary {
  id: string;
  accountId?: string;
  title: string;
  taskCount?: number;
  activeTaskCount?: number;
  updatedAt?: string;
}
export type TaskListsRequest = any;
export type TaskListsResponse = any;
export type TaskMoveRequest = any;
export interface TaskSummary {
  id: string;
  accountId?: string;
  listId: string;
  title: string;
  notes?: string;
  status?: string;
  priority?: "none" | "low" | "medium" | "high";
  dueAt?: string | null;
  durationMinutes?: number | null;
  lockedSchedule?: boolean;
  [key: string]: any;
}
export type TaskTemplate = any;
export type TaskUpdateRequest = any;
export interface UndoApplyResponse { action: "undo" | "redo"; applied: boolean; label?: string; canUndo: boolean; canRedo: boolean; }
export interface UndoStackStatusResponse { canUndo: boolean; canRedo: boolean; }

export const defaultHistoryCategoryVisibility = {};
export const defaultKeybindings = {};
export const defaultLeaderKey = "CmdOrCtrl+K";
export const defaultLeaderKeybindings = {};
export const defaultSemanticSearchModels: any[] = [];

export const googleCalendarEventColors: any[] = [
  { id: "default", label: "Default", value: "#5f6368" },
  { id: "blue", label: "Blue", value: "#4285f4" },
  { id: "green", label: "Green", value: "#34a853" },
  { id: "red", label: "Red", value: "#ea4335" }
] as const;

export function googleCalendarEventColor(id: string | null | undefined): any {
  return googleCalendarEventColors.find((color) => color.id === id) ?? googleCalendarEventColors[0];
}

export function calendarEventColorForTheme(..._args: any[]): any {
  return googleCalendarEventColors[0];
}

export function resolveCalendarEventDisplayColor(..._args: any[]): any {
  return googleCalendarEventColors[0];
}

export const nativeActionSchema = z.object({ type: z.string() }).passthrough();
