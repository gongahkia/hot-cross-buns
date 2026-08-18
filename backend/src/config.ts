export const managedGoogleScopes = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/tasks",
  "https://www.googleapis.com/auth/calendar"
] as const;

export const driveMetadataScope = "https://www.googleapis.com/auth/drive.metadata.readonly";

export interface EncryptionKeyRing {
  readonly activeId: string;
  readonly keys: ReadonlyMap<string, Buffer>;
}

export interface BackendConfig {
  readonly port: number;
  readonly databaseUrl: string;
  readonly publicOrigin: string;
  readonly frontendOrigins: readonly string[];
  readonly googleClientId: string;
  readonly googleClientSecret: string;
  readonly encryptionKeys: EncryptionKeyRing;
  readonly sessionTtlDays: number;
  readonly cookieSecure: boolean;
  readonly cookieSameSite: "lax" | "none";
  /** Enables the user-operated mirror, scheduler, and Web Push endpoints. */
  readonly reliableSyncEnabled: boolean;
  readonly vapid?: {
    readonly subject: string;
    readonly publicKey: string;
    readonly privateKey: string;
  };
  /** Optional public callback used by Google Calendar watch channels. */
  readonly googleCalendarWebhookUrl?: string;
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} must be configured`);
  return value;
}

function normalizeOrigin(value: string, name: string): string {
  const url = new URL(value);
  if (url.pathname !== "/" || url.search || url.hash) throw new Error(`${name} must be an origin without a path, query, or fragment`);
  return url.origin;
}

function positiveInteger(value: string | undefined, fallback: number, name: string, maximum = 365): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  return parsed;
}

function enabled(value: string | undefined, name: string): boolean {
  if (!value || value === "false") return false;
  if (value === "true") return true;
  throw new Error(`${name} must be true or false`);
}

function parseKeyRing(environment: NodeJS.ProcessEnv): EncryptionKeyRing {
  const pairs = required(environment, "HCB_ENCRYPTION_KEYS").split(",").map((entry) => entry.trim()).filter(Boolean);
  const keys = new Map<string, Buffer>();
  for (const pair of pairs) {
    const separator = pair.indexOf(":");
    if (separator <= 0) throw new Error("HCB_ENCRYPTION_KEYS entries must use key-id:base64-key");
    const id = pair.slice(0, separator).trim();
    const key = Buffer.from(pair.slice(separator + 1).trim(), "base64");
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || key.length !== 32 || keys.has(id)) {
      throw new Error("HCB_ENCRYPTION_KEYS must contain unique key IDs and 32-byte base64 keys");
    }
    keys.set(id, key);
  }
  const activeId = required(environment, "HCB_ACTIVE_ENCRYPTION_KEY_ID");
  if (!keys.has(activeId)) throw new Error("HCB_ACTIVE_ENCRYPTION_KEY_ID is not present in HCB_ENCRYPTION_KEYS");
  return { activeId, keys };
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): BackendConfig {
  const publicOrigin = normalizeOrigin(required(environment, "HCB_PUBLIC_ORIGIN"), "HCB_PUBLIC_ORIGIN");
  const frontendOrigins = required(environment, "HCB_FRONTEND_ORIGINS").split(",").map((entry) => normalizeOrigin(entry.trim(), "HCB_FRONTEND_ORIGINS"));
  const cookieSameSite = environment.HCB_SESSION_SAME_SITE === "none" ? "none" : "lax";
  const cookieSecure = publicOrigin.startsWith("https:");
  const reliableSyncEnabled = enabled(environment.HCB_RELIABLE_SYNC_ENABLED, "HCB_RELIABLE_SYNC_ENABLED");
  if (reliableSyncEnabled && (frontendOrigins.length !== 1 || frontendOrigins[0] !== publicOrigin)) {
    throw new Error("HCB_RELIABLE_SYNC_ENABLED=true requires HCB_FRONTEND_ORIGINS to contain only HCB_PUBLIC_ORIGIN");
  }
  const vapidPublicKey = environment.HCB_VAPID_PUBLIC_KEY?.trim();
  const vapidPrivateKey = environment.HCB_VAPID_PRIVATE_KEY?.trim();
  const vapidSubject = environment.HCB_VAPID_SUBJECT?.trim();
  if (reliableSyncEnabled && (!vapidPublicKey || !vapidPrivateKey || !vapidSubject)) {
    throw new Error("HCB_VAPID_SUBJECT, HCB_VAPID_PUBLIC_KEY, and HCB_VAPID_PRIVATE_KEY are required when HCB_RELIABLE_SYNC_ENABLED=true");
  }
  if ((vapidPublicKey || vapidPrivateKey || vapidSubject) && (!vapidPublicKey || !vapidPrivateKey || !vapidSubject)) {
    throw new Error("HCB VAPID configuration must include subject, public key, and private key together");
  }
  if (vapidSubject && !/^mailto:[^\s@]+@[^\s@]+$|^https:\/\//.test(vapidSubject)) {
    throw new Error("HCB_VAPID_SUBJECT must be a mailto: address or HTTPS URL");
  }
  const configuredWebhook = environment.HCB_GOOGLE_CALENDAR_WEBHOOK_URL?.trim();
  const googleCalendarWebhookUrl = configuredWebhook ? new URL(configuredWebhook).toString() : undefined;
  if (googleCalendarWebhookUrl) {
    const webhook = new URL(googleCalendarWebhookUrl);
    if (webhook.protocol !== "https:" || webhook.origin !== publicOrigin || webhook.pathname !== "/api/webhooks/google/calendar" || webhook.search || webhook.hash) {
      throw new Error("HCB_GOOGLE_CALENDAR_WEBHOOK_URL must be the HTTPS same-origin /api/webhooks/google/calendar URL");
    }
  }
  if (cookieSameSite === "none" && !cookieSecure) throw new Error("HCB_SESSION_SAME_SITE=none requires an HTTPS HCB_PUBLIC_ORIGIN");
  return {
    port: positiveInteger(environment.PORT, 8787, "PORT", 65_535),
    databaseUrl: required(environment, "DATABASE_URL"),
    publicOrigin,
    frontendOrigins,
    googleClientId: required(environment, "HCB_GOOGLE_CLIENT_ID"),
    googleClientSecret: required(environment, "HCB_GOOGLE_CLIENT_SECRET"),
    encryptionKeys: parseKeyRing(environment),
    sessionTtlDays: positiveInteger(environment.HCB_SESSION_TTL_DAYS, 30, "HCB_SESSION_TTL_DAYS"),
    cookieSecure,
    cookieSameSite,
    reliableSyncEnabled,
    vapid: vapidPublicKey && vapidPrivateKey && vapidSubject ? { subject: vapidSubject, publicKey: vapidPublicKey, privateKey: vapidPrivateKey } : undefined,
    googleCalendarWebhookUrl
  };
}
