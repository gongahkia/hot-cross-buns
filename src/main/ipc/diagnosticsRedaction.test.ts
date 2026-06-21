import { describe, expect, it } from "vitest";
import { redactDiagnosticText, redactDiagnosticsValue } from "./diagnosticsRedaction";

describe("diagnostics redaction", () => {
  it("redacts tokens, secrets, raw Google payloads, MCP bearer tokens, and sensitive bodies", () => {
    const redacted = redactDiagnosticsValue({
      accessToken: "access-token-value",
      refresh_token: "refresh-token-value",
      clientSecret: "client-secret-value",
      authorization: "Bearer mcp-bearer-token",
      rawGooglePayload: {
        title: "Sensitive event title",
        description: "Sensitive event body"
      },
      task: {
        notes: "Sensitive task notes"
      },
      note: {
        body: "Sensitive note body"
      },
      safeCount: 3
    });

    expect(JSON.stringify(redacted)).not.toMatch(
      /access-token-value|refresh-token-value|client-secret-value|mcp-bearer-token|Sensitive/
    );
    expect(redacted).toMatchObject({
      accessToken: "[REDACTED]",
      refresh_token: "[REDACTED]",
      clientSecret: "[REDACTED]",
      authorization: "[REDACTED]",
      rawGooglePayload: "[REDACTED]",
      task: {
        notes: "[OMITTED]"
      },
      note: "[OMITTED]",
      safeCount: 3
    });
  });

  it("scrubs bearer and OAuth-looking strings in diagnostic text", () => {
    const text = redactDiagnosticText(
      "Authorization: Bearer abc.def.ghi access_token=secret client_secret=client-secret path=/home/alice/.config/Hot Cross Buns"
    );

    expect(text).not.toMatch(/abc\.def\.ghi|=secret(?:\s|$)|=client-secret/);
    expect(text).not.toContain("/home/alice");
    expect(text).toContain("Bearer [REDACTED]");
  });
});
