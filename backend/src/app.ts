import type { IncomingHttpHeaders } from "node:http";

import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import { driveMetadataScope, managedGoogleScopes, type BackendConfig } from "./config.js";
import { CredentialCipher } from "./credentialCipher.js";
import { Database } from "./database.js";
import { ManagedAuthorizationError, ManagedGoogleService, ManagedGooglePathError } from "./googleService.js";
import { ManagedStore, type ManagedSession } from "./managedStore.js";
import { ReliableSyncService, validatePushSubscription } from "./reliableSyncService.js";

const sessionCookie = "hcb_session";
const oauthAttemptCookie = "hcb_oauth_attempt";
const permittedMethods = new Set(["GET", "POST", "PATCH", "DELETE"]);

class PublicError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
    this.name = "PublicError";
  }
}

class PerSessionRateLimiter {
  private readonly entries = new Map<string, { count: number; resetAt: number }>();

  consume(subject: string): boolean {
    const now = Date.now();
    const existing = this.entries.get(subject);
    if (!existing || existing.resetAt <= now) {
      this.entries.set(subject, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    existing.count += 1;
    return existing.count <= 180;
  }
}

function cookieOptions(config: BackendConfig): { readonly httpOnly: true; readonly secure: boolean; readonly sameSite: "lax" | "none"; readonly path: string } {
  return { httpOnly: true, secure: config.cookieSecure, sameSite: config.cookieSameSite, path: "/" };
}

function callbackUrl(config: BackendConfig, result: "connected" | "error"): string {
  const target = new URL("/", config.frontendOrigins[0]);
  target.searchParams.set("managed", result);
  return target.toString();
}

function scopesFor(scope: string | undefined): readonly string[] {
  if (scope === undefined || scope === "core") return managedGoogleScopes;
  if (scope === "drive") return [...managedGoogleScopes, driveMetadataScope];
  throw new PublicError(400, "Unsupported authorization scope");
}

function requireAllowedOrigin(config: BackendConfig, request: FastifyRequest): void {
  const origin = request.headers.origin;
  if (!origin || !config.frontendOrigins.includes(origin)) throw new PublicError(403, "This request must come from the configured Hot Cross Buns app");
}

function renewSessionCookie(config: BackendConfig, request: FastifyRequest, reply: { setCookie(name: string, value: string, options: Record<string, unknown>): unknown }): void {
  const token = request.cookies[sessionCookie];
  if (token) reply.setCookie(sessionCookie, token, { ...cookieOptions(config), maxAge: config.sessionTtlDays * 86_400 });
}

async function requireSession(store: ManagedStore, config: BackendConfig, request: FastifyRequest, reply: { setCookie(name: string, value: string, options: Record<string, unknown>): unknown }): Promise<ManagedSession> {
  const session = await store.sessionForToken(request.cookies[sessionCookie]);
  if (!session) throw new PublicError(401, "Sign in with Google to continue");
  renewSessionCookie(config, request, reply);
  return session;
}

function forwardedHeaders(headers: IncomingHttpHeaders): Headers {
  const forwarded = new Headers();
  const ifMatch = headers["if-match"];
  if (typeof ifMatch === "string") forwarded.set("If-Match", ifMatch);
  const contentType = headers["content-type"];
  if (typeof contentType === "string") forwarded.set("Content-Type", contentType);
  return forwarded;
}

function proxyPath(request: FastifyRequest): string {
  const rawUrl = request.raw.url ?? "";
  const prefix = "/api/google";
  if (!rawUrl.startsWith(prefix)) throw new PublicError(400, "Invalid Google API proxy path");
  return rawUrl.slice(prefix.length);
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export async function buildApp(config: BackendConfig, database: Database): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, bodyLimit: 1_048_576, trustProxy: config.cookieSecure });
  const store = new ManagedStore(database, new CredentialCipher(config.encryptionKeys), config.sessionTtlDays);
  const google = new ManagedGoogleService(config, store);
  const reliable = new ReliableSyncService(config, database, store, google);
  const limiter = new PerSessionRateLimiter();

  await app.register(cookie);
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Content-Type-Options", "nosniff");
  });

  app.get("/api/health", async () => {
    await database.query("SELECT 1");
    return { service: "available" };
  });

  app.get<{ Querystring: { readonly scope?: string } }>("/api/auth/google/start", async (request, reply) => {
    const attempt = await store.createOAuthAttempt(scopesFor(request.query.scope));
    reply.setCookie(oauthAttemptCookie, attempt.nonce, { ...cookieOptions(config), maxAge: 10 * 60 });
    return reply.redirect(google.authorizationUrl(attempt.state, attempt.verifier, scopesFor(request.query.scope)));
  });

  app.get<{ Querystring: { readonly code?: string; readonly state?: string; readonly error?: string } }>("/api/auth/google/callback", async (request, reply) => {
    try {
      if (request.query.error || !request.query.code || !request.query.state) throw new PublicError(400, "Google authorization was not completed");
      const attempt = await store.consumeOAuthAttempt(request.query.state, request.cookies[oauthAttemptCookie] ?? "");
      reply.clearCookie(oauthAttemptCookie, cookieOptions(config));
      const exchanged = await google.exchangeCode(request.query.code, attempt.verifier);
      await store.saveCredential(exchanged.identity, exchanged.refreshToken, [...new Set([...attempt.scopes, ...exchanged.scopes])]);
      await reliable.requestSync(exchanged.identity.subject);
      const session = await store.createSession(exchanged.identity.subject, config.sessionTtlDays);
      reply.setCookie(sessionCookie, session, { ...cookieOptions(config), maxAge: config.sessionTtlDays * 86_400 });
      return reply.redirect(callbackUrl(config, "connected"));
    } catch (error) {
      reply.clearCookie(oauthAttemptCookie, cookieOptions(config));
      if (error instanceof PublicError) app.log.info({ statusCode: error.statusCode }, "Managed Google authorization was not completed");
      else app.log.warn({ error: error instanceof Error ? error.name : "unknown" }, "Managed Google authorization failed");
      return reply.redirect(callbackUrl(config, "error"));
    }
  });

  app.get("/api/session", async (request, reply) => {
    const session = await store.sessionForToken(request.cookies[sessionCookie]);
    if (session) renewSessionCookie(config, request, reply);
    return { authenticated: Boolean(session), user: session ? { subject: session.subject, email: session.email, name: session.name, picture: session.picture, scopes: session.scopes } : undefined };
  });

  app.get("/api/reliability/status", async (request, reply) => {
    const session = await requireSession(store, config, request, reply);
    return reliable.status(session.subject);
  });

  app.get("/api/push/public-key", async (request, reply) => {
    await requireSession(store, config, request, reply);
    const publicKey = reliable.publicKey();
    if (!publicKey) throw new PublicError(404, "Web Push is not enabled on this self-hosted deployment");
    return { publicKey };
  });

  app.put("/api/push/subscription", async (request, reply) => {
    requireAllowedOrigin(config, request);
    const session = await requireSession(store, config, request, reply);
    const body = object(request.body);
    const subscription = validatePushSubscription(body?.subscription);
    const contentMode = body?.contentMode;
    if (!subscription || (contentMode !== "details" && contentMode !== "generic")) throw new PublicError(400, "The Web Push subscription is invalid");
    await reliable.savePushSubscription(session.subject, subscription, contentMode);
    return reply.code(204).send();
  });

  app.delete("/api/push/subscription", async (request, reply) => {
    requireAllowedOrigin(config, request);
    const session = await requireSession(store, config, request, reply);
    const body = object(request.body);
    if (typeof body?.endpoint !== "string" || body.endpoint.length > 4096) throw new PublicError(400, "The Web Push endpoint is invalid");
    await reliable.deletePushSubscription(session.subject, body.endpoint);
    return reply.code(204).send();
  });

  app.post("/api/webhooks/google/calendar", async (request, reply) => {
    const accepted = await reliable.handleCalendarWebhook(request.headers);
    return reply.code(accepted ? 204 : 404).send();
  });

  app.post("/api/auth/logout", async (request, reply) => {
    requireAllowedOrigin(config, request);
    await store.deleteSession(request.cookies[sessionCookie]);
    reply.clearCookie(sessionCookie, cookieOptions(config));
    return reply.code(204).send();
  });

  app.post("/api/auth/google/disconnect", async (request, reply) => {
    requireAllowedOrigin(config, request);
    const session = await requireSession(store, config, request, reply);
    await reliable.disconnect(session.subject);
    const refreshToken = await store.disconnect(session.subject);
    google.forgetAccessToken(session.subject);
    await google.revoke(refreshToken);
    reply.clearCookie(sessionCookie, cookieOptions(config));
    return reply.code(204).send();
  });

  app.route({
    method: ["GET", "POST", "PATCH", "DELETE"],
    url: "/api/google/*",
    handler: async (request, reply) => {
      requireAllowedOrigin(config, request);
      if (!permittedMethods.has(request.method)) throw new PublicError(405, "Unsupported Google API method");
      const session = await requireSession(store, config, request, reply);
      if (!limiter.consume(session.subject)) throw new PublicError(429, "Too many Google API requests; retry in one minute");
      const body = request.body === undefined ? undefined : JSON.stringify(request.body);
      const response = await google.proxy(session.subject, proxyPath(request), {
        method: request.method,
        headers: forwardedHeaders(request.headers),
        body
      });
      const contentType = response.headers.get("content-type") ?? "application/json; charset=utf-8";
      if (response.ok && request.method !== "GET") await reliable.requestSync(session.subject);
      return reply.code(response.status).type(contentType).send(Buffer.from(await response.arrayBuffer()));
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof PublicError) return reply.code(error.statusCode).send({ error: { message: error.message } });
    if (error instanceof ManagedGooglePathError) return reply.code(400).send({ error: { message: error.message } });
    if (error instanceof ManagedAuthorizationError) return reply.code(401).send({ error: { message: error.message } });
    app.log.error({ error: error instanceof Error ? error.name : "unknown" }, "Unhandled self-hosted backend error");
    return reply.code(500).send({ error: { message: "The self-hosted service could not complete this request" } });
  });

  return app;
}
