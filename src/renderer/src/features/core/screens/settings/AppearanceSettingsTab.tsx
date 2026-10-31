import { resolveFontName } from "../../../shell/fonts";
import { Select, SelectItem } from "@renderer/components/Select";
import {
  calendarEventColorForTheme,
  googleCalendarEventColors,
  type GoogleCalendarEventColorId,
  type SettingsSnapshot,
  type SettingsUpdateRequest
} from "@shared/ipc/contracts";
import type {
  ColorThemeDefinition
} from "@shared/ipc/themeCatalog";
import { Button, Input } from "../../../../components/primitives";
import { useI18n } from "../../../../i18n";
import {
  SegmentedControl,
  SettingsControlRow,
  SettingsGroup,
  SettingsSwitch,
  settingsSelectClass
} from "./SettingsPrimitives";
import {
  calendarViewModes,
  type CalendarViewModeId
} from "./settingsUtils";

type CalendarEventColorOverride = NonNullable<
  SettingsSnapshot["calendarEventColorOverrides"][GoogleCalendarEventColorId]
>;
interface AppearanceSettingsTabProps {
  browserRuntime?: boolean;
  activeColorTheme: ColorThemeDefinition;
  availableFontFamilies: string[];
  settings: SettingsSnapshot;
  updateBaseTheme: (theme: SettingsSnapshot["theme"]) => void;
  updateSettings: (request: SettingsUpdateRequest) => void;
}

export function AppearanceSettingsTab({
  browserRuntime = false,
  activeColorTheme,
  availableFontFamilies,
  settings,
  updateBaseTheme,
  updateSettings
}: AppearanceSettingsTabProps): JSX.Element {
  const { t } = useI18n();
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

  function updateCalendarEventColorOverride(
    colorId: GoogleCalendarEventColorId,
    patch: Partial<CalendarEventColorOverride>
  ): void {
    const current = settings.calendarEventColorOverrides[colorId] ?? calendarEventColorDefault(colorId);

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

  function calendarEventColorDefault(colorId: GoogleCalendarEventColorId): CalendarEventColorOverride {
    const themeColor = calendarEventColorForTheme(activeColorTheme, colorId);
    const googleColor = googleCalendarEventColors.find((color) => color.id === colorId);

    return {
      background: themeColor?.background ?? googleColor?.background ?? "#5484ed",
      foreground: themeColor?.foreground ?? googleColor?.foreground ?? "#ffffff"
    };
  }

  return (
    <div className="grid gap-5">
      <SettingsGroup title="Appearance">
        <SettingsControlRow
          description="Warm white or charcoal surfaces with coral accents. Follow your system appearance or choose a mode."
          label="Colour scheme"
        >
          <Select
            aria-label="Theme"
            className={settingsSelectClass}
            onValueChange={(value) => updateBaseTheme(value as SettingsSnapshot["theme"])}
            value={settings.theme}
          >
            <SelectItem value="system">Follow system</SelectItem>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
          </Select>
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
              className="w-56 max-w-full min-w-0 accent-[var(--color-accent)]"
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
        <SettingsControlRow label="UI font" description="DM Sans is the default. Welcome headings use DM Serif Display; Inter is available as an alternative.">
          <Select
            aria-label="Font family"
            className={settingsSelectClass}
            onValueChange={(value) =>
              updateSettings({
                uiFontName: value.trim() ? value : null
              })
            }
            value={resolveFontName(settings.uiFontName)}
          >
            {availableFontFamilies.map((fontName) => (
              <SelectItem key={fontName} value={fontName}>
                {fontName}
              </SelectItem>
            ))}
          </Select>
        </SettingsControlRow>
        <SettingsControlRow
          description="Used for notes and structured-text buffers, code, diagnostics, and keyboard shortcuts."
          label="Editor and buffer font"
        >
          <Select
            aria-label="Editor and buffer font family"
            className={settingsSelectClass}
            onValueChange={(value) =>
              updateSettings({
                uiMonoFontName: value.trim() ? value : null
              })
            }
            value={resolveFontName(settings.uiMonoFontName)}
          >
            {availableFontFamilies.map((fontName) => (
              <SelectItem key={fontName} value={fontName}>
                {fontName}
              </SelectItem>
            ))}
          </Select>
        </SettingsControlRow>
      </SettingsGroup>

      <SettingsGroup title="Calendar event colors">
        {googleCalendarEventColors.map((color) => {
          const override = settings.calendarEventColorOverrides[color.id];
          const current = override ?? calendarEventColorDefault(color.id);

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

      <SettingsGroup title={t("settings.layout")}>
        <div className="grid gap-1 border-b border-border px-3 py-3 last:border-b-0">
          <h3 className="text-[var(--text-md)] font-semibold text-text-primary">{t("layout.calendarViewModes")}</h3>
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
          <Select
            aria-label="Calendar timeline density"
            className={settingsSelectClass}
            onValueChange={(value) =>
              updateSettings({
                calendarTimelineDensity: value as SettingsSnapshot["calendarTimelineDensity"]
              })
            }
            value={settings.calendarTimelineDensity}
          >
            <SelectItem value="compact">Compact</SelectItem>
            <SelectItem value="comfortable">Comfortable</SelectItem>
            <SelectItem value="spacious">Spacious</SelectItem>
          </Select>
        </SettingsControlRow>
        <SettingsSwitch
          checked={settings.quickCreateExpandedByDefault}
          description="Calendar quick creation opens with optional fields visible when supported."
          label="Show all quick-create fields by default"
          onChange={(checked) => updateSettings({ quickCreateExpandedByDefault: checked })}
        />
        {!browserRuntime ? <SettingsSwitch
          checked={settings.restoreWindowStateEnabled}
          description="Keeps window restoration enabled across app launches."
          label="Restore previous session"
          onChange={(checked) => updateSettings({ restoreWindowStateEnabled: checked })}
        /> : null}
      </SettingsGroup>
    </div>
  );
}
