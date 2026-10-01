import type { SettingsSnapshot } from "@shared/ipc/contracts";
import {
  Bell,
  CalendarDays,
  Columns2,
  Command,
  Gauge,
  ListTodo,
  RefreshCw,
  Settings2,
  StickyNote
} from "lucide-react";
import appIconUrl from "../../../../../assets/brand/buns-app-icon-sidebar.png";
import { Badge, Button, cx } from "../../components/primitives";
import type { SectionId } from "../../data/mockPlanner";
import { useI18n } from "../../i18n";
import { ariaKeyShortcuts, displayAccelerator } from "../core/hotkeys";

type ToolbarActionId = SettingsSnapshot["toolbarActionOrder"][number];

export function AppHeader({
  appNotificationsCount,
  commandPaletteOpen,
  diagnosticsOpen,
  keybindings,
  notificationsOpen,
  activeSectionId,
  onNavigateToSection,
  onOpenCommandPalette,
  onOpenSplitPane,
  onRefresh,
  onToggleDiagnostics,
  onToggleNotifications,
  onToggleSettings,
  settingsOpen,
  toolbarActionOrder
}: {
  appNotificationsCount: number;
  commandPaletteOpen: boolean;
  diagnosticsOpen: boolean;
  keybindings: SettingsSnapshot["keybindings"];
  notificationsOpen: boolean;
  activeSectionId: SectionId;
  onNavigateToSection: (sectionId: SectionId) => void;
  onOpenCommandPalette: () => void;
  onOpenSplitPane: () => void;
  onRefresh: () => void;
  onToggleDiagnostics: () => void;
  onToggleNotifications: () => void;
  onToggleSettings: () => void;
  settingsOpen: boolean;
  toolbarActionOrder: SettingsSnapshot["toolbarActionOrder"];
}): JSX.Element {
  const { t } = useI18n();
  const primaryNavigation = [
    {
      id: "calendar" as const,
      icon: CalendarDays,
      label: t("nav.calendar"),
      shortcut: keybindings["navigation.calendar"]
    },
    {
      id: "tasks" as const,
      icon: ListTodo,
      label: t("nav.tasks"),
      shortcut: keybindings["navigation.tasks"]
    },
    {
      id: "notes" as const,
      icon: StickyNote,
      label: t("nav.notes"),
      shortcut: keybindings["navigation.notes"]
    }
  ];
  const toolbarButtons: Record<ToolbarActionId, JSX.Element> = {
    commandPalette: (
      <Button
        aria-expanded={commandPaletteOpen}
        aria-keyshortcuts={ariaKeyShortcuts(keybindings["commandPalette.open"])}
        aria-label={t("action.commandPalette")}
        className="min-w-10"
        key="commandPalette"
        onClick={() => onOpenCommandPalette()}
        title={t("action.commandPalette")}
        variant={commandPaletteOpen ? "secondary" : "ghost"}
      >
        <Command aria-hidden="true" size={15} />
      </Button>
    ),
    notifications: (
      <Button
        aria-expanded={notificationsOpen}
        aria-keyshortcuts={ariaKeyShortcuts(keybindings["navigation.notifications.toggle"])}
        aria-label={`${t("action.notifications")}, ${appNotificationsCount} active`}
        className="min-w-10"
        key="notifications"
        onClick={onToggleNotifications}
        title={t("action.notifications")}
        variant={notificationsOpen ? "secondary" : "ghost"}
      >
        <Bell aria-hidden="true" size={15} />
        <Badge tone={appNotificationsCount > 1 ? "warning" : "neutral"}>
          {appNotificationsCount}
        </Badge>
      </Button>
    ),
    diagnostics: (
      <Button
        aria-expanded={diagnosticsOpen}
        aria-keyshortcuts={ariaKeyShortcuts(keybindings["navigation.diagnostics.toggle"])}
        aria-label={t("action.diagnostics")}
        className="min-w-10"
        key="diagnostics"
        onClick={onToggleDiagnostics}
        title={t("action.diagnostics")}
        variant={diagnosticsOpen ? "secondary" : "ghost"}
      >
        <Gauge aria-hidden="true" size={15} />
      </Button>
    ),
    splitPane: (
      <Button
        aria-keyshortcuts={ariaKeyShortcuts(keybindings["pane.split.horizontal"])}
        aria-label={t("action.splitView")}
        className="min-w-10"
        key="splitPane"
        onClick={onOpenSplitPane}
        title={t("action.splitView")}
        variant="ghost"
      >
        <Columns2 aria-hidden="true" size={15} />
      </Button>
    ),
    refresh: (
      <Button
        aria-keyshortcuts={ariaKeyShortcuts(keybindings["sync.refresh"])}
        aria-label={t("action.refresh")}
        className="min-w-10"
        data-action-id="sync.refresh"
        key="refresh"
        onClick={onRefresh}
        title={t("action.refresh")}
        variant="ghost"
      >
        <RefreshCw aria-hidden="true" size={15} />
      </Button>
    ),
    settings: (
      <Button
        aria-expanded={settingsOpen}
        aria-keyshortcuts={ariaKeyShortcuts(keybindings["navigation.settings"])}
        aria-label={t("action.settings")}
        className="min-w-10"
        key="settings"
        onClick={onToggleSettings}
        title={t("action.settings")}
        variant={settingsOpen ? "secondary" : "ghost"}
      >
        <Settings2 aria-hidden="true" size={15} />
      </Button>
    )
  };

  return (
    <header className="grid min-h-14 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-border bg-bg-primary px-3 py-2 md:grid-cols-[minmax(11rem,1fr)_auto_minmax(11rem,1fr)] md:gap-3 md:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <img
          alt=""
          aria-hidden="true"
          className="hcb-media-outline size-8 shrink-0 rounded-hcbMd object-cover"
          draggable={false}
          src={appIconUrl}
        />
        <h1 className="truncate text-[var(--text-md)] font-semibold" id="planner-title">Hot Cross Buns</h1>
      </div>

      <nav
        aria-label="Primary"
        className="order-3 col-span-2 flex min-w-0 items-center justify-start gap-1 overflow-x-auto border-t border-border pt-2 md:order-none md:col-span-1 md:justify-center md:border-t-0 md:pt-0"
      >
        {primaryNavigation.map(({ icon: Icon, id, label, shortcut }) => {
          const active = activeSectionId === id;
          const shortcutLabel = displayAccelerator(shortcut);

          return (
            <Button
              aria-current={active ? "page" : undefined}
              aria-keyshortcuts={ariaKeyShortcuts(shortcut)}
              className={cx(
                "min-w-10 gap-2 px-3 text-[var(--text-sm)]",
                active ? "border-accent bg-surface-0 text-text-primary" : "text-text-secondary"
              )}
              key={id}
              onClick={() => onNavigateToSection(id)}
              title={`${label} (${shortcutLabel})`}
              variant="ghost"
            >
              <Icon aria-hidden="true" size={15} strokeWidth={2} />
              <span>{label}</span>
              <kbd className="hidden rounded-hcbSm border border-border bg-bg-secondary px-1.5 py-0.5 font-mono text-[11px] font-medium text-text-muted lg:inline">
                {shortcutLabel}
              </kbd>
            </Button>
          );
        })}
      </nav>

      <div className="flex min-w-0 shrink-0 items-center justify-end gap-2 overflow-x-auto" role="toolbar" aria-label="Planner actions">
        {toolbarActionOrder.map((actionId) => toolbarButtons[actionId])}
      </div>
    </header>
  );
}
