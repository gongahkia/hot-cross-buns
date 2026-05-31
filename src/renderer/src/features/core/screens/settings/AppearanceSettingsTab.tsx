import {
  googleCalendarEventColors,
  type GoogleCalendarEventColorId,
  type SettingsSnapshot,
  type SettingsUpdateRequest
} from "@shared/ipc/contracts";
import type {
  AppColorThemeDefinition,
  AppColorThemeId
} from "@shared/ipc/themeCatalog";
import { PanelLeft, PanelRight } from "lucide-react";
import { Button, Input } from "../../../../components/primitives";
import {
  SegmentedControl,
  SettingsControlRow,
  SettingsGroup,
  SettingsSwitch,
  settingsSelectClass
} from "./SettingsPrimitives";
import {
  calendarViewModes,
  fontSurfaceOptions,
  navigationTabs,
  type CalendarViewModeId,
  type FontSurfaceId,
  type NavigationTabId
} from "./settingsUtils";

type PerSurfaceFontOverride = NonNullable<
  SettingsSnapshot["perSurfaceFontOverrides"][FontSurfaceId]
>;
type CalendarEventColorOverride = NonNullable<
  SettingsSnapshot["calendarEventColorOverrides"][GoogleCalendarEventColorId]
>;

interface AppearanceSettingsTabProps {
  activeColorTheme: AppColorThemeDefinition;
  availableFontFamilies: string[];
  matchingColorThemes: readonly AppColorThemeDefinition[];
  settings: SettingsSnapshot;
  updateBaseTheme: (theme: SettingsSnapshot["theme"]) => void;
  updateSettings: (request: SettingsUpdateRequest) => void;
}

export function AppearanceSettingsTab({
  activeColorTheme,
  availableFontFamilies,
  matchingColorThemes,
  settings,
  updateBaseTheme,
  updateSettings
}: AppearanceSettingsTabProps): JSX.Element {
  function updateNavigationTab(tabId: NavigationTabId, visible: boolean): void {
    const hidden = new Set(settings.hiddenNavigationTabs);

    if (visible) {
      hidden.delete(tabId);
    } else {
      hidden.add(tabId);
    }

    if (navigationTabs.every((tab) => hidden.has(tab.id))) {
      return;
    }

    updateSettings({ hiddenNavigationTabs: [...hidden] });
  }

  function updateCalendarViewMode(viewId: CalendarViewModeId, visible: boolean): void {
    const hidden = new Set(settings.hiddenCalendarViewModes);

    if (visible) {
      hidden.delete(viewId);
    } else {
      hidden.add(viewId);
    }

    if (calendarViewModes.every((mode) => hidden.has(mode.id))) {
      return;
    }

    updateSettings({ hiddenCalendarViewModes: [...hidden] });
  }

  function updatePerSurfaceFont(
    surface: FontSurfaceId,
    patch: Partial<PerSurfaceFontOverride>
  ): void {
    const current = settings.perSurfaceFontOverrides[surface] ?? {
      uiFontName: null,
      uiTextSizePoints: null
    };

    updateSettings({
      perSurfaceFontOverrides: {
        ...settings.perSurfaceFontOverrides,
        [surface]: {
          ...current,
          ...patch
        }
      }
    });
  }

  function resetPerSurfaceFont(surface: FontSurfaceId): void {
    const next = { ...settings.perSurfaceFontOverrides };
    delete next[surface];
    updateSettings({ perSurfaceFontOverrides: next });
  }

  function updateCalendarEventColorOverride(
    colorId: GoogleCalendarEventColorId,
    patch: Partial<CalendarEventColorOverride>
  ): void {
    const fallback = googleCalendarEventColors.find((color) => color.id === colorId);
    const current = settings.calendarEventColorOverrides[colorId] ?? {
      background: fallback?.background ?? "#5484ed",
      foreground: fallback?.foreground ?? "#ffffff"
    };

    updateSettings({
      calendarEventColorOverrides: {
        ...settings.calendarEventColorOverrides,
        [colorId]: {
          ...current,
          ...patch
        }
      }
    });
  }

  function resetCalendarEventColorOverride(colorId: GoogleCalendarEventColorId): void {
    const next = { ...settings.calendarEventColorOverrides };
    delete next[colorId];
    updateSettings({ calendarEventColorOverrides: next });
  }

  return (
    <div className="grid gap-5">
      <SettingsGroup title="Appearance">
        <SettingsControlRow
          description="Choose whether app chrome resolves as dark, light, or follows macOS."
          label="Base colour scheme"
        >
          <select
            aria-label="Theme"
            className={settingsSelectClass}
            onChange={(event) => updateBaseTheme(event.target.value as SettingsSnapshot["theme"])}
            value={settings.theme}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </SettingsControlRow>
        <SettingsControlRow
          description="Palette used by cards, text, and app surfaces."
          label="Theme"
        >
          <select
            aria-label="Color theme"
            className={settingsSelectClass}
            onChange={(event) => updateSettings({ colorTheme: event.target.value as AppColorThemeId })}
            value={activeColorTheme.id}
          >
            {matchingColorThemes.map((theme) => (
              <option key={theme.id} value={theme.id}>
                {theme.title}
              </option>
            ))}
          </select>
        </SettingsControlRow>
        <SettingsSwitch
          checked={settings.disableAnimations}
          description="Turns off app-driven transitions, panel motion, and animated state changes."
          label="Disable animations"
          onChange={(checked) => updateSettings({ disableAnimations: checked })}
        />
        <SettingsControlRow label="Layout scale">
          <div className="flex min-w-0 items-center gap-3">
            <input
              aria-label="Layout scale"
              className="w-56 accent-[var(--color-accent)]"
              max={1.5}
              min={0.8}
              onChange={(event) => updateSettings({ uiLayoutScale: Number(event.target.value) })}
              step={0.05}
              type="range"
              value={settings.uiLayoutScale}
            />
            <span className="w-12 text-right font-mono text-[var(--text-xs)] text-text-muted">
              {Math.round(settings.uiLayoutScale * 100)}%
            </span>
          </div>
        </SettingsControlRow>
        <SettingsControlRow label="Text size">
          <div className="flex min-w-0 items-center gap-3">
            <Input
              aria-label="Text size points"
              className="w-24"
              max={24}
              min={9}
              onChange={(event) =>
                updateSettings({
                  uiTextSizePoints: Math.min(24, Math.max(9, Number(event.target.value) || 13))
                })
              }
              type="number"
              value={settings.uiTextSizePoints}
            />
            <Button onClick={() => updateSettings({ uiTextSizePoints: 13 })} variant="ghost">
              Reset
            </Button>
          </div>
        </SettingsControlRow>
        <SettingsControlRow label="UI font">
          <select
            aria-label="Font family"
            className={settingsSelectClass}
            onChange={(event) =>
              updateSettings({
                uiFontName: event.target.value.trim() ? event.target.value : null
              })
            }
            value={settings.uiFontName ?? ""}
          >
            <option value="">System</option>
            {availableFontFamilies.map((fontName) => (
              <option key={fontName} value={fontName}>
                {fontName}
              </option>
            ))}
          </select>
        </SettingsControlRow>
      </SettingsGroup>

      <SettingsGroup title="Calendar event colors">
        {googleCalendarEventColors.map((color) => {
          const override = settings.calendarEventColorOverrides[color.id];
          const current = override ?? color;

          return (
            <SettingsControlRow key={color.id} label={color.label}>
              <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                <span
                  aria-hidden="true"
                  className="h-7 w-7 shrink-0 rounded-hcbSm border border-border"
                  style={{ backgroundColor: current.background }}
                />
                <input
                  aria-label={`${color.label} background`}
                  className="h-8 w-10 rounded-hcbSm border border-border bg-surface-0 p-0.5"
                  onChange={(event) =>
                    updateCalendarEventColorOverride(color.id, { background: event.target.value })
                  }
                  type="color"
                  value={current.background}
                />
                <input
                  aria-label={`${color.label} text`}
                  className="h-8 w-10 rounded-hcbSm border border-border bg-surface-0 p-0.5"
                  onChange={(event) =>
                    updateCalendarEventColorOverride(color.id, { foreground: event.target.value })
                  }
                  type="color"
                  value={current.foreground}
                />
                <Button
                  disabled={!override}
                  onClick={() => resetCalendarEventColorOverride(color.id)}
                  variant="ghost"
                >
                  Reset
                </Button>
              </div>
            </SettingsControlRow>
          );
        })}
      </SettingsGroup>

      <SettingsGroup title="Per-surface fonts">
        {fontSurfaceOptions.map((surface) => {
          const override = settings.perSurfaceFontOverrides[surface.id];

          return (
            <SettingsControlRow key={surface.id} label={surface.label}>
              <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                <select
                  aria-label={`${surface.label} font`}
                  className={settingsSelectClass}
                  onChange={(event) =>
                    updatePerSurfaceFont(surface.id, {
                      uiFontName: event.target.value.trim() ? event.target.value : null
                    })
                  }
                  value={override?.uiFontName ?? ""}
                >
                  <option value="">(inherit)</option>
                  {availableFontFamilies.map((fontName) => (
                    <option key={fontName} value={fontName}>
                      {fontName}
                    </option>
                  ))}
                </select>
                <Input
                  aria-label={`${surface.label} size`}
                  className="w-20"
                  max={24}
                  min={9}
                  onChange={(event) =>
                    updatePerSurfaceFont(surface.id, {
                      uiTextSizePoints: event.target.value ? Number(event.target.value) : null
                    })
                  }
                  placeholder="Size"
                  type="number"
                  value={override?.uiTextSizePoints ?? ""}
                />
                <Button onClick={() => resetPerSurfaceFont(surface.id)} variant="ghost">
                  Reset
                </Button>
              </div>
            </SettingsControlRow>
          );
        })}
      </SettingsGroup>

      <SettingsGroup title="Layout">
        <SettingsControlRow
          description="Left keeps the native sidebar placement; right moves the same tabs around the current view."
          label="Navigation placement"
        >
          <SegmentedControl
            options={[
              { label: "Left", value: "left", icon: PanelLeft },
              { label: "Right", value: "right", icon: PanelRight }
            ]}
            onChange={(value) =>
              updateSettings({ navigationPlacement: value as SettingsSnapshot["navigationPlacement"] })
            }
            value={settings.navigationPlacement}
          />
        </SettingsControlRow>
        <div className="grid gap-1 border-b border-border px-3 py-3 last:border-b-0">
          <h3 className="text-[var(--text-md)] font-semibold text-text-primary">Navigation tabs</h3>
          {navigationTabs.map((tab) => (
            <SettingsSwitch
              checked={!settings.hiddenNavigationTabs.includes(tab.id)}
              key={tab.id}
              label={tab.label}
              onChange={(checked) => updateNavigationTab(tab.id, checked)}
            />
          ))}
        </div>
        <div className="grid gap-1 border-b border-border px-3 py-3 last:border-b-0">
          <h3 className="text-[var(--text-md)] font-semibold text-text-primary">Calendar view modes</h3>
          {calendarViewModes.map((mode) => (
            <SettingsSwitch
              checked={!settings.hiddenCalendarViewModes.includes(mode.id)}
              key={mode.id}
              label={mode.label}
              onChange={(checked) => updateCalendarViewMode(mode.id, checked)}
            />
          ))}
        </div>
        <SettingsControlRow
          description="Month view will not navigate beyond these loaded month bounds."
          label="Month scroll range"
        >
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <span className="text-[var(--text-sm)] text-text-muted">Past</span>
            <Input
              aria-label="Past months"
              className="w-20"
              max={24}
              min={0}
              onChange={(event) => updateSettings({ monthScrollPastMonths: Number(event.target.value) || 0 })}
              type="number"
              value={settings.monthScrollPastMonths}
            />
            <span className="text-[var(--text-sm)] text-text-muted">Future</span>
            <Input
              aria-label="Future months"
              className="w-20"
              max={24}
              min={0}
              onChange={(event) => updateSettings({ monthScrollFutureMonths: Number(event.target.value) || 0 })}
              type="number"
              value={settings.monthScrollFutureMonths}
            />
          </div>
        </SettingsControlRow>
        <SettingsControlRow
          description="Controls hour row height in day, multi-day, and week views."
          label="Calendar timeline density"
        >
          <select
            aria-label="Calendar timeline density"
            className={settingsSelectClass}
            onChange={(event) =>
              updateSettings({
                calendarTimelineDensity: event.target.value as SettingsSnapshot["calendarTimelineDensity"]
              })
            }
            value={settings.calendarTimelineDensity}
          >
            <option value="compact">Compact</option>
            <option value="comfortable">Comfortable</option>
            <option value="spacious">Spacious</option>
          </select>
        </SettingsControlRow>
        <SettingsSwitch
          checked={settings.quickCreateExpandedByDefault}
          description="Calendar quick creation opens with optional fields visible when supported."
          label="Show all quick-create fields by default"
          onChange={(checked) => updateSettings({ quickCreateExpandedByDefault: checked })}
        />
        <SettingsSwitch
          checked={settings.restoreWindowStateEnabled}
          description="Keeps window restoration enabled across app launches."
          label="Restore previous session"
          onChange={(checked) => updateSettings({ restoreWindowStateEnabled: checked })}
        />
      </SettingsGroup>
    </div>
  );
}
