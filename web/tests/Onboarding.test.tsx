import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Onboarding } from "@/components/Onboarding";

describe("Onboarding", () => {
  it("collects a client ID but never asks for a client secret", async () => {
    const user = userEvent.setup();
    const saveClientId = vi.fn().mockResolvedValue(undefined);
    const saveDisplayTimeZone = vi.fn().mockResolvedValue(undefined);
    const connect = vi.fn().mockResolvedValue(undefined);
    const useDirectConnection = vi.fn().mockResolvedValue(undefined);
    render(<Onboarding savedClientId="" displayTimeZone="Asia/Singapore" connectionProfile={{ mode: "direct" }} managedConnectionAvailable={false} busy={false} status="Ready" saveClientId={saveClientId} saveDisplayTimeZone={saveDisplayTimeZone} connect={connect} connectManaged={vi.fn()} useDirectConnection={useDirectConnection} />);

    expect(screen.getByText(/Do not paste a client secret/i)).toBeVisible();
    expect(screen.queryByLabelText(/client secret/i)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/Google Web OAuth client ID/i), "1234567890-example.apps.googleusercontent.com");
    await user.click(screen.getByRole("button", { name: /save and connect Google/i }));

    expect(saveClientId).toHaveBeenCalledWith("1234567890-example.apps.googleusercontent.com");
    expect(saveDisplayTimeZone).toHaveBeenCalledWith("Asia/Singapore");
    expect(useDirectConnection).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledOnce();
  });

  it("offers the self-hosted reliable connection only when this PWA build configures one", async () => {
    const user = userEvent.setup();
    const connectManaged = vi.fn().mockResolvedValue(undefined);
    render(<Onboarding savedClientId="" displayTimeZone="Asia/Singapore" connectionProfile={{ mode: "direct" }} managedConnectionAvailable busy={false} status="Ready" saveClientId={vi.fn()} saveDisplayTimeZone={vi.fn().mockResolvedValue(undefined)} connect={vi.fn()} connectManaged={connectManaged} useDirectConnection={vi.fn()} />);

    await user.click(screen.getByRole("radio", { name: /self-hosted reliable connection/i }));
    await user.click(screen.getByRole("button", { name: /connect through self-hosted service/i }));

    expect(connectManaged).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText(/Google Web OAuth client ID/i)).not.toBeInTheDocument();
  });
});
