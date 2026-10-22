import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MeasuredVirtualList } from "./MeasuredVirtualList";

describe("MeasuredVirtualList", () => {
  it("keeps a ten-thousand-item list bounded and reaches the last item by scrolling", () => {
    const items = Array.from({ length: 10_000 }, (_, index) => index);
    render(<MeasuredVirtualList ariaLabel="Tasks" items={items} getKey={(item) => item} estimateRowHeight={80} renderRow={(item) => <div data-testid="task-row">Task {item}</div>} />);
    expect(screen.getAllByTestId("task-row").length).toBeLessThan(30);
    const viewport = screen.getByRole("list", { name: "Tasks" });
    Object.defineProperty(viewport, "clientHeight", { value: 600 });
    fireEvent.scroll(viewport, { target: { scrollTop: 799_400 } });
    expect(screen.getByText("Task 9999")).toBeVisible();
    expect(screen.getAllByTestId("task-row").length).toBeLessThan(30);
  });

  it("moves keyboard focus to distant rows without mounting the whole list", () => {
    render(<MeasuredVirtualList ariaLabel="Keyboard tasks" items={Array.from({ length: 1000 }, (_, index) => index)} getKey={(item) => item} renderRow={(item) => <button>Task {item}</button>} />);
    const viewport = screen.getByRole("list", { name: "Keyboard tasks" });
    Object.defineProperty(viewport, "clientHeight", { value: 600 });
    fireEvent.keyDown(viewport, { key: "End" });
    expect(screen.getByRole("button", { name: "Task 999" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(screen.getByRole("button", { name: "Task 0" })).toHaveFocus();
    expect(screen.getAllByRole("button").length).toBeLessThan(30);
  });
});
