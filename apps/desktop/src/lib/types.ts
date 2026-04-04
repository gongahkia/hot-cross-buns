// Hot Cross Buns shared type definitions

export interface Area {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface List {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
  isInbox: boolean;
  areaId: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Tag {
  id: string;
  name: string;
  color: string | null;
  createdAt: string;
  deletedAt?: string | null;
}

export interface SyncSettings {
  serverUrl: string;
  authToken: string;
  deviceId: string;
  autoSyncEnabled: boolean;
  lastSyncedAt: string | null;
}

export interface SyncHealth {
  pendingChanges: number;
  conflictCount: number;
  lastSyncError: string | null;
}

export interface SyncConflict {
  entityType: string;
  entityId: string;
  fieldName: string;
  localValue: string;
  remoteValue: string;
  localUpdatedAt: string;
  remoteUpdatedAt: string;
  localDeviceId: string | null;
  remoteDeviceId: string | null;
  resolutionStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  listId: string;
  parentTaskId: string | null;
  title: string;
  content: string | null;
  priority: number;
  status: number;
  startDate: string | null;
  dueDate: string | null;
  dueTimezone: string | null;
  recurrenceRule: string | null;
  sortOrder: number;
  headingId: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  estimatedMinutes: number | null;
  subtasks: Task[];
  tags: Tag[];
}

export interface Heading {
  id: string;
  listId: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Attachment {
  id: string;
  taskId: string;
  filename: string;
  filePath: string;
  mimeType: string | null;
  size: number;
  createdAt: string;
}

export interface SavedFilter {
  id: string;
  name: string;
  config: string; // JSON: {priorities, tagIds, dueBefore, dueAfter}
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskUpdatePayload {
  id: string;
  title?: string;
  content?: string;
  priority?: number;
  status?: number;
  startDate?: string;
  dueDate?: string;
  dueTimezone?: string;
  recurrenceRule?: string;
  sortOrder?: number;
  headingId?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  estimatedMinutes?: number;
}
