import type { JsonValue } from "@shared/domain/localData";

export type FutureSyncMutationResource = "task" | "event";

export interface FutureSyncMutationInput {
  accountId: string;
  resource: FutureSyncMutationResource;
  resourceId: string;
  operation: string;
  payload: JsonValue;
}

export interface PendingMutationQueue {
  enqueue(input: FutureSyncMutationInput): Promise<{ id: string; queued: true }>;
  pendingCount(accountId?: string): Promise<number>;
}
