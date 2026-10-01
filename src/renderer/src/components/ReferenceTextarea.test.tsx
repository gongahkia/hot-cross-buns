import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ok } from "@shared/ipc/result";
import { ReferenceTextarea } from "./ReferenceTextarea";

describe("ReferenceTextarea", () => {
  afterEach(() => {
    cleanup();
  });

  it("opens from @ and inserts an ID-stable HCB reference", async () => {
    Object.defineProperty(window, "hcb", {
      configurable: true,
      value: {
        settings: { get: vi.fn(async () => ok({ referenceRecents: [] })), update: vi.fn(async () => ok({})) },
        google: { status: vi.fn(async () => ok({ accounts: [], oauthClientConfigured: true })), searchDriveFiles: vi.fn(async () => ok({ items: [] })) },
        search: { query: vi.fn(async () => ok({ items: [{ domain: "tasks", id: "task-1", title: "Plan launch" }] })) }
      }
    });
    function Harness(): JSX.Element {
      const [value, setValue] = useState("");
      return <><ReferenceTextarea aria-label="Task notes" onValueChange={setValue} value={value} /><output>{value}</output></>;
    }
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByRole("textbox", { name: "Task notes" }), "@plan");
    const option = await screen.findByRole("option", { name: /Plan launch/i });
    await user.click(option);

    expect(screen.getByRole("textbox", { name: "Task notes" })).toHaveValue("[[hcb:task:task-1|Plan launch]]");
  });

  it("hides every Drive control and does not query Drive when the account did not grant Drive scopes", async () => {
    const searchDriveFiles = vi.fn(async () => ok({ items: [] }));
    Object.defineProperty(window, "hcb", {
      configurable: true,
      value: {
        settings: { get: vi.fn(async () => ok({ referenceRecents: [] })), update: vi.fn(async () => ok({})) },
        google: { status: vi.fn(async () => ok({ accounts: [{ accountId: "google-account", connectionState: "connected", email: "person@example.test", displayName: "Person", missingScopes: [], grantedScopes: [] }], oauthClientConfigured: true })), searchDriveFiles, pickAndUploadDriveFile: vi.fn() },
        search: { query: vi.fn(async () => ok({ items: [] })) }
      }
    });
    function Harness(): JSX.Element {
      const [value, setValue] = useState("");
      return <ReferenceTextarea accountId="google-account" aria-label="Task notes" onValueChange={setValue} value={value} />;
    }
    const user = userEvent.setup();
    render(<Harness />);

    await screen.findByRole("button", { name: "HCB item" });
    expect(screen.queryByRole("button", { name: "Drive" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upload file" })).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Task notes" }), "@");
    await screen.findByRole("dialog", { name: "Insert reference" });
    expect(screen.queryByRole("button", { name: "Upload from Mac" })).not.toBeInTheDocument();
    expect(searchDriveFiles).not.toHaveBeenCalled();
  });

  it("keeps Drive search separate from file uploads", async () => {
    Object.defineProperty(window, "hcb", {
      configurable: true,
      value: {
        settings: { get: vi.fn(async () => ok({ referenceRecents: [] })), update: vi.fn(async () => ok({})) },
        google: {
          status: vi.fn(async () => ok({ accounts: [{ accountId: "google-account", connectionState: "connected", email: "person@example.test", displayName: "Person", missingScopes: [], grantedScopes: ["https://www.googleapis.com/auth/drive.metadata.readonly"] }], oauthClientConfigured: true })),
          searchDriveFiles: vi.fn(async () => ok({ items: [] })),
          pickAndUploadDriveFile: vi.fn()
        },
        search: { query: vi.fn(async () => ok({ items: [] })) }
      }
    });
    function Harness(): JSX.Element {
      const [value, setValue] = useState("");
      return <ReferenceTextarea accountId="google-account" aria-label="Task notes" onValueChange={setValue} value={value} />;
    }
    render(<Harness />);

    await screen.findByRole("button", { name: "Drive" });
    expect(screen.queryByRole("button", { name: "Upload file" })).not.toBeInTheDocument();
  });
});
