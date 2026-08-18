import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

const key = Buffer.alloc(32, 3).toString("base64");

function environment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: "postgres://hcb:password@127.0.0.1:5432/hcb",
    HCB_PUBLIC_ORIGIN: "http://127.0.0.1:8787",
    HCB_FRONTEND_ORIGINS: "http://127.0.0.1:5173",
    HCB_GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com",
    HCB_GOOGLE_CLIENT_SECRET: "server-secret",
    HCB_ENCRYPTION_KEYS: `primary:${key}`,
    HCB_ACTIVE_ENCRYPTION_KEY_ID: "primary",
    ...extra
  };
}

describe("loadConfig", () => {
  it("accepts a normal API port and parses the encryption keyring", () => {
    const config = loadConfig(environment({ PORT: "8787" }));

    expect(config.port).toBe(8787);
    expect(config.encryptionKeys.keys.get("primary")).toHaveLength(32);
  });

  it("rejects third-party cookie configuration without HTTPS", () => {
    expect(() => loadConfig(environment({ HCB_SESSION_SAME_SITE: "none" }))).toThrow("requires an HTTPS");
  });

  it("requires VAPID keys when the self-hosted reliability worker is enabled", () => {
    expect(() => loadConfig(environment({ HCB_RELIABLE_SYNC_ENABLED: "true", HCB_FRONTEND_ORIGINS: "http://127.0.0.1:8787" }))).toThrow("VAPID");
  });

  it("accepts same-origin Google Calendar webhook configuration", () => {
    const config = loadConfig(environment({
      HCB_PUBLIC_ORIGIN: "https://calendar.example.test",
      HCB_FRONTEND_ORIGINS: "https://calendar.example.test",
      HCB_RELIABLE_SYNC_ENABLED: "true",
      HCB_VAPID_SUBJECT: "mailto:admin@example.test",
      HCB_VAPID_PUBLIC_KEY: "public-key",
      HCB_VAPID_PRIVATE_KEY: "private-key",
      HCB_GOOGLE_CALENDAR_WEBHOOK_URL: "https://calendar.example.test/api/webhooks/google/calendar"
    }));

    expect(config.googleCalendarWebhookUrl).toBe("https://calendar.example.test/api/webhooks/google/calendar");
  });
});
