import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  plannerCompleteTaskRequestSchema,
  plannerSaveTaskRequestSchema,
  plannerTaskPageSchema,
  plannerTaskSchema,
  plannerWorkspaceSchema,
  type PlannerCompleteTaskRequest,
  type PlannerSaveTaskRequest,
  type PlannerSyncStatus,
  type PlannerTask,
  type PlannerTaskListRequest,
  type PlannerTaskMutationResult,
  type PlannerTaskPage,
  type PlannerWorkspace
} from "@shared/planner";
import { z } from "zod";

const mutationKindSchema = z.enum(["upsert-task", "complete-task"]);
const mutationStatusSchema = z.enum(["pending", "conflict"]);

const outboxItemSchema = z
  .object({
    id: z.string().uuid(),
    kind: mutationKindSchema,
    taskId: z.string().min(1),
    payload: plannerTaskSchema,
    createdAt: z.string().datetime(),
    attemptCount: z.number().int().nonnegative(),
    nextAttemptAt: z.string().datetime(),
    status: mutationStatusSchema
  })
  .strict();

const receiptSchema = z
  .object({
    key: z.string().min(16).max(200),
    fingerprint: z.string().min(1),
    response: z
      .object({
        task: plannerTaskSchema,
        revision: z.number().int().nonnegative(),
        queued: z.boolean()
      })
      .strict(),
    expiresAt: z.string().datetime()
  })
  .strict();

const storedPlannerStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative(),
    tasks: z.array(plannerTaskSchema),
    outbox: z.array(outboxItemSchema),
    receipts: z.array(receiptSchema),
    lastSuccessfulDeliveryAt: z.string().datetime().nullable(),
    lastError: z.string().max(240).nullable()
  })
  .strict();

type OutboxItem = z.infer<typeof outboxItemSchema>;
type StoredPlannerState = z.infer<typeof storedPlannerStateSchema>;

export interface PlannerPersistence {
  read(): Promise<unknown | null>;
  write(state: StoredPlannerState): Promise<void>;
}

export class FilePlannerPersistence implements PlannerPersistence {
  constructor(private readonly path: string) {}

  async read(): Promise<unknown | null> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as unknown;
    } catch (error: unknown) {
      if (isMissingFile(error)) {
        return null;
      }

      throw error;
    }
  }

  async write(state: StoredPlannerState): Promise<void> {
    const parent = dirname(this.path);
    await mkdir(parent, { recursive: true, mode: 0o700 });

    const temporaryPath = join(parent, `.${randomUUID()}.tmp`);
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(temporaryPath, this.path);
  }
}

export class PlannerStoreError extends Error {}

export class PlannerConflictError extends PlannerStoreError {}

export class PlannerDeliveryError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
  }
}

export interface PlannerDelivery {
  deliver(item: Readonly<OutboxItem>): Promise<void>;
}

export interface PlannerFlushReport {
  delivered: number;
  deferred: number;
  conflicts: number;
}

export interface PlannerStoreOptions {
  persistence: PlannerPersistence;
  now?: () => Date;
  random?: () => number;
}

interface Cursor {
  revision: number;
  offset: number;
}

const receiptLifetimeMs = 7 * 24 * 60 * 60 * 1000;

export class PlannerStore {
  private state: StoredPlannerState = emptyState();
  private initialization: Promise<void> | undefined;
  private writes: Promise<void> = Promise.resolve();
  private readonly now: () => Date;
  private readonly random: () => number;

  constructor(private readonly options: PlannerStoreOptions) {
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
  }

  async workspace(): Promise<PlannerWorkspace> {
    await this.ensureInitialized();
    const pending = this.state.outbox.filter((item) => item.status === "pending");

    return plannerWorkspaceSchema.parse({
      revision: this.state.revision,
      taskCount: this.state.tasks.length,
      openTaskCount: this.state.tasks.filter((task) => task.status === "open").length,
      completedTaskCount: this.state.tasks.filter((task) => task.status === "completed").length,
      pendingMutationCount: pending.length,
      conflictCount: this.state.outbox.filter((item) => item.status === "conflict").length,
      searchIndexState: "ready"
    });
  }

  async listTasks(request: PlannerTaskListRequest): Promise<PlannerTaskPage> {
    await this.ensureInitialized();
    const normalized = z
      .object({
        query: z.string().trim().max(200).default(""),
        status: z.enum(["open", "completed"]).optional(),
        limit: z.number().int().min(1).max(200).default(50),
        cursor: z.string().min(1).max(256).optional()
      })
      .strict()
      .parse(request);
    const cursor = normalized.cursor ? decodeCursor(normalized.cursor) : { revision: this.state.revision, offset: 0 };

    if (cursor.revision !== this.state.revision) {
      throw new PlannerConflictError("Task list changed; refresh before loading the next page");
    }

    const terms = normalized.query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const matching = this.state.tasks
      .filter((task) => !normalized.status || task.status === normalized.status)
      .filter((task) => terms.every((term) => task.title.toLocaleLowerCase().includes(term)))
      .sort(compareTasks);
    const tasks = matching.slice(cursor.offset, cursor.offset + normalized.limit);
    const nextOffset = cursor.offset + tasks.length;

    return plannerTaskPageSchema.parse({
      revision: this.state.revision,
      tasks,
      nextCursor:
        nextOffset < matching.length
          ? encodeCursor({ revision: this.state.revision, offset: nextOffset })
          : null
    });
  }

  async saveTask(request: PlannerSaveTaskRequest): Promise<PlannerTaskMutationResult> {
    const parsed = plannerSaveTaskRequestSchema.parse(request);

    return this.serially(async () => {
      await this.ensureInitialized();
      const fingerprint = stableFingerprint("save-task", parsed);
      const existingReceipt = this.readReceipt(parsed.idempotencyKey, fingerprint);

      if (existingReceipt) {
        return existingReceipt;
      }

      const now = this.timestamp();
      const existing = parsed.id ? this.state.tasks.find((task) => task.id === parsed.id) : undefined;
      if (parsed.id && !existing) {
        throw new PlannerConflictError("Task no longer exists");
      }

      const revision = this.state.revision + 1;
      const task = plannerTaskSchema.parse({
        id: existing?.id ?? randomUUID(),
        title: parsed.title,
        notes: parsed.notes,
        dueDate: parsed.dueDate,
        status: existing?.status ?? "open",
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        revision
      });
      const response = { task, revision, queued: true };
      const tasks = existing
        ? this.state.tasks.map((candidate) => (candidate.id === task.id ? task : candidate))
        : [...this.state.tasks, task];

      await this.commit({
        ...this.state,
        revision,
        tasks,
        outbox: [...this.state.outbox, newOutboxItem("upsert-task", task, now)],
        receipts: this.withReceipt(parsed.idempotencyKey, fingerprint, response)
      });

      return response;
    });
  }

  async completeTask(request: PlannerCompleteTaskRequest): Promise<PlannerTaskMutationResult> {
    const parsed = plannerCompleteTaskRequestSchema.parse(request);

    return this.serially(async () => {
      await this.ensureInitialized();
      const fingerprint = stableFingerprint("complete-task", parsed);
      const existingReceipt = this.readReceipt(parsed.idempotencyKey, fingerprint);

      if (existingReceipt) {
        return existingReceipt;
      }

      const existing = this.state.tasks.find((task) => task.id === parsed.id);
      if (!existing) {
        throw new PlannerConflictError("Task no longer exists");
      }

      const revision = this.state.revision + 1;
      const task = plannerTaskSchema.parse({
        ...existing,
        status: parsed.completed ? "completed" : "open",
        updatedAt: this.timestamp(),
        revision
      });
      const response = { task, revision, queued: true };

      await this.commit({
        ...this.state,
        revision,
        tasks: this.state.tasks.map((candidate) => (candidate.id === task.id ? task : candidate)),
        outbox: [...this.state.outbox, newOutboxItem("complete-task", task, task.updatedAt)],
        receipts: this.withReceipt(parsed.idempotencyKey, fingerprint, response)
      });

      return response;
    });
  }

  async syncStatus(): Promise<PlannerSyncStatus> {
    await this.ensureInitialized();
    const pending = this.state.outbox
      .filter((item) => item.status === "pending")
      .sort((left, right) => left.nextAttemptAt.localeCompare(right.nextAttemptAt));

    return {
      pendingMutationCount: pending.length,
      conflictCount: this.state.outbox.filter((item) => item.status === "conflict").length,
      nextAttemptAt: pending[0]?.nextAttemptAt ?? null,
      lastSuccessfulDeliveryAt: this.state.lastSuccessfulDeliveryAt,
      lastError: this.state.lastError
    };
  }

  async flushOutbox(delivery: PlannerDelivery, maximum = 50): Promise<PlannerFlushReport> {
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > 500) {
      throw new PlannerStoreError("Invalid outbox delivery limit");
    }

    return this.serially(async () => {
      await this.ensureInitialized();
      let delivered = 0;
      let deferred = 0;
      let conflicts = 0;

      while (delivered < maximum) {
        const item = this.state.outbox.find((candidate) => candidate.status === "pending");
        if (!item || item.nextAttemptAt > this.timestamp()) {
          break;
        }

        try {
          await delivery.deliver(Object.freeze(structuredClone(item)));
          await this.commit({
            ...this.state,
            outbox: this.state.outbox.filter((candidate) => candidate.id !== item.id),
            lastSuccessfulDeliveryAt: this.timestamp(),
            lastError: null
          });
          delivered += 1;
        } catch (error: unknown) {
          if (error instanceof PlannerDeliveryError && !error.retryable) {
            await this.commit({
              ...this.state,
              outbox: this.state.outbox.map((candidate) =>
                candidate.id === item.id ? { ...candidate, status: "conflict" as const } : candidate
              ),
              lastError: "A local change needs review before it can be delivered"
            });
            conflicts += 1;
          } else {
            const attemptCount = item.attemptCount + 1;
            const nextAttemptAt = new Date(
              this.now().getTime() + retryDelayMs(attemptCount, this.random)
            ).toISOString();
            await this.commit({
              ...this.state,
              outbox: this.state.outbox.map((candidate) =>
                candidate.id === item.id
                  ? { ...candidate, attemptCount, nextAttemptAt }
                  : candidate
              ),
              lastError: "Sync delivery was deferred and will retry automatically"
            });
            deferred += 1;
          }

          break;
        }
      }

      return { delivered, deferred, conflicts };
    });
  }

  private async ensureInitialized(): Promise<void> {
    this.initialization ??= this.load();
    return this.initialization;
  }

  private async load(): Promise<void> {
    const stored = await this.options.persistence.read();
    if (stored === null) {
      this.state = emptyState();
      return;
    }

    const parsed = storedPlannerStateSchema.safeParse(stored);
    if (!parsed.success) {
      throw new PlannerStoreError("Local planner data is invalid; recovery is required");
    }

    this.state = parsed.data;
  }

  private async serially<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writes.then(operation);
    this.writes = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private async commit(next: StoredPlannerState): Promise<void> {
    const parsed = storedPlannerStateSchema.parse(next);
    await this.options.persistence.write(parsed);
    this.state = parsed;
  }

  private readReceipt(key: string, fingerprint: string): PlannerTaskMutationResult | null {
    const receipt = this.state.receipts.find((candidate) => candidate.key === key);
    if (!receipt) {
      return null;
    }
    if (receipt.fingerprint !== fingerprint) {
      throw new PlannerConflictError("Idempotency key was already used for a different change");
    }

    return receipt.response;
  }

  private withReceipt(
    key: string,
    fingerprint: string,
    response: PlannerTaskMutationResult
  ): StoredPlannerState["receipts"] {
    const now = this.now().getTime();
    const active = this.state.receipts.filter((receipt) => Date.parse(receipt.expiresAt) > now);

    return [
      ...active,
      {
        key,
        fingerprint,
        response,
        expiresAt: new Date(now + receiptLifetimeMs).toISOString()
      }
    ];
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function emptyState(): StoredPlannerState {
  return {
    schemaVersion: 1,
    revision: 0,
    tasks: [],
    outbox: [],
    receipts: [],
    lastSuccessfulDeliveryAt: null,
    lastError: null
  };
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function compareTasks(left: PlannerTask, right: PlannerTask): number {
  if (left.status !== right.status) {
    return left.status === "open" ? -1 : 1;
  }
  if (left.dueDate !== right.dueDate) {
    return (left.dueDate ?? "9999-12-31").localeCompare(right.dueDate ?? "9999-12-31");
  }
  if (left.updatedAt !== right.updatedAt) {
    return right.updatedAt.localeCompare(left.updatedAt);
  }
  return left.id.localeCompare(right.id);
}

function newOutboxItem(
  kind: OutboxItem["kind"],
  task: PlannerTask,
  createdAt: string
): OutboxItem {
  return {
    id: randomUUID(),
    kind,
    taskId: task.id,
    payload: task,
    createdAt,
    attemptCount: 0,
    nextAttemptAt: createdAt,
    status: "pending"
  };
}

function stableFingerprint(operation: string, payload: object): string {
  return `${operation}:${JSON.stringify(payload, Object.keys(payload).sort())}`;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(raw: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    return z
      .object({
        revision: z.number().int().nonnegative(),
        offset: z.number().int().nonnegative()
      })
      .strict()
      .parse(parsed);
  } catch {
    throw new PlannerConflictError("Task page cursor is invalid");
  }
}

function retryDelayMs(attemptCount: number, random: () => number): number {
  const base = Math.min(60 * 60 * 1000, 1_000 * 2 ** Math.min(attemptCount, 8));
  return base + Math.floor(base * 0.2 * Math.min(1, Math.max(0, random())));
}
