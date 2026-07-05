import { storageGet, storageRemove, storageSet } from "./extensionApi";
import type { ExtensionSettings, PlannerCache, StoredAccessToken } from "./types";

const settingsKey = "hcb.extension.settings";
const tokenKey = "hcb.extension.accessToken";
const cacheKey = "hcb.extension.plannerCache";

let memoryToken: StoredAccessToken | undefined;
let memoryCache: PlannerCache | undefined;

export async function loadSettings(): Promise<ExtensionSettings> {
  const stored = await storageGet<Partial<ExtensionSettings>>("local", settingsKey);
  return {
    googleClientId: typeof stored?.googleClientId === "string" ? stored.googleClientId.trim() : ""
  };
}

export async function saveSettings(settings: ExtensionSettings): Promise<ExtensionSettings> {
  const normalized = {
    googleClientId: settings.googleClientId.trim()
  };
  await storageSet("local", settingsKey, normalized);
  return normalized;
}

export async function clearSettings(): Promise<void> {
  await storageRemove("local", settingsKey);
}

export async function loadAccessToken(now = Date.now()): Promise<StoredAccessToken | undefined> {
  const token = await storageGet<StoredAccessToken>("session", tokenKey) ?? memoryToken;

  if (!token || token.expiresAt <= now + 30_000) {
    await clearAccessToken();
    return undefined;
  }

  return token;
}

export async function saveAccessToken(token: StoredAccessToken): Promise<void> {
  memoryToken = token;
  await storageSet("session", tokenKey, token);
}

export async function clearAccessToken(): Promise<void> {
  memoryToken = undefined;
  await storageRemove("session", tokenKey);
}

export async function loadPlannerCache(): Promise<PlannerCache | undefined> {
  return await storageGet<PlannerCache>("session", cacheKey) ?? memoryCache;
}

export async function savePlannerCache(cache: PlannerCache): Promise<void> {
  memoryCache = cache;
  await storageSet("session", cacheKey, cache);
}

export async function clearPlannerCache(): Promise<void> {
  memoryCache = undefined;
  await storageRemove("session", cacheKey);
}
