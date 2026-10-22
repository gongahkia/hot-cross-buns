import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CoreViewModelSource } from "./coreViewModelSource";
import { OverviewTab, SupportTab } from "./DiagnosticsTabs";

const source = {
  googleStatus: { account: null },
  syncStatus: { state: "idle", pendingMutationCount: 0 },
  settings: {
    syncMode: "balanced",
    notificationsEnabled: false,
    onboardingStatus: "completed"
  },
  taskLists: [],
  largeTaskWindow: [],
  calendarSources: [],
  calendarAgendaEvents: []
} as unknown as CoreViewModelSource;

// This is the minimal summary emitted by an existing local HCB database. It
// intentionally lacks the optional native detail arrays and redaction block.
const restoredSummary = {
  account: { state: "signed_out" },
  sync: { state: "idle" },
  cache: { taskCount: 0, eventCount: 0, noteCount: 0 },
  selectedResources: { taskLists: [], calendars: [] },
  checkpoints: { totalCount: 0 },
  pendingMutations: { totalCount: 0 },
  native: { flags: {} }
};

afterEach(cleanup);

describe("Diagnostics tabs", () => {
  it("renders restored diagnostics summaries without crashing the application", () => {
    render(<OverviewTab source={source} summary={restoredSummary} />);

    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("signed_out")).toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
  });

  it("renders the support tab when an older summary has no redaction fields", () => {
    render(<SupportTab copyDiagnosticSummary={async () => undefined} exportBundle={async () => undefined} summary={restoredSummary} />);

    expect(screen.getByText("Credentials")).toBeInTheDocument();
    expect(screen.getAllByText("redacted")).toHaveLength(2);
  });
});
