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
});
