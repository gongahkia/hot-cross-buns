import { describe, expect, it } from "vitest";
import {
  REDACTED_VALUE,
  redactAuditText,
  redactDiagnosticDetails,
  redactLogValue,
  redactMetadata,
  redactSensitiveKey,
  redactSensitiveText
} from "./redaction";

const fakeSecrets = [
  "fake-access-token",
  "fake-refresh-token",
  "fake-mcp-token",
  "fake-client-secret",
  "Bearer fake-bearer-token"
];

function expectNoFakeSecrets(value: unknown): void {
  const serialized = JSON.stringify(value);

  for (const secret of fakeSecrets) {
    expect(serialized).not.toContain(secret);
  }
}

describe("central redaction utilities", () => {
  it("redacts representative token and secret patterns from text", () => {
    const redacted = redactSensitiveText(
      [
        "access_token=fake-access-token",
        "refreshToken: fake-refresh-token",
        "client_secret=fake-client-secret",
        "Authorization: Bearer fake-bearer-token",
        '{"mcpToken":"fake-mcp-token"}',
        "/home/alice/.config/Hot Cross Buns"
      ].join(" ")
    );

    expect(redacted).toContain(REDACTED_VALUE);
    expectNoFakeSecrets(redacted);
    expect(redacted).not.toContain("/home/alice");
  });

  it("redacts log objects recursively without preserving sensitive keys", () => {
    const redacted = redactLogValue({
      message: "request failed Authorization: Bearer fake-bearer-token",
      nested: {
        refreshToken: "fake-refresh-token"
      }
    });

    expectNoFakeSecrets(redacted);
    expect(JSON.stringify(redacted)).not.toContain("refreshToken");
  });

  it("redacts diagnostics and metadata before persistence or IPC exposure", () => {
    expect(
      redactDiagnosticDetails({
        token: "fake-access-token",
        reason: "client_secret=fake-client-secret"
      })
    ).toEqual({
      [REDACTED_VALUE]: REDACTED_VALUE,
      reason: `client_secret=${REDACTED_VALUE}`
    });
    expectNoFakeSecrets(
      redactMetadata({
        account: "generated@example.invalid",
        refresh_token: "fake-refresh-token"
      })
    );
  });

  it("redacts audit text and suspicious argument keys", () => {
    expect(redactAuditText("MCPTest Bearer fake-mcp-token")).toBe(
      `MCPTest Bearer ${REDACTED_VALUE}`
    );
    expect(redactSensitiveKey("refreshToken")).toBe(REDACTED_VALUE);
  });
});
