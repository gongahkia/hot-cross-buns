import { describe, expect, it } from "vitest";
import type { GoogleStatusResponse } from "@shared/ipc/contracts";
import { hasLinkedGoogleAccount } from "./googleCapabilities";

const status = (connectionState: string, id = "subject"): GoogleStatusResponse => ({
  oauthClientConfigured: true, clientId: "test-client", hasClientSecret: false,
  accounts: [{ accountId: id, googleAccountId: id, connectionState, email: null, displayName: null, missingScopes: [] }]
});

describe("required Google account", () => {
  it.each(["connected", "reauth_required", "error"])("retains a linked account when its state is %s", state => {
    expect(hasLinkedGoogleAccount(status(state))).toBe(true);
  });
  it.each(["disconnected", "local", "unknown"])("does not unlock with state %s", state => {
    expect(hasLinkedGoogleAccount(status(state))).toBe(false);
  });
  it("rejects local placeholders and unverified or missing identities", () => {
    expect(hasLinkedGoogleAccount(status("connected", "local"))).toBe(false);
    expect(hasLinkedGoogleAccount({ ...status("connected"), accounts: [] })).toBe(false);
    expect(hasLinkedGoogleAccount({ ...status("connected"), accounts: [{ accountId: "legacy", connectionState: "connected", email: null, displayName: null, missingScopes: [] }] })).toBe(false);
  });
});
