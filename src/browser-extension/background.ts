import { authenticateWithGoogle, authStatus, signOut } from "./oauth";
import { clearAccessToken, clearPlannerCache, loadAccessToken, loadPlannerCache, loadSettings, savePlannerCache, saveSettings } from "./storage";
import { fetchPlannerCache } from "./googleApi";
import { searchPlannerCache, summarizeCache } from "./search";
import { configureActionSidePanel, extensionApi } from "./extensionApi";
import { createBackgroundRequestHandler } from "./backgroundCore";
import type { ExtensionMessageEnvelope } from "./messages";

configureActionSidePanel();

const handleRequest = createBackgroundRequestHandler({
  authenticateWithGoogle,
  authStatus,
  signOut,
  clearAccessToken,
  clearPlannerCache,
  loadAccessToken,
  loadPlannerCache,
  loadSettings,
  savePlannerCache,
  saveSettings,
  fetchPlannerCache,
  searchPlannerCache,
  summarizeCache
});

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
