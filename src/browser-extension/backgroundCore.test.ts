import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBackgroundRequestHandler, type BackgroundHandlerDependencies } from "./backgroundCore";
import { GoogleApiError } from "./googleApi";
import type { AuthStatus, CacheSummary, ExtensionSettings, PlannerCache, SearchResult, StoredAccessToken } from "./types";

const settings: ExtensionSettings = { googleClientId: "client.apps.googleusercontent.com" };
const auth: AuthStatus = {
  configured: true,
  signedIn: true,
  redirectUri: "https://extension.test/google",
  accountEmail: "person@example.com"
};
const token: StoredAccessToken = {
  accessToken: "access-token",
  expiresAt: 1_800_000,
  scope: "tasks calendar",
  accountEmail: "person@example.com"
};
const cache: PlannerCache = {
  fetchedAt: "2026-07-05T00:00:00.000Z",
  windowStart: "2026-06-05T00:00:00.000Z",
  windowEnd: "2027-01-01T00:00:00.000Z",
  accountEmail: "person@example.com",
  taskLists: [{ id: "list-1", title: "Inbox" }],
  calendars: [{ id: "calendar-1", title: "Calendar", primary: true, selected: true }],
  tasks: [],
  events: []
};
const summary: CacheSummary = {
  fetchedAt: cache.fetchedAt,
  taskCount: 0,
  eventCount: 0,
  accountEmail: cache.accountEmail
};
const searchResults: SearchResult[] = [{
  id: "task-1",
  kind: "task",
  title: "Task",
  subtitle: "Inbox",
  sourceUrl: "https://tasks.google.com/",
  score: 10
}];

describe("browser extension background request handler", () => {
  let dependencies: BackgroundHandlerDependencies;

  beforeEach(() => {
    dependencies = {
      authenticateWithGoogle: vi.fn(async () => auth),
      authStatus: vi.fn(async () => auth),
      signOut: vi.fn(async () => ({ ...auth, signedIn: false })),
      clearAccessToken: vi.fn(async () => undefined),
      clearPlannerCache: vi.fn(async () => undefined),
      loadAccessToken: vi.fn(async () => token),
      loadPlannerCache: vi.fn(async () => cache),
      loadSettings: vi.fn(async () => settings),
      savePlannerCache: vi.fn(async () => undefined),
      saveSettings: vi.fn(async (nextSettings) => nextSettings),
      fetchPlannerCache: vi.fn(async () => cache),
      searchPlannerCache: vi.fn(() => searchResults),
      summarizeCache: vi.fn(() => summary)
    };
  });

  it("returns auth status", async () => {
    await expect(handler({ type: "auth.status" })).resolves.toEqual(auth);
    expect(dependencies.authStatus).toHaveBeenCalledTimes(1);
  });

  it("clears token and cache before saving settings", async () => {
    await expect(handler({ type: "settings.save", settings })).resolves.toEqual(settings);
    expect(dependencies.clearAccessToken).toHaveBeenCalledTimes(1);
    expect(dependencies.clearPlannerCache).toHaveBeenCalledTimes(1);
    expect(dependencies.saveSettings).toHaveBeenCalledWith(settings);
  });

  it("clears cache on sign out", async () => {
    await expect(handler({ type: "auth.signOut" })).resolves.toMatchObject({ signedIn: false });
    expect(dependencies.clearPlannerCache).toHaveBeenCalledTimes(1);
    expect(dependencies.signOut).toHaveBeenCalledTimes(1);
  });

  it("refreshes data with the saved access token and enriches account email", async () => {
    await expect(handler({ type: "data.refresh" })).resolves.toMatchObject({
      accountEmail: "person@example.com"
    });
    expect(dependencies.fetchPlannerCache).toHaveBeenCalledWith("access-token");
    expect(dependencies.savePlannerCache).toHaveBeenCalledWith(cache);
  });

  it("searches cached data", async () => {
    await expect(handler({ type: "data.search", query: "task", filter: "all", limit: 5 })).resolves.toEqual(searchResults);
    expect(dependencies.searchPlannerCache).toHaveBeenCalledWith(cache, {
      query: "task",
      filter: "all",
      limit: 5
    });
  });

  it("refreshes before search on cache miss", async () => {
    vi.mocked(dependencies.loadPlannerCache).mockResolvedValue(undefined);

    await expect(handler({ type: "data.search", query: "task", filter: "all" })).resolves.toEqual(searchResults);
    expect(dependencies.fetchPlannerCache).toHaveBeenCalledWith("access-token");
    expect(dependencies.searchPlannerCache).toHaveBeenCalled();
  });

  it("clears token and cache after a 401 refresh failure", async () => {
    vi.mocked(dependencies.fetchPlannerCache).mockRejectedValue(new GoogleApiError(401, "Unauthorized"));

    await expect(handler({ type: "data.refresh" })).rejects.toThrow("Unauthorized");
    expect(dependencies.clearAccessToken).toHaveBeenCalledTimes(1);
    expect(dependencies.clearPlannerCache).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid requests", async () => {
    await expect(handler({ nope: true })).rejects.toThrow("Invalid extension request type.");
  });

  function handler(message: unknown) {
    return createBackgroundRequestHandler(dependencies)(message);
  }
});
