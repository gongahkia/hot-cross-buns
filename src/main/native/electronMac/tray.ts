import {
  Menu,
  Tray,
  app,
  nativeImage,
  type MenuItemConstructorOptions,
  type NativeImage
} from "electron";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  NativeMenuBarItem,
  NativeMenuBarSnapshot,
  NativeOperationResult,
  NativeTrayActions
} from "../types";
import { brandAssetPath } from "../brandAssets";
import { MenuBarPanelController } from "./menuBarPanelController";
import { unsupported } from "./operationResults";

type TrayIconDefinition = { path: string; completed?: boolean } | "none";

export class MacTrayController {
  private tray: Tray | undefined;
  private trayRefreshTimer: NodeJS.Timeout | undefined;
  private readonly menuBarPanel = new MenuBarPanelController();

  create(actions: NativeTrayActions): NativeOperationResult {
    if (process.platform !== "darwin") {
      return unsupported("macOS menu bar item is unavailable on this platform.");
    }

    try {
      const image = trayIconImage(trayIconDefinition(actions.snapshot()));
      image.setTemplateImage(true);
      this.tray?.destroy();
      this.clearRefreshTimer();
      this.tray = new Tray(image);
      this.tray.setIgnoreDoubleClickEvents(true);
      this.refreshPresentation(actions);
      this.tray.on("click", () => {
        void this.handlePrimaryClick(actions);
      });
      this.tray.on("right-click", () => {
        this.refreshPresentation(actions);
        this.tray?.popUpContextMenu(trayUtilityMenu(actions));
      });
      this.trayRefreshTimer = setInterval(() => {
        this.refreshPresentation(actions);
      }, 60_000);
      this.trayRefreshTimer.unref?.();

      return {
        ok: true,
        state: "ready",
        message: "macOS menu bar item is installed."
      };
    } catch (error) {
      return {
        ok: false,
        state: "error",
        message: error instanceof Error ? error.message : "Could not create the menu bar item."
      };
    }
  }

  destroy(): void {
    this.menuBarPanel.destroy();
    this.clearRefreshTimer();
    this.tray?.destroy();
    this.tray = undefined;
    app.dock?.setBadge("");
  }

  private async handlePrimaryClick(actions: NativeTrayActions): Promise<void> {
    const snapshot = this.refreshPresentation(actions);

    if (snapshot.primaryClickAction === "open-menu") {
      if (!this.tray) {
        return;
      }

      try {
        await this.menuBarPanel.toggle(actions, snapshot, this.tray.getBounds());
      } catch {
        this.tray.popUpContextMenu(menuBarPanelMenu(actions, snapshot));
      }
      return;
    }

    actions.primaryClick();
  }

  private refreshPresentation(actions: NativeTrayActions): NativeMenuBarSnapshot {
    const snapshot = actions.snapshot();
    const image = trayIconImage(trayIconDefinition(snapshot));
    image.setTemplateImage(true);
    const title = snapshot.statusLabel ?? snapshot.badgeLabel ?? "";

    this.tray?.setImage(image);
    this.tray?.setToolTip(snapshot.tooltip);
    this.tray?.setTitle(title);
    app.dock?.setBadge(snapshot.dockBadgeLabel ?? "");

    return snapshot;
  }

  private clearRefreshTimer(): void {
    if (!this.trayRefreshTimer) {
      return;
    }

    clearInterval(this.trayRefreshTimer);
    this.trayRefreshTimer = undefined;
  }
}

function trayIconDefinition(snapshot: NativeMenuBarSnapshot): TrayIconDefinition {
  if (snapshot.panelStyle !== "calendar") {
    return "none";
  }

  const customIcon = snapshot.customMenuBarIcons.find((icon: { id: string; fileName: string }) => icon.id === snapshot.calendarIconId);
  if (customIcon) {
    return { path: customMenuBarIconPath(customIcon.fileName) };
  }

  return {
    path: brandAssetPath(snapshot.calendarDone ? "menu-bar-calendar-check.png" : "menu-bar-calendar.png"),
    completed: snapshot.calendarDone
  };
}

function trayIconImage(iconDefinition: TrayIconDefinition): NativeImage {
  if (iconDefinition === "none") {
    return nativeImage.createEmpty();
  }

  const image = menuBarIconImage(iconDefinition.path);
  return image.isEmpty() ? fallbackCalendarImage(Boolean(iconDefinition.completed)) : image;
}

/** A template glyph also works in source checkouts and builds without brand artwork. */
function fallbackCalendarImage(completed: boolean): NativeImage {
  const size = 36;
  const pixels = Buffer.alloc(size * size * 4);
  const paint = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < size && y < size) pixels[(y * size + x) * 4 + 3] = 255;
  };
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    for (let step = 0; step <= steps; step += 1) {
      const x = Math.round(x1 + (x2 - x1) * step / Math.max(1, steps));
      const y = Math.round(y1 + (y2 - y1) * step / Math.max(1, steps));
      paint(x, y); paint(x + 1, y); paint(x, y + 1);
    }
  };
  line(5, 7, 29, 7); line(5, 7, 5, 30); line(29, 7, 29, 30);
  line(5, 30, 29, 30); line(5, 14, 29, 14);
  line(11, 4, 11, 10); line(23, 4, 23, 10);
  if (completed) { line(10, 22, 15, 26); line(15, 26, 24, 18); }
  else { line(11, 20, 13, 20); line(21, 20, 23, 20); line(11, 25, 13, 25); }
  return nativeImage.createFromBitmap(pixels, { width: size, height: size, scaleFactor: 2 });
}

function customMenuBarIconPath(fileName: string): string {
  return join(app.getPath("userData"), "menu-bar-icons", "custom", fileName);
}

function menuBarIconImage(path: string): NativeImage {
  const image = existsSync(path) ? nativeImage.createFromPath(path) : nativeImage.createEmpty();
  const retinaPath = path.replace(/\.png$/i, "@2x.png");

  if (!image.isEmpty() && existsSync(retinaPath)) {
    image.addRepresentation({
      scaleFactor: 2,
      dataURL: `data:image/png;base64,${readFileSync(retinaPath).toString("base64")}`
    });
  }

  return image;
}

function menuBarPanelMenu(actions: NativeTrayActions, snapshot: NativeMenuBarSnapshot): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: snapshot.title,
      sublabel: snapshot.subtitle,
      enabled: false
    }
  ];

  for (const section of snapshot.sections) {
    template.push({ type: "separator" });

    if (section.title) {
      template.push({
        label: section.title,
        enabled: false
      });
    }

    template.push(...section.items.map((item) => menuItemFromSnapshotItem(actions, item)));
  }

  template.push(
    { type: "separator" },
    {
      label: "Refresh Tasks and Calendar",
      click: actions.refresh
    },
    {
      label: "Open Hot Cross Buns",
      click: actions.openMainWindow
    },
    {
      label: "Settings",
      click: actions.openSettings
    },
    { type: "separator" },
    {
      label: "Quit",
      click: actions.quit
    }
  );

  return Menu.buildFromTemplate(template);
}

function trayUtilityMenu(actions: NativeTrayActions): Menu {
  return Menu.buildFromTemplate([
    {
      label: "Open Hot Cross Buns",
      click: actions.openMainWindow
    },
    {
      label: "Refresh Tasks and Calendar",
      click: actions.refresh
    },
    { type: "separator" },
    {
      label: "Settings",
      click: actions.openSettings
    },
    { type: "separator" },
    {
      label: "Quit",
      click: actions.quit
    }
  ]);
}

function menuItemFromSnapshotItem(
  actions: NativeTrayActions,
  item: NativeMenuBarItem
): MenuItemConstructorOptions {
  return {
    label: item.label,
    sublabel: item.detail,
    enabled: Boolean(item.route || item.action),
    click: () => {
      if (item.route) {
        actions.openRoute(item.route);
        return;
      }

      if (item.action === "refresh") {
        actions.refresh();
      } else if (item.action === "openSettings") {
        actions.openSettings();
      } else if (item.action === "showWindow") {
        actions.openMainWindow();
      }
    }
  };
}
