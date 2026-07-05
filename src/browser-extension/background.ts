import { authenticateWithGoogle, authStatus, signOut } from "./oauth";
import { clearAccessToken, clearPlannerCache, loadAccessToken, loadPlannerCache, loadSettings, savePlannerCache, saveSettings } from "./storage";
import { fetchPlannerCache, GoogleApiError } from "./googleApi";
import { searchPlannerCache, summarizeCache } from "./search";
import { configureActionSidePanel, extensionApi } from "./extensionApi";
import type { ExtensionMessageEnvelope, ExtensionRequest, ExtensionResponse } from "./messages";
import type { PlannerCache } from "./types";

configureActionSidePanel();

extensionApi().runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void handleRequest(message)
    .then((data) => sendResponse({ ok: true, data } satisfies ExtensionMessageEnvelope))
    .catch((error: unknown) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      } satisfies ExtensionMessageEnvelope);
    });

  return true;
});

async function handleRequest(message: unknown): Promise<ExtensionResponse> {
  const request = parseRequest(message);

  switch (request.type) {
    case "settings.get":
      return loadSettings();
    case "settings.save":
      await clearAccessToken();
      await clearPlannerCache();
      return saveSettings(request.settings);
    case "auth.status":
      return authStatus();
    case "auth.start":
      return authenticateWithGoogle();
    case "auth.signOut":
      await clearPlannerCache();
      return signOut();
    case "cache.summary":
      return summarizeCache(await loadPlannerCache());
    case "data.refresh":
      return refreshPlannerCache();
    case "data.search": {
      const cache = await requireCache();
      return searchPlannerCache(cache, {
        query: request.query,
        filter: request.filter,
        limit: request.limit
      });
    }
  }
}

async function refreshPlannerCache(): Promise<PlannerCache> {
  const token = await loadAccessToken();

  if (!token) {
    throw new Error("Connect Google before refreshing.");
  }

  try {
    const cache = await fetchPlannerCache(token.accessToken);
    const enriched = {
      ...cache,
      ...(token.accountEmail === undefined ? {} : { accountEmail: token.accountEmail })
    };
    await savePlannerCache(enriched);
    return enriched;
  } catch (error) {
    if (error instanceof GoogleApiError && error.status === 401) {
      await clearAccessToken();
      await clearPlannerCache();
    }

    throw error;
  }
}

async function requireCache(): Promise<PlannerCache> {
  const cache = await loadPlannerCache();

  if (!cache) {
    return refreshPlannerCache();
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
