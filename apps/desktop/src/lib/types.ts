// TickClone shared type definitions

export interface List {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
  isInbox: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Tag {
  id: string;
  name: string;
  color: string | null;
  createdAt: string;
}

export interface SyncSettings {
  serverUrl: string;
  authToken: string;
  deviceId: string;
  autoSyncEnabled: boolean;
  lastSyncedAt: string | null;
}

export interface Task {
  id: string;
  listId: string;
  parentTaskId: string | null;
  title: string;
  content: string | null;
  priority: number;
  status: number;
  dueDate: string | null;
  dueTimezone: string | null;
  recurrenceRule: string | null;
  sortOrder: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  subtasks: Task[];
  tags: Tag[];
}

export interface TaskUpdatePayload {
  id: string;
  title?: string;
  content?: string;
  priority?: number;
  status?: number;
  dueDate?: string;
  dueTimezone?: string;
  recurrenceRule?: string;
  sortOrder?: number;
}
