import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmojiTextarea } from "./EmojiTextField";

vi.mock("@emoji-mart/data", () => ({ default: { emojis: {
  smile: { name: "Smile", skins: [{ native: "😄" }] }, smiley: { name: "Smiley", skins: [{ native: "😃" }] }
} } }));
afterEach(cleanup);
describe("source emoji input", () => {
  it("exposes keyboard selection and lets composition Enter reach the input", async () => {
    function Harness() { const [value, setValue] = useState(""); return <EmojiTextarea aria-label="Body" value={value} onValueChange={setValue} />; }
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "Body" });
    await userEvent.type(input, ":smi");
    const list = await screen.findByRole("listbox", { name: "Emoji suggestions" });
    expect(input).toHaveAttribute("aria-controls", list.id);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const selected = screen.getByRole("option", { selected: true });
    expect(input).toHaveAttribute("aria-activedescendant", selected.id);
    fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 });
    expect(input).toHaveValue(":smi");
    expect(list).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("😃");
    expect(input).not.toHaveAttribute("aria-activedescendant");
  });
});
