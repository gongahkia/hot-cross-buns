import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GoogleStatusResponse, SettingsSnapshot } from "@shared/ipc/contracts";
import { ProfileSettingsTab } from "./ProfileSettingsTab";

afterEach(() => {
  cleanup();
});

const googleStatus: GoogleStatusResponse = {
  account: {
    accountId: "google-account",
    connectionState: "connected",
    displayName: "Planner",
    email: "planner@example.test",
    grantedScopes: ["https://www.googleapis.com/auth/drive.metadata.readonly"],
    missingScopes: [],
    unresolvedMutationCount: 0
  },
  accounts: [{
    accountId: "google-account",
    connectionState: "connected",
    displayName: "Planner",
    email: "planner@example.test",
    grantedScopes: ["https://www.googleapis.com/auth/drive.metadata.readonly"],
    missingScopes: [],
    unresolvedMutationCount: 0
  }],
  clientId: "test-desktop-client-id",
  hasClientSecret: false,
  oauthClientConfigured: true
};

function renderProfile(overrides: Partial<GoogleStatusResponse> = {}, browserRuntime = false) {
  const reconfigureOptionalAccess = vi.fn(async () => ({ ok: true, message: "Google access was reset." }));
  render(
    <ProfileSettingsTab
      browserRuntime={browserRuntime}
      beginGoogleOAuth={vi.fn(async () => undefined)}
      calendarSources={[]}
      disconnectGoogle={vi.fn(async () => undefined)}
      googleClientId="test-desktop-client-id"
      googleClientSecret=""
      googleStatus={{ ...googleStatus, ...overrides }}
      reconfigureOptionalAccess={reconfigureOptionalAccess}
      refreshPlanner={vi.fn()}
      saveGoogleOAuthClient={vi.fn(async () => undefined)}
      setGoogleClientId={vi.fn()}
      setGoogleClientSecret={vi.fn()}
      settings={{ selectedCalendarIds: [], selectedTaskListIds: [] } as unknown as SettingsSnapshot}
      settingsMutationPending={false}
      taskLists={[]}
      updateSelectedCalendar={vi.fn()}
      updateSelectedTaskList={vi.fn()}
    />
  );
  return { reconfigureOptionalAccess };
}

describe("ProfileSettingsTab optional Google access", () => {
  it("lets a user select exact scopes before the single reconfigure-and-reconnect action", async () => {
    const { reconfigureOptionalAccess } = renderProfile();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Reconfigure Google access" }));
    expect(screen.getByRole("dialog", { name: "Reconfigure Google access" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Drive links" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Local-file uploads" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Reconnect with selected access" })).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: "Acknowledge Google reconnection" }));
    await user.click(screen.getByRole("button", { name: "Reconnect with selected access" }));

    expect(reconfigureOptionalAccess).toHaveBeenCalledWith({
      accountId: "google-account",
      requestedServices: ["drive"]
    });
  });

  it("shows the sync preflight and prevents a reset while an account has unresolved changes", async () => {
    const { reconfigureOptionalAccess } = renderProfile({
      account: { ...googleStatus.account!, unresolvedMutationCount: 2 },
      accounts: [{ ...googleStatus.accounts[0]!, unresolvedMutationCount: 2 }]
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Reconfigure Google access" }));
    expect(screen.getByText("Sync 2 pending Google changes before reconfiguring this account.")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Acknowledge Google reconnection" }));
    expect(screen.getByRole("button", { name: "Reconnect with selected access" })).toBeDisabled();
    expect(reconfigureOptionalAccess).not.toHaveBeenCalled();
  });
});

 describe("browser Google profile", () => {
  it("labels ungranted planner services instead of claiming full connection", () => {
    renderProfile({}, true);
    expect(screen.getByText("Tasks access not granted")).toBeVisible();
    expect(screen.getByText("Calendar access not granted")).toBeVisible();
    expect(screen.queryByAltText("Google Calendar")).not.toBeInTheDocument();
    expect(screen.queryByAltText("Google Tasks")).not.toBeInTheDocument();
  });
  it("shows Web OAuth configuration without client secret inputs or a fake configured state", () => {
    renderProfile({ oauthClientConfigured: false, accounts: [], account: null }, true);
    expect(screen.queryByRole("textbox", { name: "Google OAuth client ID" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Google OAuth client secret")).not.toBeInTheDocument();
    expect(screen.getByText(/VITE_GOOGLE_CLIENT_ID/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Add Google Account" })).toBeDisabled();
  });
});
