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
import type { SqliteConnection } from "../sqliteConnection";
import { pageBounds, pageFromRows, parseStringArray, validationFailure } from "./shared";

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

export interface WebhookEmitInput {
  event: WebhookEvent;
  payload: Record<string, unknown>;
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
    const rows = this.connection.query<WebhookRow>(
      `${selectWebhookRows()}
       WHERE deleted_at IS NULL AND enabled = 1;`
    );
    const payload = {
      event: input.event,
      occurredAt: new Date().toISOString(),
      payload: input.payload
    };
    await Promise.all(rows
      .map(webhookSubscription)
      .filter((subscription) => subscription.events.includes(input.event))
      .map((subscription) => this.deliver(subscription, input.event, payload)));
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

  private async deliver(
    subscription: WebhookSubscription,
    event: WebhookEvent,
    payload: Record<string, unknown>
  ): Promise<void> {
    const now = new Date().toISOString();
    const deliveryId = `webhook-delivery:${randomUUID()}`;
    const body = JSON.stringify(sanitizePayload(payload, subscription.includePrivateBodies));
    const secret = this.row(subscription.id)?.secret ?? "";
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    this.connection.run(
      `INSERT INTO local_webhook_deliveries (
         id, subscription_id, event, status, attempt_count, response_status,
         error_message, created_at, updated_at
       ) VALUES (?, ?, ?, 'pending', 0, NULL, NULL, ?, ?);`,
      [deliveryId, subscription.id, event, now, now]
    );
    try {
      const response = await fetch(subscription.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hcb-event": event,
          "x-hcb-signature": `sha256=${signature}`
        },
        body,
        signal: AbortSignal.timeout(2_500)
      });
      this.connection.executeTransaction([
        {
          kind: "run",
          sql: `UPDATE local_webhook_deliveries
                SET status = ?, attempt_count = 1, response_status = ?, updated_at = ?
                WHERE id = ?;`,
          params: [response.ok ? "delivered" : "failed", response.status, now, deliveryId]
        },
        {
          kind: "run",
          sql: `UPDATE local_webhook_subscriptions
                SET last_delivery_at = ?, last_error = ?, updated_at = ?
                WHERE id = ?;`,
          params: [now, response.ok ? null : `HTTP ${response.status}`, now, subscription.id]
        }
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.connection.executeTransaction([
        {
          kind: "run",
          sql: `UPDATE local_webhook_deliveries
                SET status = 'failed', attempt_count = 1, error_message = ?, updated_at = ?
                WHERE id = ?;`,
          params: [message.slice(0, 500), now, deliveryId]
        },
        {
          kind: "run",
          sql: `UPDATE local_webhook_subscriptions
                SET last_delivery_at = ?, last_error = ?, updated_at = ?
                WHERE id = ?;`,
          params: [now, message.slice(0, 500), now, subscription.id]
        }
      ]);
    }
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
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
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

function isWebhookEvent(value: string): value is WebhookEvent {
  return ["task.created", "task.completed", "event.starting", "mutation.failed", "sync.completed"].includes(value);
}
