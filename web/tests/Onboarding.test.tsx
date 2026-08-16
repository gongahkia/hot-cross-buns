import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Onboarding } from "@/components/Onboarding";

describe("Onboarding", () => {
  it("collects a client ID but never asks for a client secret", async () => {
    const user = userEvent.setup();
    const saveClientId = vi.fn().mockResolvedValue(undefined);
    const connect = vi.fn().mockResolvedValue(undefined);
    render(<Onboarding savedClientId="" busy={false} status="Ready" saveClientId={saveClientId} connect={connect} />);

    expect(screen.getByText(/Do not paste a client secret/i)).toBeVisible();
    expect(screen.queryByLabelText(/client secret/i)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/Google Web OAuth client ID/i), "1234567890-example.apps.googleusercontent.com");
    await user.click(screen.getByRole("button", { name: /save and connect Google/i }));

    expect(saveClientId).toHaveBeenCalledWith("1234567890-example.apps.googleusercontent.com");
    expect(connect).toHaveBeenCalledOnce();
  });
});
