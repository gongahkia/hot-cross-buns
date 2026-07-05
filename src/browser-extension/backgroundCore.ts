import type { ExtensionRequest, ExtensionResponse } from "./messages";
import { GoogleApiError } from "./googleApi";
import type { AuthStatus, ExtensionSettings, PlannerCache, SearchFilter, SearchResult, StoredAccessToken } from "./types";

export interface BackgroundHandlerDependencies {
  authenticateWithGoogle: () => Promise<AuthStatus>;
  authStatus: () => Promise<AuthStatus>;
  signOut: () => Promise<AuthStatus>;
  clearAccessToken: () => Promise<void>;
  clearPlannerCache: () => Promise<void>;
  loadAccessToken: () => Promise<StoredAccessToken | undefined>;
  loadPlannerCache: () => Promise<PlannerCache | undefined>;
  loadSettings: () => Promise<ExtensionSettings>;
  savePlannerCache: (cache: PlannerCache) => Promise<void>;
  saveSettings: (settings: ExtensionSettings) => Promise<ExtensionSettings>;
  fetchPlannerCache: (accessToken: string) => Promise<PlannerCache>;
  searchPlannerCache: (
    cache: PlannerCache,
    input: { query: string; filter: SearchFilter; limit?: number }
  ) => SearchResult[];
  summarizeCache: (cache: PlannerCache | undefined) => ExtensionResponse;
}

export function createBackgroundRequestHandler(dependencies: BackgroundHandlerDependencies) {
  return async function handleRequest(message: unknown): Promise<ExtensionResponse> {
    const request = parseRequest(message);

    switch (request.type) {
      case "settings.get":
        return dependencies.loadSettings();
      case "settings.save":
        await dependencies.clearAccessToken();
        await dependencies.clearPlannerCache();
        return dependencies.saveSettings(request.settings);
      case "auth.status":
        return dependencies.authStatus();
      case "auth.start":
        return dependencies.authenticateWithGoogle();
      case "auth.signOut":
        await dependencies.clearPlannerCache();
        return dependencies.signOut();
      case "cache.summary":
        return dependencies.summarizeCache(await dependencies.loadPlannerCache());
      case "data.refresh":
        return refreshPlannerCache(dependencies);
      case "data.search": {
        const cache = await requireCache(dependencies);
        return dependencies.searchPlannerCache(cache, {
          query: request.query,
          filter: request.filter,
          limit: request.limit
        });
      }
    }
  };
}

async function refreshPlannerCache(dependencies: BackgroundHandlerDependencies): Promise<PlannerCache> {
  const token = await dependencies.loadAccessToken();

  if (!token) {
    throw new Error("Connect Google before refreshing.");
  }

  try {
    const cache = await dependencies.fetchPlannerCache(token.accessToken);
    const enriched = {
      ...cache,
      ...(token.accountEmail === undefined ? {} : { accountEmail: token.accountEmail })
    };
    await dependencies.savePlannerCache(enriched);
    return enriched;
  } catch (error) {
    if (error instanceof GoogleApiError && error.status === 401) {
      await dependencies.clearAccessToken();
      await dependencies.clearPlannerCache();
    }

    throw error;
  }
}

async function requireCache(dependencies: BackgroundHandlerDependencies): Promise<PlannerCache> {
  const cache = await dependencies.loadPlannerCache();

  if (!cache) {
    return refreshPlannerCache(dependencies);
  }

  return cache;
}

function parseRequest(message: unknown): ExtensionRequest {
  if (typeof message !== "object" || message === null) {
    throw new Error("Invalid extension request.");
  }

  const request = message as ExtensionRequest;

  if (typeof request.type !== "string") {
    throw new Error("Invalid extension request type.");
  }

  return request;
}
