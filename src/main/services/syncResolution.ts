import type { PendingSyncMutation } from "./coreStore";

export type SyncRecord = Record<string, any>;
export interface SyncResolutionContext {
  mutation: PendingSyncMutation;
  mutations: PendingSyncMutation[];
  entities: Array<{ kind: "task" | "taskList" | "event"; id: string; local: SyncRecord | null }>;
  version: string;
  uncertainCreation: boolean;
}
export interface GoogleResolutionSnapshot {
  lists?: Array<{ remote: SyncRecord; tasks: SyncRecord[] }>;
  calendars?: Array<{ remote: SyncRecord; events: SyncRecord[]; token?: string }>;
}
