import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DateTimeField, validDateTimeValue } from "./DateTimeField";

describe("date picker values", () => {
  it("rejects impossible dates and partial input without emitting normalized or shifted dates", () => {
    const change = vi.fn();
    render(<DateTimeField aria-label="Due" value="2028-02-28" onValueChange={change} />);
    const field = screen.getByRole("textbox", { name: "Due" });
    for (const value of ["2028-02-", "2027-02-29", "2028-02-30", "2028-13-01"]) {
      fireEvent.change(field, { target: { value } });
      expect(field).toHaveAttribute("aria-invalid", "true");
    }
    expect(change).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "2028-02-29" } });
    expect(change).toHaveBeenLastCalledWith("2028-02-29");
    fireEvent.change(field, { target: { value: "" } });
    expect(change).toHaveBeenLastCalledWith("");
  });

  it("preserves local wall times for the caller's timezone and rejects invalid times", () => {
    for (const value of ["2026-03-08T02:30", "2026-11-01T01:30", "2028-02-29T23:59"]) expect(validDateTimeValue(value, "datetime-local")).toBe(true);
    for (const value of ["2028-02-29T24:00", "2028-02-29T09:60", "2027-02-29T09:00", "2028-02-29T", "2028-02-29 09:00"]) expect(validDateTimeValue(value, "datetime-local")).toBe(false);
    expect(validDateTimeValue("00:00", "time")).toBe(true);
    expect(validDateTimeValue("23:59", "time")).toBe(true);
    expect(validDateTimeValue("24:01", "time")).toBe(false);
  });

  it("respects minimum and maximum dates before notifying the editor", () => {
    const change = vi.fn();
    render(<DateTimeField aria-label="Bounded date" min="2028-02-28" max="2028-03-01" value="2028-02-29" onValueChange={change} />);
    const field = screen.getByRole("textbox", { name: "Bounded date" });
    fireEvent.change(field, { target: { value: "2028-02-27" } });
    fireEvent.change(field, { target: { value: "2028-03-02" } });
    expect(change).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "2028-03-01" } });
    expect(change).toHaveBeenCalledWith("2028-03-01");
  });
});
