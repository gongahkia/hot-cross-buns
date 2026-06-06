import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AutoTagRule } from "@shared/ipc/contracts";
import { ok } from "@shared/ipc/result";
import App from "./App";
import {
  connectedGoogleStatus,
  goToSection,
  installHcb,
  now,
  onboardingHcb,
  seededHcb,
  signedOutGoogleStatus,
  testSettings
} from "./test/appTestHelpers";

function autoTagRule(patch: Partial<AutoTagRule> = {}): AutoTagRule {
  return {
    id: "rule-coding",
    name: "Coding",
    enabled: true,
    targetKinds: ["task", "event", "note"],
    matchField: "title",
    matchType: "prefix",
    pattern: "CODING",
    tags: ["coding"],
    stripMatchedPrefix: true,
    eventColorId: null,
    overrideExistingEventColor: false,
    createdAt: now,
    updatedAt: now,
    ...patch
  };
}

describe("App settings and onboarding", () => {
  it("renders required settings sections and section controls", async () => {
    installHcb(seededHcb());
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Settings");

    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    expect(within(dialog).getByRole("button", { name: "General" })).toHaveAttribute("aria-pressed", "true");
    expect(within(dialog).getByRole("button", { name: "Profile" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Appearance" })).toBeInTheDocument();

    expect(screen.getByRole("combobox", { name: "App language" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Open Hot Cross Buns at login" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Sync mode" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Local MCP server" })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Profile" }));
    expect(screen.getByRole("textbox", { name: "Google OAuth client ID" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add Google Account/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Task lists" })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Appearance" }));
    expect(screen.getByRole("combobox", { name: "Theme" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Color theme" })).toBeInTheDocument();
    expect(screen.queryByText("Performance")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Translucent background" })).not.toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "App surface opacity" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Layout" })).toBeInTheDocument();
  });

  it("filters settings results and switches to the matching tab", async () => {
    installHcb(seededHcb());
    render(<App />);

    await goToSection("Settings");

    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    const search = within(dialog).getByRole("textbox", { name: "Search settings" });

    fireEvent.change(search, { target: { value: "menubar" } });

    await waitFor(() => {
      expect(within(dialog).getByRole("button", { name: "Alerts" })).toHaveAttribute("aria-pressed", "true");
    });
    expect(within(dialog).getByRole("heading", { level: 2, name: "Menu bar" })).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: "Menu bar extra" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("heading", { level: 2, name: "Notifications" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("heading", { level: 2, name: "Language" })).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "performance" } });

    await waitFor(() => {
      expect(within(dialog).getByRole("button", { name: "General" })).toHaveAttribute("aria-pressed", "true");
    });
    expect(within(dialog).getByRole("heading", { level: 2, name: "Diagnostics" })).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: "Include performance diagnostics" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox", { name: "Include field-redacted Google payloads in local logs" })).not.toBeInTheDocument();
  });

  it("applies base theme and color theme settings", async () => {
    const api = seededHcb();
    let settings = testSettings({
      theme: "dark",
      colorTheme: "dracula",
      uiFontName: "Inter",
      uiTextSizePoints: 15
    });
    api.settings.get = vi.fn(async () => ok(settings));
    api.settings.update = vi.fn(async (request) => {
      settings = testSettings({
        ...settings,
        ...request
      });

      return ok(settings);
    });
    api.native.listFontFamilies = vi.fn(async () =>
      ok({
        platform: "darwin" as const,
        families: ["Avenir", "JetBrains Mono", "SF Pro Text"]
      })
    );
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute("data-theme", "dark");
      expect(document.documentElement).toHaveAttribute("data-color-theme", "dracula");
      expect(document.documentElement.style.getPropertyValue("--color-accent")).toBe("#FF79C6");
      expect(document.documentElement.style.getPropertyValue("--font-family")).toContain("\"Inter\"");
      expect(document.documentElement.style.getPropertyValue("--font-family-mono")).toContain("\"Inter\"");
      expect(document.documentElement.style.getPropertyValue("--text-base")).toBe("15px");
    });

    await goToSection("Settings");
    await user.click(screen.getByRole("button", { name: "Appearance" }));
    expect(screen.getByLabelText("Lavender background")).toHaveValue("#bd93f9");
    await user.selectOptions(screen.getByLabelText("Theme"), "light");

    await waitFor(() => {
      expect(api.settings.update).toHaveBeenCalledWith({
        theme: "light",
        colorTheme: "notion"
      });
      expect(document.documentElement).toHaveAttribute("data-theme", "light");
      expect(document.documentElement).toHaveAttribute("data-color-theme", "notion");
      expect(screen.getByLabelText("Lavender background")).toHaveValue("#9b8afb");
    });

    await user.selectOptions(screen.getByLabelText("Color theme"), "githubLight");

    await waitFor(() => {
      expect(api.settings.update).toHaveBeenCalledWith({ colorTheme: "githubLight" });
      expect(document.documentElement).toHaveAttribute("data-color-theme", "githubLight");
    });
    expect(screen.queryByText("Light themes")).not.toBeInTheDocument();
    await waitFor(() => expect(api.native.listFontFamilies).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.getAllByRole("option", { name: "Avenir" }).length).toBeGreaterThan(0);
    });

    await user.selectOptions(screen.getByRole("combobox", { name: "Font family" }), "JetBrains Mono");

    await waitFor(() => {
      expect(api.settings.update).toHaveBeenCalledWith({ uiFontName: "JetBrains Mono" });
      expect(document.documentElement.style.getPropertyValue("--font-family")).toContain("\"JetBrains Mono\"");
      expect(document.documentElement.style.getPropertyValue("--font-family-mono")).toContain("\"JetBrains Mono\"");
    });

    fireEvent.change(screen.getByLabelText("Text size points"), { target: { value: "16" } });

    await waitFor(() => {
      expect(api.settings.update).toHaveBeenCalledWith({ uiTextSizePoints: 16 });
      expect(document.documentElement.style.getPropertyValue("--text-base")).toBe("16px");
    });
  });

  it("opens the diagnostics workspace from settings", async () => {
    const api = seededHcb();
    const base = await api.diagnostics.summary();
    if (!base.ok) {
      throw new Error("Missing diagnostics fixture");
    }
    api.diagnostics.summary = vi.fn(async () =>
      ok({
        ...base.data,
        dangerousToken: "raw-google-token"
      } as typeof base.data & { dangerousToken: string })
    );
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Settings");
    await user.click(screen.getByRole("button", { name: /View diagnostics/ }));

    const dialog = await screen.findByRole("dialog", { name: "Diagnostics" });
    expect(dialog).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent("raw-google-token");
    expect(within(dialog).getByRole("button", { name: "Overview" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Support" })).toBeInTheDocument();
  });

  it("updates general settings controls through settings IPC", async () => {
    const api = seededHcb();
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Settings");
    await user.selectOptions(screen.getByRole("combobox", { name: "Sync mode" }), "manual");
    await user.click(screen.getByRole("checkbox", { name: "Local MCP server" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "MCP permission mode" }), "allow-writes");

    await waitFor(() => {
      expect(api.settings.update).toHaveBeenCalledWith({ syncMode: "manual" });
      expect(api.settings.update).toHaveBeenCalledWith({ mcpEnabled: true });
      expect(api.settings.update).toHaveBeenCalledWith({ mcpPermissionMode: "allow-writes" });
    });
  });

  it("shows auto-tag regex validation, preview output, and rule conflicts", async () => {
    const api = seededHcb();
    let settings = testSettings({
      autoTagRules: [
        autoTagRule(),
        autoTagRule({
          id: "rule-github",
          name: "Github",
          matchType: "contains",
          pattern: "github",
          tags: ["github"],
          stripMatchedPrefix: false
        }),
        autoTagRule({
          id: "rule-invalid",
          name: "Invalid",
          matchType: "regex",
          pattern: "[",
          tags: ["bad"],
          stripMatchedPrefix: false
        })
      ]
    });
    api.settings.get = vi.fn(async () => ok(settings));
    api.settings.update = vi.fn(async (request) => {
      settings = testSettings({ ...settings, ...request });
      return ok(settings);
    });
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Settings");
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    await user.click(within(dialog).getByRole("button", { name: "Advanced" }));

    expect(await within(dialog).findByText("1 auto-tag rule error need review.")).toBeInTheDocument();
    expect(within(dialog).getByText(/Invalid regex:/)).toBeInTheDocument();

    fireEvent.change(within(dialog).getByRole("textbox", { name: "Auto tag preview title" }), {
      target: { value: "CODING: Look into github alternatives" }
    });

    expect(within(dialog).getByText("2 matched")).toBeInTheDocument();
    expect(within(dialog).getByText("multiple rules")).toBeInTheDocument();
    expect(within(dialog).getByText("Title: Look into github alternatives")).toBeInTheDocument();
    expect(within(dialog).getByText("Tags: coding, github")).toBeInTheDocument();
    expect(within(dialog).getByText("preview invalid")).toBeInTheDocument();
  });

  it("shows onboarding for a fresh database and completes setup through settings IPC", async () => {
    const { api, getSettings } = onboardingHcb();
    api.google.status = vi.fn(async () => ok(connectedGoogleStatus()));
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    const dialog = await screen.findByRole("dialog", { name: "First-run setup" });

    expect(within(dialog).getByText("1. Google account")).toBeInTheDocument();
    expect(within(dialog).getByText("Connected as Planner Test.")).toBeInTheDocument();
    expect(within(dialog).getByText("2. Task lists")).toBeInTheDocument();
    expect(within(dialog).getByText("3. Calendars")).toBeInTheDocument();
    expect(within(dialog).getByText("4. Sync mode")).toBeInTheDocument();
    expect(within(dialog).getByText("5. Notifications")).toBeInTheDocument();
    expect(within(dialog).getByText("6. MCP access")).toBeInTheDocument();

    await user.selectOptions(within(dialog).getByLabelText("Onboarding sync mode"), "near-real-time");
    await user.click(within(dialog).getByLabelText("Local notifications"));
    await user.click(within(dialog).getByLabelText("Enable MCP"));
    await user.click(within(dialog).getByRole("button", { name: "Finish setup" }));

    await waitFor(() => {
      expect(api.settings.update).toHaveBeenCalledWith(
        expect.objectContaining({
          selectedTaskListIds: ["list-inbox", "list-planning"],
          selectedCalendarIds: ["cal-product"],
          syncMode: "near-real-time",
          notificationsEnabled: true,
          mcpEnabled: true,
          setupCompletedAt: expect.any(String)
        })
      );
      expect(getSettings().setupCompletedAt).toEqual(expect.any(String));
      expect(screen.queryByRole("dialog", { name: "First-run setup" })).not.toBeInTheDocument();
    });
  });

  it("starts Google OAuth from first-run setup", async () => {
    const { api } = onboardingHcb();
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    const dialog = await screen.findByRole("dialog", { name: "First-run setup" });
    const connectButton = await within(dialog).findByRole("button", { name: "Connect Google" });
    expect(connectButton).toBeDisabled();

    await user.type(
      within(dialog).getByRole("textbox", { name: "Google OAuth client ID" }),
      "desktop-client-id.apps.googleusercontent.com"
    );
    await user.click(within(dialog).getByRole("button", { name: "Save OAuth Client" }));
    await waitFor(() => expect(connectButton).toBeEnabled());

    await user.click(connectButton);

    await waitFor(() => {
      expect(api.google.saveOAuthClient).toHaveBeenCalledWith({
        clientId: "desktop-client-id.apps.googleusercontent.com"
      });
      expect(api.google.beginOAuth).toHaveBeenCalled();
      expect(within(dialog).getByText("Google authorization opened in the browser.")).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Finish setup" })).toBeDisabled();
    });
  });

  it("requires Google when setup was completed but the account is signed out", async () => {
    const { api } = onboardingHcb({ setupCompletedAt: now });
    api.google.status = vi.fn(async () => ok(signedOutGoogleStatus()));
    installHcb(api);
    render(<App />);

    const dialog = await screen.findByRole("dialog", { name: "First-run setup" });
    expect(within(dialog).queryByRole("button", { name: "Continue without sync" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Finish setup" })).toBeDisabled();
    expect(api.settings.update).not.toHaveBeenCalled();
  });

  it("resets onboarding from Settings without deleting planner data", async () => {
    const { api } = onboardingHcb({ setupCompletedAt: now });
    api.google.status = vi.fn(async () => ok(connectedGoogleStatus()));
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Notes");
    expect(await screen.findByText("Startup data flow")).toBeInTheDocument();

    await goToSection("Settings");
    await user.click(screen.getByRole("button", { name: "Run setup again" }));

    await waitFor(() => {
      expect(api.settings.recoveryAction).toHaveBeenCalledWith({ action: "resetOnboarding" });
    });
    expect(await screen.findByRole("dialog", { name: "First-run setup" })).toBeInTheDocument();
    expect(api.notes.delete).not.toHaveBeenCalled();
  });

  it("updates startup setting from Settings", async () => {
    const api = seededHcb();
    api.settings.get = vi.fn(async () => ok(testSettings({ startOnLogin: false })));
    api.settings.update = vi.fn(async (request) =>
      ok(testSettings({ startOnLogin: request.startOnLogin ?? false }))
    );
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Settings");
    await user.click(screen.getByRole("checkbox", { name: "Open Hot Cross Buns at login" }));

    await waitFor(() => {
      expect(api.settings.update).toHaveBeenCalledWith({ startOnLogin: true });
    });
  });

  it("requires confirmation before destructive sync recovery actions", async () => {
    const api = seededHcb();
    installHcb(api);
    const user = userEvent.setup();
    render(<App />);

    await goToSection("Settings");
    await user.click(screen.getByRole("button", { name: /Force full resync/ }));

    expect(api.settings.recoveryAction).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Confirm destructive action" })).toBeInTheDocument();

    const confirmButton = screen.getByRole("button", { name: "Confirm" });
    expect(confirmButton).toBeDisabled();

    await user.type(screen.getByRole("textbox", { name: "Confirmation phrase" }), "FULL RESYNC");
    await user.click(confirmButton);

    await waitFor(() => {
      expect(api.settings.recoveryAction).toHaveBeenCalledWith({
        action: "forceFullResync",
        confirmation: {
          accepted: true,
          phrase: "FULL RESYNC"
        }
      });
    });
  });
});
