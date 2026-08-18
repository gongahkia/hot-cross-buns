import { createHash, randomBytes } from "node:crypto";

import type { QueryResultRow } from "pg";

import { CredentialCipher } from "./credentialCipher.js";
import { Database } from "./database.js";

const oauthAttemptLifetimeMilliseconds = 10 * 60_000;

export interface ManagedIdentity {
  readonly subject: string;
  readonly email?: string;
  readonly name?: string;
  readonly picture?: string;
}

export interface ManagedSession {
  readonly subject: string;
  readonly email?: string;
  readonly name?: string;
  readonly picture?: string;
  readonly scopes: readonly string[];
}

interface UserRow extends QueryResultRow {
  readonly subject: string;
  readonly email: string | null;
  readonly name: string | null;
  readonly picture: string | null;
}

interface CredentialRow extends QueryResultRow {
  readonly encrypted_refresh_token: string;
  readonly scopes: readonly string[];
  readonly revision: number;
}

interface SubjectRow extends QueryResultRow {
  readonly subject: string;
}

interface OAuthAttemptRow extends QueryResultRow {
  readonly nonce_hash: string;
  readonly code_verifier: string;
  readonly scopes: readonly string[];
  readonly expires_at: Date;
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashOpaqueValue(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function credentialAssociatedData(subject: string): string {
  return `hot-cross-buns/google-refresh-token/${subject}`;
}

export class ManagedStore {
  constructor(
    private readonly database: Database,
    private readonly cipher: CredentialCipher,
    private readonly sessionTtlDays: number
  ) {}

  async cleanExpired(): Promise<void> {
    await Promise.all([
      this.database.query("DELETE FROM managed_sessions WHERE expires_at <= now()"),
      this.database.query("DELETE FROM managed_oauth_attempts WHERE expires_at <= now()")
    ]);
  }

  async createOAuthAttempt(scopes: readonly string[]): Promise<{ readonly state: string; readonly nonce: string; readonly verifier: string }> {
    const state = randomToken();
    const nonce = randomToken();
    const verifier = randomToken();
    await this.cleanExpired();
    await this.database.query(
      `INSERT INTO managed_oauth_attempts (state_hash, nonce_hash, code_verifier, scopes, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [hashOpaqueValue(state), hashOpaqueValue(nonce), verifier, scopes, new Date(Date.now() + oauthAttemptLifetimeMilliseconds)]
    );
    return { state, nonce, verifier };
  }

  async consumeOAuthAttempt(state: string, nonce: string): Promise<{ readonly verifier: string; readonly scopes: readonly string[] }> {
    return this.database.transaction(async (client) => {
      const result = await client.query<OAuthAttemptRow>(
        `DELETE FROM managed_oauth_attempts
         WHERE state_hash = $1 AND expires_at > now()
         RETURNING nonce_hash, code_verifier, scopes, expires_at`,
        [hashOpaqueValue(state)]
      );
      const attempt = result.rows[0];
      if (!attempt || hashOpaqueValue(nonce) !== attempt.nonce_hash) throw new Error("OAuth authorization attempt is invalid or expired");
      return { verifier: attempt.code_verifier, scopes: attempt.scopes };
    });
  }

  async saveCredential(identity: ManagedIdentity, refreshToken: string | undefined, scopes: readonly string[]): Promise<void> {
    await this.database.transaction(async (client) => {
      await client.query(
        `INSERT INTO managed_users (subject, email, name, picture)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (subject) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, picture = EXCLUDED.picture, updated_at = now()`,
        [identity.subject, identity.email ?? null, identity.name ?? null, identity.picture ?? null]
      );
      const existing = await client.query<CredentialRow>(
        "SELECT encrypted_refresh_token, scopes, revision FROM managed_google_credentials WHERE subject = $1 FOR UPDATE",
        [identity.subject]
      );
      const encryptedRefreshToken = refreshToken
        ? this.cipher.encrypt(refreshToken, credentialAssociatedData(identity.subject))
        : existing.rows[0]?.encrypted_refresh_token;
      if (!encryptedRefreshToken) throw new Error("Google did not issue a refresh token; disconnect this app in Google and authorize again");
      const mergedScopes = [...new Set([...(existing.rows[0]?.scopes ?? []), ...scopes])];
      await client.query(
        `INSERT INTO managed_google_credentials (subject, encrypted_refresh_token, scopes, revision)
         VALUES ($1, $2, $3, 1)
         ON CONFLICT (subject) DO UPDATE SET encrypted_refresh_token = EXCLUDED.encrypted_refresh_token, scopes = EXCLUDED.scopes, revision = managed_google_credentials.revision + 1, updated_at = now()`,
        [identity.subject, encryptedRefreshToken, mergedScopes]
      );
    });
  }

  async sessionForToken(token: string | undefined): Promise<ManagedSession | undefined> {
    if (!token) return undefined;
    const result = await this.database.query<UserRow & CredentialRow>(
      `SELECT users.subject, users.email, users.name, users.picture, credentials.scopes
       FROM managed_sessions sessions
       JOIN managed_users users ON users.subject = sessions.subject
       JOIN managed_google_credentials credentials ON credentials.subject = users.subject
       WHERE sessions.token_hash = $1 AND sessions.expires_at > now()`,
      [hashOpaqueValue(token)]
    );
    const row = result.rows[0];
    if (!row) return undefined;
    await this.database.query(
      "UPDATE managed_sessions SET last_seen_at = now(), expires_at = $2 WHERE token_hash = $1",
      [hashOpaqueValue(token), new Date(Date.now() + this.sessionTtlDays * 86_400_000)]
    );
    return { subject: row.subject, email: row.email ?? undefined, name: row.name ?? undefined, picture: row.picture ?? undefined, scopes: row.scopes };
  }

  async createSession(subject: string, ttlDays: number): Promise<string> {
    const token = randomToken();
    await this.cleanExpired();
    await this.database.query(
      "INSERT INTO managed_sessions (token_hash, subject, expires_at) VALUES ($1, $2, $3)",
      [hashOpaqueValue(token), subject, new Date(Date.now() + ttlDays * 86_400_000)]
    );
    return token;
  }

  async deleteSession(token: string | undefined): Promise<void> {
    if (token) await this.database.query("DELETE FROM managed_sessions WHERE token_hash = $1", [hashOpaqueValue(token)]);
  }

  async disconnect(subject: string): Promise<string | undefined> {
    return this.database.transaction(async (client) => {
      const result = await client.query<CredentialRow>(
        "DELETE FROM managed_google_credentials WHERE subject = $1 RETURNING encrypted_refresh_token, scopes, revision",
        [subject]
      );
      const encrypted = result.rows[0]?.encrypted_refresh_token;
      await client.query("DELETE FROM managed_users WHERE subject = $1", [subject]);
      return encrypted ? this.cipher.decrypt(encrypted, credentialAssociatedData(subject)) : undefined;
    });
  }

  async refreshTokenFor(subject: string): Promise<string | undefined> {
    const result = await this.database.query<CredentialRow>(
      "SELECT encrypted_refresh_token, scopes, revision FROM managed_google_credentials WHERE subject = $1",
      [subject]
    );
    const credential = result.rows[0];
    return credential ? this.cipher.decrypt(credential.encrypted_refresh_token, credentialAssociatedData(subject)) : undefined;
  }

  async connectedSubjects(): Promise<readonly string[]> {
    const result = await this.database.query<SubjectRow>("SELECT subject FROM managed_google_credentials ORDER BY subject");
    return result.rows.map((row) => row.subject);
  }
}
