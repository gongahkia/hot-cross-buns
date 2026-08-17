import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LoadingState } from "@/components/LoadingState";

describe("LoadingState", () => {
  it("announces its label and tracks elapsed work", () => {
    vi.useFakeTimers();
    render(<LoadingState label="Synchronizing" variant="Orbit" />);

    expect(screen.getByRole("status")).toHaveTextContent(/Synchronizing\s*0\.0s/);
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole("status")).toHaveTextContent(/Synchronizing\s*0\.3s/);
    vi.useRealTimers();
  });

  it("uses circular cells only for the Dots variant", () => {
    const { container, rerender } = render(<LoadingState variant="Dots" />);
    expect(container.querySelectorAll(".loading-grid .round")).toHaveLength(9);

    rerender(<LoadingState variant="Drive" />);
    expect(container.querySelectorAll(".loading-grid .round")).toHaveLength(0);
  });

  it("keeps the first status visible before rotating the startup labels", () => {
    vi.useFakeTimers();
    const labels = ["Loading Hot Cross Buns…", "Reading local workspace…", "Searching cached work…"];
    render(<LoadingState rotatingLabels={labels} labelRotationMs={1_000} />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading Hot Cross Buns…");
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByRole("status")).toHaveTextContent("Reading local workspace…");
    vi.useRealTimers();
  });
});
