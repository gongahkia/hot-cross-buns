import type { SettingsSnapshot } from "@shared/ipc/contracts";
import {
  Bell,
  Command,
  Gauge,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightOpen,
  RefreshCw,
  Settings2
} from "lucide-react";
import { Badge, Button } from "../../components/primitives";
import { displayAccelerator } from "../core/hotkeys";

export function AppHeader({
  activeSectionTitle,
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
  onToggleSidebar,
  settingsOpen,
  sidebarOpen
}: {
  activeSectionTitle: string;
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
  onToggleSidebar: () => void;
  settingsOpen: boolean;
  sidebarOpen: boolean;
}): JSX.Element {
  const SidebarToggleIcon = sidebarOpen ? PanelLeftClose : PanelLeftOpen;

  return (
    <header className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-bg-primary px-3 py-2 sm:flex-nowrap md:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <Button
          aria-controls="app-sidebar"
          aria-expanded={sidebarOpen}
          aria-keyshortcuts="Meta+S Control+S"
          aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          className="min-w-8"
          onClick={onToggleSidebar}
          title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          variant="ghost"
        >
          <SidebarToggleIcon aria-hidden="true" size={15} />
          <span className="hidden rounded-hcbSm border border-border px-1.5 font-mono text-[var(--text-xs)] text-text-muted md:inline">
            {displayAccelerator(keybindings["navigation.sidebar.toggle"])}
          </span>
        </Button>
        <h1 className="sr-only" id="planner-title">{activeSectionTitle}</h1>
      </div>

      <div className="flex min-w-0 shrink-0 items-center gap-2 overflow-x-auto" role="toolbar" aria-label="Planner actions">
        <Button
          aria-expanded={commandPaletteOpen}
          aria-label="Command palette"
          aria-keyshortcuts="Meta+P Control+P"
          className="min-w-8"
          onClick={onOpenCommandPalette}
          title="Command palette"
          variant={commandPaletteOpen ? "secondary" : "ghost"}
        >
          <Command aria-hidden="true" size={15} />
          <span className="hidden rounded-hcbSm border border-border px-1.5 font-mono text-[var(--text-xs)] text-text-muted md:inline">
            {displayAccelerator(keybindings["commandPalette.open"])}
          </span>
        </Button>
        <Button
          aria-expanded={notificationsOpen}
          aria-label={`Notifications, ${appNotificationsCount} active`}
          aria-keyshortcuts="Meta+N Control+N"
          className="min-w-8"
          onClick={onToggleNotifications}
          title="Notifications"
          variant={notificationsOpen ? "secondary" : "ghost"}
        >
          <Bell aria-hidden="true" size={15} />
          <Badge tone={appNotificationsCount > 1 ? "warning" : "neutral"}>
            {appNotificationsCount}
          </Badge>
          <span className="hidden rounded-hcbSm border border-border px-1.5 font-mono text-[var(--text-xs)] text-text-muted md:inline">
            {displayAccelerator(keybindings["navigation.notifications.toggle"])}
          </span>
        </Button>
        <Button
          aria-expanded={diagnosticsOpen}
          aria-label="Diagnostics"
          aria-keyshortcuts="Meta+. Control+."
          className="min-w-8"
          onClick={onToggleDiagnostics}
          title="Diagnostics"
          variant={diagnosticsOpen ? "secondary" : "ghost"}
        >
          <Gauge aria-hidden="true" size={15} />
          <span className="hidden rounded-hcbSm border border-border px-1.5 font-mono text-[var(--text-xs)] text-text-muted md:inline">
            {displayAccelerator(keybindings["navigation.diagnostics.toggle"])}
          </span>
        </Button>
        <Button
          aria-label="Split view"
          aria-keyshortcuts="Meta+T Control+T"
          className="min-w-8"
          onClick={onOpenSplitPane}
          title="Split view"
          variant="ghost"
        >
          <PanelRightOpen aria-hidden="true" size={15} />
          <span className="hidden rounded-hcbSm border border-border px-1.5 font-mono text-[var(--text-xs)] text-text-muted md:inline">
            {displayAccelerator(keybindings["pane.create"])}
          </span>
        </Button>
        <Button
          aria-label="Reload"
          aria-keyshortcuts="Meta+R Control+R"
          className="min-w-8"
          data-action-id="sync.refresh"
          onClick={onRefresh}
          title="Reload local cache"
          variant="ghost"
        >
          <RefreshCw aria-hidden="true" size={15} />
          <span className="hidden rounded-hcbSm border border-border px-1.5 font-mono text-[var(--text-xs)] text-text-muted md:inline">
            {displayAccelerator(keybindings["sync.refresh"])}
          </span>
        </Button>
        <Button
          aria-label="Settings"
          aria-expanded={settingsOpen}
          aria-keyshortcuts="Meta+, Control+,"
          className="min-w-8"
          onClick={onToggleSettings}
          title="Settings"
          variant={settingsOpen ? "secondary" : "ghost"}
        >
          <Settings2 aria-hidden="true" size={15} />
          <span className="hidden rounded-hcbSm border border-border px-1.5 font-mono text-[var(--text-xs)] text-text-muted md:inline">
            {displayAccelerator(keybindings["navigation.settings"])}
          </span>
        </Button>
      </div>
    </header>
  );
}
