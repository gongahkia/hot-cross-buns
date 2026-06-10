import { useState } from "react";
import {
  calendarEventColorForTheme,
  googleCalendarEventColors,
  type GoogleCalendarEventColorId,
  type SettingsSnapshot,
  type SettingsUpdateRequest
} from "@shared/ipc/contracts";
import type {
  AppColorThemeDefinition,
  AppColorThemeId,
  ColorThemeDefinition
} from "@shared/ipc/themeCatalog";
import { customBackgroundThemeId } from "@shared/ipc/themeCatalog";
import { ArrowDown, ArrowUp, Image, PanelLeft, PanelRight, RotateCcw, Trash2 } from "lucide-react";
import { Button, Input } from "../../../../components/primitives";
import { useI18n } from "../../../../i18n";
import { customBackgroundFromFile } from "./backgroundTheme";
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
  toolbarActions,
  type CalendarViewModeId,
  type FontSurfaceId,
  type NavigationTabId,
  type ToolbarActionId
} from "./settingsUtils";

type PerSurfaceFontOverride = NonNullable<
  SettingsSnapshot["perSurfaceFontOverrides"][FontSurfaceId]
>;
type CalendarEventColorOverride = NonNullable<
  SettingsSnapshot["calendarEventColorOverrides"][GoogleCalendarEventColorId]
>;

interface AppearanceSettingsTabProps {
  activeColorTheme: ColorThemeDefinition;
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
  const { t } = useI18n();
  const [customBackgroundMessage, setCustomBackgroundMessage] = useState<string | null>(null);
  const inferredThemeActive = activeColorTheme.id === customBackgroundThemeId;

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

  function moveNavigationTab(tabId: NavigationTabId, direction: -1 | 1): void {
    updateSettings({
      navigationTabOrder: moveItem(settings.navigationTabOrder, tabId, direction)
    });
  }

  function moveToolbarAction(actionId: ToolbarActionId, direction: -1 | 1): void {
    updateSettings({
      toolbarActionOrder: moveItem(settings.toolbarActionOrder, actionId, direction)
    });
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

  async function selectCustomBackground(file: File | null): Promise<void> {
    if (!file) {
      return;
    }

    setCustomBackgroundMessage("Reading background.");

    try {
      const customBackground = await customBackgroundFromFile(file);

      updateSettings({
        customBackground,
        useInferredBackgroundTheme: true
      });
      setCustomBackgroundMessage("Background applied.");
    } catch (error) {
      setCustomBackgroundMessage(error instanceof Error ? error.message : "Background import failed.");
    }
  }

  function updateColorTheme(value: string): void {
    if (value === customBackgroundThemeId) {
      updateSettings({ useInferredBackgroundTheme: true });
      return;
    }

    updateSettings({
      colorTheme: value as AppColorThemeId,
      ...(settings.customBackground ? { useInferredBackgroundTheme: false } : {})
    });
  }

  function customBackgroundPreview(): string | null {
    if (!settings.customBackground) {
      return null;
    }

    return `data:${settings.customBackground.mimeType};base64,${settings.customBackground.dataBase64}`;
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
            onChange={(event) => updateColorTheme(event.target.value)}
            value={activeColorTheme.id}
          >
            {settings.customBackground ? (
              <option value={customBackgroundThemeId}>Inferred from background</option>
            ) : null}
            {matchingColorThemes.map((theme) => (
              <option key={theme.id} value={theme.id}>
                {theme.title}
              </option>
            ))}
          </select>
        </SettingsControlRow>
        <SettingsControlRow
          description="Use a local image as the app backdrop and infer the palette from its pixels."
          icon={Image}
          label="Custom background"
        >
          <div className="grid min-w-0 gap-2 sm:min-w-[24rem]">
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
              {customBackgroundPreview() ? (
                <img
                  alt="Custom background preview"
                  className="h-12 w-20 rounded-hcbSm border border-border object-cover"
                  src={customBackgroundPreview() ?? undefined}
                />
              ) : null}
              <Input
                accept="image/png,image/jpeg,image/webp"
                aria-label="Custom background image"
                className="max-w-60"
                onChange={(event) => void selectCustomBackground(event.currentTarget.files?.[0] ?? null)}
                type="file"
              />
              <Button
                disabled={!settings.customBackground}
                onClick={() => {
                  updateSettings({ customBackground: null, useInferredBackgroundTheme: true });
                  setCustomBackgroundMessage("Background cleared.");
                }}
                variant="secondary"
              >
                <Trash2 aria-hidden="true" size={14} />
                Clear
              </Button>
            </div>
            {settings.customBackground ? (
              <div className="flex flex-wrap justify-end gap-1">
                {[
                  settings.customBackground.palette.ember,
                  settings.customBackground.palette.moss,
                  settings.customBackground.palette.blue,
                  settings.customBackground.palette.cream,
                  settings.customBackground.palette.ink
                ].map((color) => (
                  <span
                    aria-hidden="true"
                    className="h-5 w-5 rounded-hcbSm border border-border"
                    key={color}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            ) : null}
            {customBackgroundMessage ? (
              <div className="text-right text-[var(--text-xs)] text-text-muted">{customBackgroundMessage}</div>
            ) : null}
          </div>
        </SettingsControlRow>
        <SettingsControlRow
          description="Use generated colors for surfaces and default event/tag mappings."
          label="Infer theme from background"
        >
          <input
            aria-label="Infer theme from background"
            checked={settings.useInferredBackgroundTheme && Boolean(settings.customBackground)}
            className="h-5 w-9 accent-[var(--color-accent)] disabled:opacity-50"
            disabled={!settings.customBackground}
            onChange={(event) => updateSettings({ useInferredBackgroundTheme: event.currentTarget.checked })}
            type="checkbox"
          />
        </SettingsControlRow>
        {inferredThemeActive && settings.customBackground ? (
          <SettingsControlRow label="Inferred palette">
            <div className="flex flex-wrap items-center justify-end gap-2 text-[var(--text-sm)] text-text-muted">
              <span>{settings.customBackground.palette.isDark ? "Dark" : "Light"}</span>
              <span className="font-mono">{settings.customBackground.palette.dominant}</span>
            </div>
          </SettingsControlRow>
        ) : null}
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

      <SettingsGroup title={t("settings.layout")}>
        <SettingsControlRow
          description={t("layout.navigationPlacement.description")}
          label={t("layout.navigationPlacement")}
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
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[var(--text-md)] font-semibold text-text-primary">{t("layout.navigationTabs")}</h3>
            <Button
              onClick={() => updateSettings({ navigationTabOrder: navigationTabs.map((tab) => tab.id) })}
              size="sm"
              variant="ghost"
            >
              <RotateCcw aria-hidden="true" size={13} />
              {t("action.reset")}
            </Button>
          </div>
          {settings.navigationTabOrder.map((tabId, index) => {
            const tab = navigationTabs.find((item) => item.id === tabId);
            if (!tab) {
              return null;
            }

            return (
              <SettingsSwitch
                checked={!settings.hiddenNavigationTabs.includes(tab.id)}
                key={tab.id}
                label={navigationLabel(tab.id, t)}
                onChange={(checked) => updateNavigationTab(tab.id, checked)}
                trailing={
                  <div className="flex items-center gap-1">
                    <Button
                      aria-label={`${t("action.moveUp")} ${navigationLabel(tab.id, t)}`}
                      disabled={index === 0}
                      onClick={() => moveNavigationTab(tab.id, -1)}
                      size="sm"
                      variant="ghost"
                    >
                      <ArrowUp aria-hidden="true" size={13} />
                    </Button>
                    <Button
                      aria-label={`${t("action.moveDown")} ${navigationLabel(tab.id, t)}`}
                      disabled={index === settings.navigationTabOrder.length - 1}
                      onClick={() => moveNavigationTab(tab.id, 1)}
                      size="sm"
                      variant="ghost"
                    >
                      <ArrowDown aria-hidden="true" size={13} />
                    </Button>
                  </div>
                }
              />
            );
          })}
        </div>
        <div className="grid gap-1 border-b border-border px-3 py-3 last:border-b-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[var(--text-md)] font-semibold text-text-primary">{t("layout.toolbarActions")}</h3>
            <Button
              onClick={() => updateSettings({ toolbarActionOrder: toolbarActions.map((action) => action.id) })}
              size="sm"
              variant="ghost"
            >
              <RotateCcw aria-hidden="true" size={13} />
              {t("action.reset")}
            </Button>
          </div>
          {settings.toolbarActionOrder.map((actionId, index) => {
            const action = toolbarActions.find((item) => item.id === actionId);
            if (!action) {
              return null;
            }

            return (
              <SettingsControlRow key={action.id} label={toolbarLabel(action.id, t)}>
                <div className="flex items-center justify-end gap-1">
                  <Button
                    aria-label={`${t("action.moveUp")} ${toolbarLabel(action.id, t)}`}
                    disabled={index === 0}
                    onClick={() => moveToolbarAction(action.id, -1)}
                    size="sm"
                    variant="ghost"
                  >
                    <ArrowUp aria-hidden="true" size={13} />
                  </Button>
                  <Button
                    aria-label={`${t("action.moveDown")} ${toolbarLabel(action.id, t)}`}
                    disabled={index === settings.toolbarActionOrder.length - 1}
                    onClick={() => moveToolbarAction(action.id, 1)}
                    size="sm"
                    variant="ghost"
                  >
                    <ArrowDown aria-hidden="true" size={13} />
                  </Button>
                </div>
              </SettingsControlRow>
            );
          })}
        </div>
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

function moveItem<T>(items: readonly T[], item: T, direction: -1 | 1): T[] {
  const next = [...items];
  const index = next.indexOf(item);
  const target = index + direction;

  if (index < 0 || target < 0 || target >= next.length) {
    return next;
  }

  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function navigationLabel(tabId: NavigationTabId, t: ReturnType<typeof useI18n>["t"]): string {
  if (tabId === "calendar") {
    return t("nav.calendar");
  }

  if (tabId === "tasks") {
    return t("nav.tasks");
  }

  return t("nav.notes");
}

function toolbarLabel(actionId: ToolbarActionId, t: ReturnType<typeof useI18n>["t"]): string {
  if (actionId === "commandPalette") {
    return t("action.commandPalette");
  }

  if (actionId === "notifications") {
    return t("action.notifications");
  }

  if (actionId === "diagnostics") {
    return t("action.diagnostics");
  }

  if (actionId === "splitPane") {
    return t("action.splitView");
  }

  if (actionId === "refresh") {
    return t("action.refresh");
  }

  return t("action.settings");
}
