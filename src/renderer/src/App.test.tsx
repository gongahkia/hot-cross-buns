import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App shell", () => {
  it("renders the planner frame and primary sections", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByTestId("app-shell")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();

    for (const label of ["Today", "Tasks", "Calendar", "Notes", "Search", "Settings"]) {
      expect(screen.getByRole("button", { name: new RegExp(label) })).toBeInTheDocument();
    }

    await user.click(screen.getByRole("button", { name: /Tasks/ }));

    expect(screen.getByRole("heading", { name: "Tasks" })).toBeInTheDocument();
  });

  it("saves a task through the narrow local planner API", async () => {
    const user = userEvent.setup();
    const view = render(<App />);
    const app = within(view.container);

    await user.click(app.getByRole("button", { name: /Tasks/ }));
    await user.type(app.getByRole("textbox", { name: "New task title" }), "Revive HCB2");
    await user.click(app.getByRole("button", { name: "Add task" }));

    await waitFor(() => {
      expect(window.hcb?.planner.saveTask).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Revive HCB2", notes: "", dueDate: null })
      );
    });
  });

  it("persists appearance and startup preferences from Settings", async () => {
    const user = userEvent.setup();
    const view = render(<App />);
    const app = within(view.container);

    await user.click(app.getByRole("button", { name: /^Settings/ }));

    await waitFor(() => {
      expect(app.getByText("/tmp/hcb/settings-v1.json")).toBeInTheDocument();
    });
    expect(app.getByRole("heading", { name: "Appearance" })).toBeInTheDocument();
    await user.click(app.getByRole("radio", { name: /Light/ }));
    await user.selectOptions(app.getByLabelText("Open on startup"), "tasks");
    await user.click(app.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(window.hcb?.settings.save).toHaveBeenCalledWith({
        colorScheme: "light",
        startPage: "tasks"
      });
    });
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(app.getByRole("status")).toHaveTextContent("Saved to settings-v1.json.");
  });
});
