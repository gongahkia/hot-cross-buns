import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InspectorProvider, useInspector } from "./InspectorContext";

describe("Inspector transitions", () => {
  it("keeps an editor open when its close handler cannot save", async () => {
    const flush = vi.fn(async () => false);
    function Surface(): JSX.Element {
      const inspector = useInspector();
      return <><button onClick={() => inspector.open({ id: "note", kind: "note", title: "Note", body: "", onConfirmClose: flush })}>Note</button>
        <button onClick={() => inspector.open({ id: "task", kind: "task", title: "Task", body: "" })}>Task</button><output>{inspector.current?.title}</output></>;
    }
    render(<InspectorProvider><Surface /></InspectorProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Note" }));
    fireEvent.click(screen.getByRole("button", { name: "Task" }));
    await waitFor(() => expect(flush).toHaveBeenCalledOnce());
    expect(screen.getByRole("status")).toHaveTextContent("Note");
  });
});
