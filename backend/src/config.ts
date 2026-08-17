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
    cookieSameSite
  };
}
