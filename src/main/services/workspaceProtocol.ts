import type { SettingsSnapshot, TaskSummary, CalendarEventSummary } from "@shared/ipc/contracts";

export interface NativeWorkspaceSnapshot {
  settings: SettingsSnapshot;
  account: Record<string, any> | null;
  tasks: TaskSummary[];
  events: CalendarEventSummary[];
  searchCounts: Record<string, number>;
}

export type RuntimeTarget = "core" | "googleOAuth" | "googleSync" | "backups";
export interface RuntimeCall { kind: "call"; id: number; target: RuntimeTarget; method: string; args: unknown[] }
export interface RuntimeReply { kind: "reply"; id: number; result?: any; error?: { name: string; message: string } }
export interface HostCall { kind: "host"; id: number; method: string; args: unknown[] }
export interface HostReply { kind: "hostReply"; id: number; result?: unknown; error?: string }
