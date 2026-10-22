import { Menu } from "electron";

/**
 * Removes Electron's built-in File/Edit/View menu on platforms where HCB does
 * not provide a native app menu. Without this call, Electron renders its
 * default menu even when a platform adapter reports app menus as unsupported.
 */
export function clearDefaultApplicationMenu(): void {
  Menu.setApplicationMenu(null);
}
