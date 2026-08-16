import { describe, expect, it, vi } from "vitest";

import { GoogleApiClient, GoogleAuthorizationRequiredError } from "@/api/googleApiClient";

describe("GoogleApiClient", () => {
  it("requires a current in-memory token", async () => {
    const client = new GoogleApiClient(() => undefined);
    await expect(client.listTaskLists()).rejects.toBeInstanceOf(GoogleAuthorizationRequiredError);
  });

  it("paginates direct Google Tasks requests and sends the bearer token", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "list-1", title: "Inbox" }], nextPageToken: "next" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "list-2", title: "Later" }] })));
    vi.stubGlobal("fetch", fetchMock);
    const client = new GoogleApiClient(() => "memory-only-token");

    await expect(client.listTaskLists()).resolves.toEqual([
      { id: "list-1", title: "Inbox", updated: undefined },
      { id: "list-2", title: "Later", updated: undefined }
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("pageToken=next");
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer memory-only-token");
    vi.unstubAllGlobals();
  });
});
