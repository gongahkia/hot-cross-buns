import type { PendingSyncMutation } from "../core/CoreStore";

/** Ready entries must be in causal order for a single account. */
export function compatibleGoogleBatch(ready: readonly PendingSyncMutation[], id: string): PendingSyncMutation[] {
  const index = ready.findIndex((mutation) => mutation.id === id);
  if (index < 0) return [];
  const first = ready[index];
  const selected = [first];
  if (!first.intent || first.intent.barrier || first.attempts !== 0 || !/^(taskList|task|event)\.(create|update)$/.test(first.kind)) return selected;
  const entityKind = first.kind.split(".")[0];
  for (const next of ready.slice(index + 1)) {
    // No skipping over another item, move, deletion, reorder, retry, or unknown
    // legacy intent. The original rows and undo entries remain independent.
    if (next.accountId !== first.accountId || next.entityId !== first.entityId || next.kind !== `${entityKind}.update` ||
      next.attempts !== 0 || !next.intent || next.intent.barrier) break;
    selected.push(next);
  }
  return selected;
}
