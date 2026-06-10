import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type {
  WebhookDeleteRequest,
  WebhookEvent,
  WebhookListRequest,
  WebhookListResponse,
  WebhookMutationResponse,
  WebhookSubscription,
  WebhookUpsertRequest
} from "@shared/ipc/contracts";
import { redactErrorMessage } from "@shared/redaction";
import type { SqliteConnection } from "../sqliteConnection";
import { pageBounds, pageFromRows, parseStringArray, validationFailure } from "./shared";

const maxWebhookAttempts = 5;
const webhookRetryBaseDelayMs = 10_000;
const webhookRetryMaxDelayMs = 5 * 60_000;
const webhookRateLimitMs = 1_000;
const webhookTimeoutMs = 2_500;

interface WebhookRow extends Record<string, unknown> {
  id: string;
  url: string;
  eventsJson: string;
  enabled: number;
  includePrivateBodies: number;
  secret: string;
  createdAt: string;
  updatedAt: string;
  lastDeliveryAt: string | null;
  lastError: string | null;
}

interface WebhookDeliveryRow extends Record<string, unknown> {
  id: string;
  subscriptionId: string;
  event: string;
  status: string;
  attemptCount: number;
  responseStatus: number | null;
  errorMessage: string | null;
  payloadJson: string;
  createdAt: string;
  updatedAt: string;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
}

export interface WebhookEmitInput {
  event: WebhookEvent;
  payload: Record<string, unknown>;
}

export interface WebhookDrainDueOptions {
  now?: string;
  limit?: number;
}

export interface WebhookDrainResult {
  attemptedCount: number;
  deliveredCount: number;
  failedCount: number;
  deferredCount: number;
}

export class LocalWebhookRepository {
  constructor(private readonly connection: SqliteConnection) {}

  list(request: WebhookListRequest): WebhookListResponse {
    const { limit, offset } = pageBounds(request.cursor, request.limit, 50, 100);
    const rows = this.connection.query<WebhookRow>(
      `${selectWebhookRows()}
       WHERE deleted_at IS NULL
       ORDER BY updated_at DESC, id DESC
       LIMIT ? OFFSET ?;`,
      [limit, offset]
    );
    const total = this.connection.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM local_webhook_subscriptions WHERE deleted_at IS NULL;"
    )?.count ?? rows.length;
    return pageFromRows(rows.map(webhookSubscription), limit, offset, total);
  }

  upsert(request: WebhookUpsertRequest): WebhookMutationResponse {
    assertLoopbackUrl(request.url);
    const now = new Date().toISOString();
    const id = request.id ?? `webhook:${randomUUID()}`;
    const existing = request.id ? this.row(request.id) : null;
    const secret = existing?.secret ?? randomBytes(24).toString("hex");
    this.connection.run(
      `INSERT INTO local_webhook_subscriptions (
         id, url, events_json, enabled, include_private_bodies, secret,
         created_at, updated_at, last_delivery_at, last_error, deleted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
       ON CONFLICT(id) DO UPDATE SET
         url = excluded.url,
         events_json = excluded.events_json,
         enabled = excluded.enabled,
         include_private_bodies = excluded.include_private_bodies,
         updated_at = excluded.updated_at,
         deleted_at = NULL;`,
      [
        id,
        request.url,
        JSON.stringify([...new Set(request.events)]),
        request.enabled ? 1 : 0,
        request.includePrivateBodies ? 1 : 0,
        secret,
        now,
        now
      ]
    );
    return { id, queued: false, revision: now, subscription: this.requireSubscription(id) };
  }

  delete(request: WebhookDeleteRequest): WebhookMutationResponse {
    const now = new Date().toISOString();
    this.connection.run(
      "UPDATE local_webhook_subscriptions SET deleted_at = ?, updated_at = ? WHERE id = ?;",
      [now, now, request.id]
    );
    return { id: request.id, queued: false, revision: now };
  }

  async test(id: string): Promise<WebhookMutationResponse> {
    const subscription = this.requireSubscription(id);
    await this.deliver(subscription, "sync.completed", {
      event: "sync.completed",
      test: true,
      occurredAt: new Date().toISOString()
    });
    return { id, queued: false, revision: new Date().toISOString(), subscription: this.requireSubscription(id) };
  }

  async emit(input: WebhookEmitInput, enabled: boolean): Promise<void> {
    if (!enabled) {
      return;
    }
    const now = new Date().toISOString();
    const rows = this.connection.query<WebhookRow>(
      `${selectWebhookRows()}
       WHERE deleted_at IS NULL AND enabled = 1;`
    );
    const payload = {
      event: input.event,
      occurredAt: new Date().toISOString(),
      payload: input.payload
    };
    const operations = rows
      .map(webhookSubscription)
      .filter((subscription) => subscription.events.includes(input.event))
      .map((subscription) => {
        const deliveryId = `webhook-delivery:${randomUUID()}`;
        const body = JSON.stringify(sanitizePayload(payload, subscription.includePrivateBodies));

        return {
          kind: "run" as const,
          sql: `INSERT INTO local_webhook_deliveries (
                 id, subscription_id, event, status, attempt_count, response_status,
                 error_message, payload_json, created_at, updated_at, next_attempt_at, last_attempt_at
               ) VALUES (?, ?, ?, 'pending', 0, NULL, NULL, ?, ?, ?, ?, NULL);`,
          params: [deliveryId, subscription.id, input.event, body, now, now, now]
        };
      });

    this.connection.executeTransaction(operations);
    await this.deliverDue({ now });
  }

  requireSubscription(id: string): WebhookSubscription {
    const row = this.row(id);
    if (!row) {
      throw validationFailure("Webhook subscription was not found.");
    }
    return webhookSubscription(row);
  }

  private row(id: string): WebhookRow | null {
    return this.connection.get<WebhookRow>(
      `${selectWebhookRows()} WHERE id = ? AND deleted_at IS NULL LIMIT 1;`,
      [id]
    ) ?? null;
  }

  async deliverDue(options: WebhookDrainDueOptions = {}): Promise<WebhookDrainResult> {
    const now = options.now ?? new Date().toISOString();
    const rows = this.connection.query<WebhookDeliveryRow>(
      `${selectDeliveryRows()}
       WHERE deliveries.status IN ('pending', 'retrying')
         AND deliveries.next_attempt_at IS NOT NULL
         AND deliveries.next_attempt_at <= ?
       ORDER BY deliveries.next_attempt_at ASC, deliveries.created_at ASC, deliveries.id ASC
       LIMIT ?;`,
      [now, Math.max(1, Math.min(100, options.limit ?? 25))]
    );
    const lastAttemptBySubscription = new Map<string, string | null>();
    let attemptedCount = 0;
    let deliveredCount = 0;
    let failedCount = 0;
    let deferredCount = 0;

    for (const delivery of rows) {
      const subscription = this.row(delivery.subscriptionId);

      if (!subscription || subscription.enabled !== 1) {
        this.markDeliveryFailed(delivery, "Webhook subscription is disabled or deleted.", now, null);
        failedCount += 1;
        continue;
      }

      const lastAttemptAt = lastAttemptBySubscription.has(subscription.id)
        ? lastAttemptBySubscription.get(subscription.id)
        : subscription.lastDeliveryAt;
      const deferUntil = rateLimitedUntil(lastAttemptAt, now);

      if (deferUntil) {
        this.deferDelivery(delivery.id, deferUntil, now);
        lastAttemptBySubscription.set(subscription.id, deferUntil);
        deferredCount += 1;
        continue;
      }

      attemptedCount += 1;
      lastAttemptBySubscription.set(subscription.id, now);

      const result = await this.deliverAttempt(delivery, webhookSubscription(subscription), now);

      if (result === "delivered") {
        deliveredCount += 1;
      } else {
        failedCount += 1;
      }
    }

    return {
      attemptedCount,
      deliveredCount,
      failedCount,
      deferredCount
    };
  }

  private async deliver(
    subscription: WebhookSubscription,
    event: WebhookEvent,
    payload: Record<string, unknown>
  ): Promise<void> {
    const now = new Date().toISOString();
    const deliveryId = `webhook-delivery:${randomUUID()}`;
    const body = JSON.stringify(sanitizePayload(payload, subscription.includePrivateBodies));
    this.connection.run(
      `INSERT INTO local_webhook_deliveries (
         id, subscription_id, event, status, attempt_count, response_status,
         error_message, payload_json, created_at, updated_at, next_attempt_at, last_attempt_at
       ) VALUES (?, ?, ?, 'pending', 0, NULL, NULL, ?, ?, ?, ?, NULL);`,
      [deliveryId, subscription.id, event, body, now, now, now]
    );
    await this.deliverDue({ now, limit: 1 });
  }

  private async deliverAttempt(
    delivery: WebhookDeliveryRow,
    subscription: WebhookSubscription,
    now: string
  ): Promise<"delivered" | "failed"> {
    const body = delivery.payloadJson;
    const secret = this.row(subscription.id)?.secret ?? "";
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    const attemptCount = delivery.attemptCount + 1;

    try {
      const response = await fetch(subscription.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hcb-event": delivery.event,
          "x-hcb-signature": `sha256=${signature}`
        },
        body,
        signal: AbortSignal.timeout(webhookTimeoutMs)
      });

      if (!response.ok) {
        this.markDeliveryFailed(delivery, `HTTP ${response.status}`, now, response.status, attemptCount);
        return "failed";
      }

      this.connection.executeTransaction([
        {
          kind: "run",
          sql: `UPDATE local_webhook_deliveries
                SET status = 'delivered',
                    attempt_count = ?,
                    response_status = ?,
                    error_message = NULL,
                    next_attempt_at = NULL,
                    last_attempt_at = ?,
                    updated_at = ?
                WHERE id = ?;`,
          params: [attemptCount, response.status, now, now, delivery.id]
        },
        {
          kind: "run",
          sql: `UPDATE local_webhook_subscriptions
                SET last_delivery_at = ?, last_error = ?, updated_at = ?
                WHERE id = ?;`,
          params: [now, null, now, subscription.id]
        }
      ]);
      return "delivered";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.markDeliveryFailed(delivery, message, now, null, attemptCount);
      return "failed";
    }
  }

  private markDeliveryFailed(
    delivery: WebhookDeliveryRow,
    message: string,
    now: string,
    responseStatus: number | null,
    attemptCount = delivery.attemptCount + 1
  ): void {
    const retryable = attemptCount < maxWebhookAttempts;
    const nextAttemptAt = retryable
      ? new Date(new Date(now).getTime() + webhookRetryDelayMs(attemptCount)).toISOString()
      : null;
    const redactedMessage = redactErrorMessage(message).slice(0, 500);

    this.connection.executeTransaction([
      {
        kind: "run",
        sql: `UPDATE local_webhook_deliveries
              SET status = ?,
                  attempt_count = ?,
                  response_status = ?,
                  error_message = ?,
                  next_attempt_at = ?,
                  last_attempt_at = ?,
                  updated_at = ?
              WHERE id = ?;`,
        params: [
          retryable ? "retrying" : "failed",
          attemptCount,
          responseStatus,
          redactedMessage,
          nextAttemptAt,
          now,
          now,
          delivery.id
        ]
      },
      {
        kind: "run",
        sql: `UPDATE local_webhook_subscriptions
              SET last_delivery_at = ?, last_error = ?, updated_at = ?
              WHERE id = ?;`,
        params: [now, redactedMessage, now, delivery.subscriptionId]
      }
    ]);
  }

  private deferDelivery(id: string, nextAttemptAt: string, now: string): void {
    this.connection.run(
      `UPDATE local_webhook_deliveries
       SET status = 'retrying',
           next_attempt_at = ?,
           updated_at = ?
       WHERE id = ?;`,
      [nextAttemptAt, now, id]
    );
  }
}

function selectWebhookRows(): string {
  return `SELECT
           id,
           url,
           events_json AS eventsJson,
           enabled,
           include_private_bodies AS includePrivateBodies,
           secret,
           created_at AS createdAt,
           updated_at AS updatedAt,
           last_delivery_at AS lastDeliveryAt,
           last_error AS lastError,
           deleted_at
         FROM local_webhook_subscriptions`;
}

function selectDeliveryRows(): string {
  return `SELECT
           id,
           subscription_id AS subscriptionId,
           event,
           status,
           attempt_count AS attemptCount,
           response_status AS responseStatus,
           error_message AS errorMessage,
           payload_json AS payloadJson,
           created_at AS createdAt,
           updated_at AS updatedAt,
           next_attempt_at AS nextAttemptAt,
           last_attempt_at AS lastAttemptAt
         FROM local_webhook_deliveries deliveries`;
}

function webhookSubscription(row: WebhookRow): WebhookSubscription {
  return {
    id: row.id,
    url: row.url,
    events: parseStringArray(row.eventsJson).filter(isWebhookEvent),
    enabled: row.enabled === 1,
    includePrivateBodies: row.includePrivateBodies === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastDeliveryAt: row.lastDeliveryAt,
    lastError: row.lastError
  };
}

function assertLoopbackUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw validationFailure("Webhook URL is invalid.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw validationFailure("Webhook URL must use HTTP or HTTPS.");
  }
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname)) {
    throw validationFailure("Webhook URL must target localhost or 127.0.0.1.");
  }
}

function sanitizePayload(payload: Record<string, unknown>, includePrivateBodies: boolean): Record<string, unknown> {
  if (includePrivateBodies) {
    return payload;
  }
  return JSON.parse(JSON.stringify(payload, (key, value) =>
    ["body", "notes", "description", "details"].includes(key) ? "[redacted]" : value
  )) as Record<string, unknown>;
}

function webhookRetryDelayMs(attemptCount: number): number {
  const attempt = Math.max(0, Math.min(10, attemptCount - 1));

  return Math.min(webhookRetryBaseDelayMs * 2 ** attempt, webhookRetryMaxDelayMs);
}

function rateLimitedUntil(lastAttemptAt: string | null | undefined, now: string): string | null {
  if (!lastAttemptAt) {
    return null;
  }

  const lastMs = new Date(lastAttemptAt).getTime();
  const nowMs = new Date(now).getTime();

  if (!Number.isFinite(lastMs) || !Number.isFinite(nowMs)) {
    return null;
  }

  const nextAllowedMs = lastMs + webhookRateLimitMs;

  return nextAllowedMs > nowMs ? new Date(nextAllowedMs).toISOString() : null;
}

function isWebhookEvent(value: string): value is WebhookEvent {
  return ["task.created", "task.completed", "event.starting", "mutation.failed", "sync.completed"].includes(value);
}
