import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CoreViewModelSource } from "../features/core/coreViewModelSource";
import { FirstRunOnboarding } from "./FirstRunOnboarding";

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
  it("requires both resource selections on the combined step and saves the five-step setup", async () => {
    const user = userEvent.setup();
    const source = setupSource();
    render(<FirstRunOnboarding source={source} />);
    expect(screen.getByText("Step 1 of 5")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Get started" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Step 3 of 5")).toBeInTheDocument();
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
    expect(screen.getByText("Step 4 of 5")).toBeInTheDocument();
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
    expect(screen.getByText("Step 5 of 5")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Finish setup" }));
    expect(source.updateSettings).toHaveBeenCalledWith(expect.objectContaining({
      onboardingStatus: "completed", selectedTaskListIds: ["work"], selectedCalendarIds: ["calendar"], syncMode: "near-real-time"
    }));
  });
});
