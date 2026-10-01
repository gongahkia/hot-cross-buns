import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ok } from "@shared/ipc/result";
import { ReferenceTextarea } from "./ReferenceTextarea";

describe("ReferenceTextarea", () => {
  it("opens from @ and inserts an ID-stable HCB reference", async () => {
    Object.defineProperty(window, "hcb", {
      configurable: true,
      value: {
        settings: { get: vi.fn(async () => ok({ referenceRecents: [] })), update: vi.fn(async () => ok({})) },
        google: { searchDriveFiles: vi.fn(async () => ok({ items: [] })) },
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
});
