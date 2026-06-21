import { describe, expect, it, vi } from "vitest";
import { GoogleApiError, GoogleHttpApiTransport } from "./transport";

describe("Google transport redaction", () => {
  it("does not include token fixtures from failed Google payloads in errors", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: {
            message: "fake-refresh-token",
            access_token: "fake-access-token"
          }
        }),
        {
          status: 403,
          headers: {
            "Retry-After": "3"
          }
        }
      )
    );
    const transport = new GoogleHttpApiTransport({
      accountId: "google:account-1",
      tokenProvider: {
        accessToken: async () => "fake-access-token"
      },
      fetchImpl
    });

    await expect(transport.getJson({ path: "/tasks/v1/users/@me/lists" })).rejects.toMatchObject({
      kind: "forbidden",
      status: 403,
      retryAfterMs: 3000,
      responseBodyBytes: expect.any(Number)
    });

    try {
      await transport.getJson({ path: "/tasks/v1/users/@me/lists" });
    } catch (error) {
      expect(String(error)).not.toMatch(/fake-access-token|fake-refresh-token/);
      expect(JSON.stringify(error)).not.toMatch(/fake-access-token|fake-refresh-token/);
    }
  });

  it("redacts explicit GoogleApiError messages", () => {
    const error = new GoogleApiError({
      kind: "transport",
      message: "Transport failed with access_token=fake-access-token"
    });

    expect(error.message).toBe("Transport failed with access_token=[redacted]");
  });
});
