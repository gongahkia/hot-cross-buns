import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskViewModel } from "../../coreViewModels";

const { source } = vi.hoisted(() => ({ source: {
  settings: { defaultTimeZone: "UTC" },
  scheduledTaskBlocks: [] as any[],
  calendarSources: [{ id: "calendar", title: "Work", selected: true }],
  scheduleTaskBlock: vi.fn(async () => true),
  moveScheduledTaskBlock: vi.fn(async () => true)
} }));
vi.mock("../../coreViewModelSource", () => ({ useCoreViewModelSource: () => source }));
import { TaskScheduleDialog } from "./TaskScheduleDialog";

afterEach(() => { cleanup(); vi.clearAllMocks(); source.scheduledTaskBlocks = []; });
const task = { id: "task", title: "Write the proposal", durationMinutes: 30 } as TaskViewModel;

describe("Task scheduling review", () => {
  it("does not change Calendar when the dialog opens or is cancelled", () => {
    const close = vi.fn();
    render(<TaskScheduleDialog task={task} onClose={close} />);
    expect(screen.getByRole("dialog")).toHaveTextContent("due date stays separate");
    expect(source.scheduleTaskBlock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }));
    expect(close).toHaveBeenCalledOnce();
    expect(source.scheduleTaskBlock).not.toHaveBeenCalled();
  });

  it("saves the explicitly selected time and duration", async () => {
    const close = vi.fn();
    render(<TaskScheduleDialog task={task} onClose={close} />);
    fireEvent.change(screen.getByLabelText("Schedule start"), { target: { value: "2026-11-04T09:30" } });
    fireEvent.change(screen.getByLabelText("Schedule duration"), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Calendar block" }));
    await waitFor(() => expect(source.scheduleTaskBlock).toHaveBeenCalledWith({ taskId: "task", calendarId: "calendar", startsAt: "2026-11-04T09:30:00.000Z", durationMinutes: 45 }));
    expect(close).toHaveBeenCalledOnce();
  });

  it("moves an existing block instead of creating another", async () => {
    source.scheduledTaskBlocks = [{ id: "block", taskId: "task", calendarId: "calendar", startsAt: "2026-11-04T10:00:00.000Z", endsAt: "2026-11-04T11:00:00.000Z" }];
    render(<TaskScheduleDialog task={task} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Move Calendar block" }));
    await waitFor(() => expect(source.moveScheduledTaskBlock).toHaveBeenCalledWith({ id: "block", calendarId: "calendar", startsAt: "2026-11-04T10:00:00.000Z", durationMinutes: 60 }));
    expect(source.scheduleTaskBlock).not.toHaveBeenCalled();
  });
});
