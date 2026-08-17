import { Pool, type PoolClient, type QueryResultRow } from "pg";

export class Database {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 12, idleTimeoutMillis: 30_000 });
  }

  query<Row extends QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<{ readonly rows: readonly Row[] }> {
    return this.pool.query<Row>(text, values).then((result) => ({ rows: result.rows }));
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
    `);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
