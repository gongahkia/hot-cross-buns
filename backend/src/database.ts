import { Pool, type PoolClient, type QueryResultRow } from "pg";

export class Database {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 12, idleTimeoutMillis: 30_000 });
  }

  query<Row extends QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<{ readonly rows: readonly Row[] }> {
    return this.pool.query<Row>(text, [...values]).then((result) => ({ rows: result.rows }));
  }

  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Runs work only in one process at a time; PostgreSQL releases the lock if it dies. */
  async withAdvisoryLock<T>(name: string, callback: () => Promise<T>): Promise<T | undefined> {
    const client = await this.pool.connect();
    try {
      const result = await client.query<{ readonly acquired: boolean }>("SELECT pg_try_advisory_lock(hashtext($1)) AS acquired", [name]);
      if (!result.rows[0]?.acquired) return undefined;
      try {
        return await callback();
      } finally {
        await client.query("SELECT pg_advisory_unlock(hashtext($1))", [name]);
      }
    } finally {
      client.release();
    }
  }

  async migrate(): Promise<void> {
    await this.query(`
      CREATE TABLE IF NOT EXISTS managed_users (
        subject TEXT PRIMARY KEY,
        email TEXT,
        name TEXT,
        picture TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS managed_google_credentials (
        subject TEXT PRIMARY KEY REFERENCES managed_users(subject) ON DELETE CASCADE,
        encrypted_refresh_token TEXT NOT NULL,
        scopes TEXT[] NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS managed_sessions (
        token_hash TEXT PRIMARY KEY,
        subject TEXT NOT NULL REFERENCES managed_users(subject) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS managed_sessions_subject_idx ON managed_sessions(subject);
      CREATE INDEX IF NOT EXISTS managed_sessions_expiry_idx ON managed_sessions(expires_at);
      CREATE TABLE IF NOT EXISTS managed_oauth_attempts (
        state_hash TEXT PRIMARY KEY,
        nonce_hash TEXT NOT NULL,
        code_verifier TEXT NOT NULL,
        scopes TEXT[] NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS managed_oauth_attempts_expiry_idx ON managed_oauth_attempts(expires_at);
      CREATE TABLE IF NOT EXISTS managed_reliability_state (
        subject TEXT PRIMARY KEY REFERENCES managed_users(subject) ON DELETE CASCADE,
        last_sync_at TIMESTAMPTZ,
        sync_requested_at TIMESTAMPTZ,
        last_error TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS managed_calendar_sync_cursors (
        subject TEXT NOT NULL REFERENCES managed_users(subject) ON DELETE CASCADE,
        resource TEXT NOT NULL,
        sync_token TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (subject, resource)
      );
      CREATE TABLE IF NOT EXISTS managed_calendar_lists (
        subject TEXT NOT NULL REFERENCES managed_users(subject) ON DELETE CASCADE,
        calendar_id TEXT NOT NULL,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (subject, calendar_id)
      );
      CREATE TABLE IF NOT EXISTS managed_calendar_events (
        subject TEXT NOT NULL REFERENCES managed_users(subject) ON DELETE CASCADE,
        calendar_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (subject, calendar_id, event_id)
      );
      CREATE INDEX IF NOT EXISTS managed_calendar_events_updated_idx ON managed_calendar_events(subject, updated_at);
      CREATE TABLE IF NOT EXISTS managed_task_lists (
        subject TEXT NOT NULL REFERENCES managed_users(subject) ON DELETE CASCADE,
        task_list_id TEXT NOT NULL,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (subject, task_list_id)
      );
      CREATE TABLE IF NOT EXISTS managed_tasks (
        subject TEXT NOT NULL REFERENCES managed_users(subject) ON DELETE CASCADE,
        task_list_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (subject, task_list_id, task_id)
      );
      CREATE INDEX IF NOT EXISTS managed_tasks_updated_idx ON managed_tasks(subject, updated_at);
      CREATE TABLE IF NOT EXISTS managed_calendar_channels (
        channel_id TEXT PRIMARY KEY,
        subject TEXT NOT NULL REFERENCES managed_users(subject) ON DELETE CASCADE,
        calendar_id TEXT,
        resource_id TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS managed_calendar_channels_expiry_idx ON managed_calendar_channels(expires_at);
      CREATE TABLE IF NOT EXISTS managed_push_subscriptions (
        id TEXT PRIMARY KEY,
        subject TEXT NOT NULL REFERENCES managed_users(subject) ON DELETE CASCADE,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        content_mode TEXT NOT NULL CHECK (content_mode IN ('details', 'generic')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS managed_push_subscriptions_subject_idx ON managed_push_subscriptions(subject);
      CREATE TABLE IF NOT EXISTS managed_push_deliveries (
        subscription_id TEXT NOT NULL REFERENCES managed_push_subscriptions(id) ON DELETE CASCADE,
        reminder_key TEXT NOT NULL,
        delivered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (subscription_id, reminder_key)
      );
    `);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
