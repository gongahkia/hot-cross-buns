import { afterEach, describe, expect, it, vi } from "vitest";
import { runLocalDataMigrations } from "../migrations";
import {
  createTemporarySqliteConnection,
  type TemporarySqliteConnection
} from "../sqliteConnection";
import { LocalWebhookRepository } from "./webhookRepository";

let temporary: TemporarySqliteConnection | undefined;

afterEach(() => {
  vi.unstubAllGlobals();
  temporary?.cleanup();
  temporary = undefined;
});

function repositoryHarness() {
  temporary = createTemporarySqliteConnection("hcb2-webhook-repository-");
  runLocalDataMigrations(temporary.connection);

  return {
    connection: temporary.connection,
    repository: new LocalWebhookRepository(temporary.connection)
  };
}

function deliveryRows() {
  return temporary!.connection.query<{
    status: string;
    attemptCount: number;
    responseStatus: number | null;
    payloadJson: string;
    nextAttemptAt: string | null;
    lastAttemptAt: string | null;
    errorMessage: string | null;
  }>(
    `SELECT status,
            attempt_count AS attemptCount,
            response_status AS responseStatus,
            payload_json AS payloadJson,
            next_attempt_at AS nextAttemptAt,
            last_attempt_at AS lastAttemptAt,
            error_message AS errorMessage
     FROM local_webhook_deliveries
     ORDER BY created_at ASC, id ASC;`
  );
}

describe("LocalWebhookRepository", () => {
  it("persists failed deliveries and retries them when due", async () => {
    const { repository } = repositoryHarness();
    const created = repository.upsert({
      url: "http://127.0.0.1:49321/hcb",
      events: ["sync.completed"],
      enabled: true
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await repository.emit({
      event: "sync.completed",
      payload: { resources: ["tasks"] }
    }, true);
    const failed = deliveryRows()[0];

    expect(failed).toMatchObject({
      status: "retrying",
      attemptCount: 1,
      responseStatus: 503,
      errorMessage: "HTTP 503"
    });
    expect(repository.requireSubscription(created.id)).toMatchObject({
      lastError: "HTTP 503"
    });

    await repository.deliverDue({ now: failed.nextAttemptAt ?? undefined });

    expect(deliveryRows()[0]).toMatchObject({
      status: "delivered",
      attemptCount: 2,
      responseStatus: 200,
      nextAttemptAt: null,
      errorMessage: null
    });
    expect(repository.requireSubscription(created.id)).toMatchObject({
      lastError: null
    });
  });

  it("redacts private body fields unless the subscription opts in", async () => {
    const { repository } = repositoryHarness();
    repository.upsert({
      url: "http://127.0.0.1:49321/hcb",
      events: ["task.created"],
      enabled: true,
      includePrivateBodies: false
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await repository.emit({
      event: "task.created",
      payload: {
        title: "Visible title",
        notes: "private note",
        nested: {
          details: "private details"
        }
      }
    }, true);

    const sentBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;

    expect(sentBody).toMatchObject({
      payload: {
        title: "Visible title",
        notes: "[redacted]",
        nested: {
          details: "[redacted]"
        }
      }
    });
  });

  it("rate-limits multiple due deliveries for the same subscription", async () => {
    const { connection, repository } = repositoryHarness();
    const now = "2026-06-10T10:00:00.000Z";
    const created = repository.upsert({
      url: "http://127.0.0.1:49321/hcb",
      events: ["task.created"],
      enabled: true
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 200 })));
    connection.run(
      `INSERT INTO local_webhook_deliveries (
         id, subscription_id, event, status, attempt_count, payload_json,
         created_at, updated_at, next_attempt_at
       ) VALUES (?, ?, 'task.created', 'pending', 0, ?, ?, ?, ?);`,
      ["delivery-1", created.id, "{}", now, now, now]
    );
    connection.run(
      `INSERT INTO local_webhook_deliveries (
         id, subscription_id, event, status, attempt_count, payload_json,
         created_at, updated_at, next_attempt_at
       ) VALUES (?, ?, 'task.created', 'pending', 0, ?, ?, ?, ?);`,
      ["delivery-2", created.id, "{}", now, now, now]
    );

    await expect(repository.deliverDue({ now, limit: 10 })).resolves.toEqual({
      attemptedCount: 1,
      deliveredCount: 1,
      failedCount: 0,
      deferredCount: 1
    });
    expect(deliveryRows()).toEqual([
      expect.objectContaining({
        status: "delivered",
        attemptCount: 1,
        nextAttemptAt: null
      }),
      expect.objectContaining({
        status: "retrying",
        attemptCount: 0,
        nextAttemptAt: "2026-06-10T10:00:01.000Z"
      })
    ]);
  });
});
