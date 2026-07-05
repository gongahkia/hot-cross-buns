import type { AuthStatus, CacheSummary, ExtensionSettings, PlannerCache, SearchFilter, SearchResult } from "./types";

export type ExtensionRequest =
  | { type: "settings.get" }
  | { type: "settings.save"; settings: ExtensionSettings }
  | { type: "auth.status" }
  | { type: "auth.start" }
  | { type: "auth.signOut" }
  | { type: "cache.summary" }
  | { type: "data.refresh" }
  | { type: "data.search"; query: string; filter: SearchFilter; limit?: number };

export type ExtensionResponse =
  | ExtensionSettings
  | AuthStatus
  | CacheSummary
  | PlannerCache
  | SearchResult[];

export type ExtensionMessageEnvelope =
  | { ok: true; data: ExtensionResponse }
  | { ok: false; error: string };
