import type { SettingsSnapshot } from "@shared/ipc/contracts";
import {
  Bell,
  Columns2,
  Command,
  Gauge,
  RefreshCw,
  Settings2
} from "lucide-react";
import appIconUrl from "../../../../../assets/brand/buns-app-icon-sidebar.png";
import { Badge, Button } from "../../components/primitives";
import { useI18n } from "../../i18n";
import { ariaKeyShortcuts } from "../core/hotkeys";

type ToolbarActionId = SettingsSnapshot["toolbarActionOrder"][number];

export function AppHeader({
  appNotificationsCount,
  commandPaletteOpen,
  diagnosticsOpen,
  keybindings,
  notificationsOpen,
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
    <header className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-bg-primary px-3 py-2 sm:flex-nowrap md:px-5">
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

      <div className="flex min-w-0 shrink-0 items-center gap-2 overflow-x-auto" role="toolbar" aria-label="Planner actions">
        {toolbarActionOrder.map((actionId) => toolbarButtons[actionId])}
      </div>
    </header>
  );
}
