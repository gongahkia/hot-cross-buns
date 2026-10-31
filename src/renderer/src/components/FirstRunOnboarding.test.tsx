import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoreViewModelSource } from "../features/core/coreViewModelSource";
import { FirstRunOnboarding } from "./FirstRunOnboarding";

afterEach(cleanup);

function setupSource(): CoreViewModelSource {
  return {
    settings: { selectedTaskListIds: [], selectedCalendarIds: [], syncMode: "balanced", notificationsEnabled: true },
    taskLists: [{ id: "work", title: "Work", accountId: "google" }, { id: "home", title: "Home", accountId: "google" }],
    calendarSources: [{ id: "calendar", title: "Personal", accountId: "google", selected: true }],
    googleStatus: { accounts: [{ accountId: "google", connectionState: "connected", email: "test@example.com" }], oauthClientConfigured: true },
    native: { capabilityReport: { flags: { supportsOAuthLoopback: true } } },
    refresh: vi.fn(),
    updateSettings: vi.fn().mockResolvedValue(true)
  } as unknown as CoreViewModelSource;
}

describe("FirstRunOnboarding", () => {
  it("requires Google even when local resources exist and the client is unconfigured", async () => {
    const user = userEvent.setup();
    const source = setupSource();
    source.googleStatus = { accounts: [], oauthClientConfigured: false, clientId: null, hasClientSecret: false };
    source.native.capabilityReport.platform = "web";
    const { rerender } = render(<FirstRunOnboarding source={source} />);
    await user.click(screen.getByRole("button", { name: "Get started" }));
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Connect Google" })).toBeDisabled();
    await waitFor(() => expect(screen.getByText(/Google sign-in is not configured/)).toBeVisible());
    source.googleStatus = { ...setupSource().googleStatus };
    rerender(<FirstRunOnboarding source={source} />);
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
    for (let step = 0; step < 3; step++) await user.click(screen.getByRole("button", { name: "Continue" }));
    // An expired/disconnected session must not complete setup from a later step.
    source.googleStatus = { ...source.googleStatus, accounts: [] };
    rerender(<FirstRunOnboarding source={source} />);
    expect(screen.getByRole("button", { name: "Finish setup" })).toBeDisabled();
    expect(source.updateSettings).not.toHaveBeenCalled();
  });

  it("moves Google configuration through pages without dropdowns and preserves the client ID", async () => {
    const user = userEvent.setup();
    const source = setupSource();
    source.googleStatus = { accounts: [], oauthClientConfigured: false, clientId: null, hasClientSecret: false };
    source.native.capabilityReport.platform = "web";
    const { rerender } = render(<FirstRunOnboarding source={source} />);
    await user.click(screen.getByRole("button", { name: "Get started" }));
    await user.click(screen.getByRole("button", { name: "Set up Google sign-in" }));
    expect(screen.getByRole("heading", { name: "Set up Google sign-in" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    const field = screen.getByRole("textbox", { name: "Google OAuth client ID" });
    await user.type(field, "example.apps.googleusercontent.com");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(field.closest("[role=dialog]")?.querySelector("details")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("textbox", { name: "Google OAuth client ID" })).toHaveValue("example.apps.googleusercontent.com");
    source.googleStatus = { ...source.googleStatus, oauthClientConfigured: true, clientId: "example.apps.googleusercontent.com" };
    rerender(<FirstRunOnboarding source={source} />);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("button", { name: "Connect Google" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("keeps setup open when durable settings persistence fails", async () => {
    const user = userEvent.setup();
    const source = setupSource();
    source.updateSettings = vi.fn().mockResolvedValue(false);
    render(<FirstRunOnboarding source={source} />);
    await user.click(screen.getByRole("button", { name: "Get started" }));
    for (let step = 0; step < 3; step++) await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Finish setup" }));
    expect(await screen.findByText("Setup preferences were not saved.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Finish setup" })).toBeEnabled();
  });

  it("requires both resource selections on the combined step and saves the five-step setup", async () => {
    const user = userEvent.setup();
    const source = setupSource();
    render(<FirstRunOnboarding source={source} />);
    expect(screen.queryByText(/Step [1-5] of 5/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Get started" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.queryByText(/Step [1-5] of 5/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Task lists" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Calendars" })).toBeInTheDocument();
    const next = screen.getByRole("button", { name: "Continue" });
    await user.click(screen.getByRole("checkbox", { name: "Select calendar Personal" }));
    expect(next).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "Select calendar Personal" }));
    await user.click(screen.getByRole("checkbox", { name: "Select task list Home" }));
    await user.click(screen.getByRole("checkbox", { name: "Select task list Work" }));
    expect(next).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "Select task list Work" }));
    await user.click(next);
    expect(screen.queryByText(/Step [1-5] of 5/)).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Balanced" })).toBeChecked();
    for (const label of ["Manual", "Balanced", "Near real time"]) {
      expect(screen.getByRole("radio", { name: label })).toHaveAccessibleDescription(/For example/);
    }
    await user.click(screen.getByRole("radio", { name: "Near real time" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("checkbox", { name: "Select task list Home" })).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("radio", { name: "Near real time" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.queryByText(/Step [1-5] of 5/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Finish setup" }));
    expect(source.updateSettings).toHaveBeenCalledWith(expect.objectContaining({
      onboardingStatus: "completed", selectedTaskListIds: ["work"], selectedCalendarIds: ["calendar"], syncMode: "near-real-time"
    }));
  });
});
