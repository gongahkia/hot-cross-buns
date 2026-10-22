import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InspectorProvider, useInspector } from "./InspectorContext";
import { InspectorShell } from "./InspectorShell";

afterEach(cleanup);

describe("Inspector transitions", () => {
  it("closes after saving even when the inspector chrome updates during the save", async () => {
    let finish: (value: boolean) => void = () => undefined;
    function Surface(): JSX.Element {
      const inspector = useInspector();
      return <><button onClick={() => inspector.open({ id: "note", kind: "note", title: "Note", body: "", onConfirmClose: () => new Promise<boolean>((resolve) => { finish = resolve; }) })}>Open</button>
        <button onClick={() => void inspector.close()}>Close</button><button onClick={() => inspector.update({ title: "Saved note" })}>Refresh title</button><InspectorShell /></>;
    }
    render(<InspectorProvider><Surface /></InspectorProvider>);
    fireEvent.click(screen.getByRole("button", { name: /^Open$/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Close$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh title" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveAccessibleName("Saved note"));
    finish(true);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("preserves editor autofocus and handles Escape from outside the dialog", async () => {
    function Surface(): JSX.Element {
      const inspector = useInspector();
      return <><button onClick={() => inspector.open({ id: "new", kind: "task", title: "New task", body: <input aria-label="Capture title" autoFocus /> })}>Capture</button><InspectorShell /></>;
    }
    render(<InspectorProvider><Surface /></InspectorProvider>);
    const trigger = screen.getByRole("button", { name: "Capture" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("textbox", { name: "Capture title" })).toHaveFocus();
    trigger.focus();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it("lets a nested modal own Escape", () => {
    function Surface(): JSX.Element {
      const inspector = useInspector();
      return <><button onClick={() => inspector.open({ id: "outer", kind: "note", title: "Outer", body: <div role="dialog" aria-modal="true" aria-label="Nested"><input aria-label="Nested field" autoFocus /></div> })}>Open nested</button><InspectorShell /></>;
    }
    render(<InspectorProvider><Surface /></InspectorProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Open nested" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Nested field" }), { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Outer" })).toBeVisible();
  });

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
