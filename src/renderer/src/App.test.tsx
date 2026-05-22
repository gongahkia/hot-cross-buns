import { render, screen } from "@testing-library/react";
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
});
