import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserGoogleClientConfiguration, googleClientIdStorageKey } from "./googleClientConfiguration";

const first = "1234567890-first.apps.googleusercontent.com";
const second = "1234567890-second.apps.googleusercontent.com";
afterEach(() => localStorage.clear());

describe("browser Google client configuration", () => {
  it("uses the deployment default until a local override is saved, then survives reopening", () => {
    const config = createBrowserGoogleClientConfiguration(first);
    expect(config.read()).toBe(first);
    expect(config.save({ clientId: ` ${second} ` })).toEqual({ ok: true, data: second });
    expect(createBrowserGoogleClientConfiguration(first).read()).toBe(second);
    expect(localStorage.getItem(googleClientIdStorageKey)).toBe(second);
  });

  it("reads the latest configuration from other tabs and falls back for missing or corrupt values", () => {
    const config = createBrowserGoogleClientConfiguration(first);
    localStorage.setItem(googleClientIdStorageKey, second);
    expect(config.read()).toBe(second);
    localStorage.setItem(googleClientIdStorageKey, "not a client");
    expect(config.read()).toBe(first);
    localStorage.removeItem(googleClientIdStorageKey);
    expect(config.read()).toBe(first);
    expect(createBrowserGoogleClientConfiguration().read()).toBeNull();
  });

  it.each(["", "email@example.com", "https://example.com", "x.apps.googleusercontent.com/", "x".repeat(501), null])("rejects invalid client input %s without replacing saved configuration", (clientId) => {
    const config = createBrowserGoogleClientConfiguration();
    config.save({ clientId: first });
    expect(config.save({ clientId }).ok).toBe(false);
    expect(config.read()).toBe(first);
  });

  it("rejects client secrets without persisting them", () => {
    const config = createBrowserGoogleClientConfiguration(first);
    expect(config.save({ clientId: second, clientSecret: "do-not-store" }).ok).toBe(false);
    expect(localStorage.length).toBe(0);
    expect(config.read()).toBe(first);
  });

  it("reports failed persistence and retains the previous effective client", () => {
    const blocked = { getItem: () => first, setItem: vi.fn(() => { throw new DOMException("Quota exceeded"); }) } as unknown as Storage;
    const config = createBrowserGoogleClientConfiguration(undefined, () => blocked);
    const result = config.save({ clientId: second });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("could not be saved");
    expect(config.read()).toBe(first);
  });

  it("retains the deployment default when storage is unavailable", () => {
    const config = createBrowserGoogleClientConfiguration(first, () => { throw new DOMException("Access denied"); });
    expect(config.read()).toBe(first);
    expect(config.save({ clientId: second }).ok).toBe(false);
  });
});
