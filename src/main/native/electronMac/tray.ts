import {
  Menu,
  Tray,
  app,
  nativeImage,
  type MenuItemConstructorOptions,
  type NativeImage
} from "electron";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  NativeMenuBarItem,
  NativeMenuBarSnapshot,
  NativeOperationResult,
  NativeTrayActions
} from "../types";
import {
  calendarCheckMenuBarIconBody,
  calendarMenuBarIconBody,
  menuBarIconSvg
} from "@shared/menuBarIcons";
import { MenuBarPanelController } from "./menuBarPanelController";
import { unsupported } from "./operationResults";

type TrayIconDefinition = { body: string } | "none";

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

  const customIcon = snapshot.customMenuBarIcons.find((icon) => icon.id === snapshot.calendarIconId);
  if (customIcon) {
    return { body: customIcon.svg };
  }

  return {
    body: snapshot.calendarDone ? calendarCheckMenuBarIconBody : calendarMenuBarIconBody
  };
}

function trayIconImage(iconDefinition: TrayIconDefinition): NativeImage {
  if (iconDefinition === "none") {
    return nativeImage.createEmpty();
  }

  const image = nativeImage.createFromDataURL(templateIconDataUrl(iconDefinition.body));
  if (!image.isEmpty()) {
    return image;
  }

  const pathImage = nativeImage.createFromPath(templateIconPath(iconDefinition.body));
  return pathImage.isEmpty() ? nativeImage.createEmpty() : pathImage;
}

function templateIconDataUrl(body: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(templateIconSvg(body)).toString("base64")}`;
}

function templateIconPath(body: string): string {
  const svg = templateIconSvg(body);
  const directory = join(app.getPath("userData"), "menu-bar-icons");
  const filePath = join(directory, `${createHash("sha1").update(svg).digest("hex")}.svg`);
  mkdirSync(directory, { recursive: true });
  writeFileSync(filePath, svg);
  return filePath;
}

function templateIconSvg(body: string): string {
  return menuBarIconSvg(body, "#000");
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
      label: "Open Hot Cross Buns 2",
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
      label: "Open Hot Cross Buns 2",
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
