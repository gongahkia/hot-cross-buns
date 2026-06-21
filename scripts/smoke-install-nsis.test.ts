import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findUninstaller,
  installedExecutablePath,
  installedAppProcessIdsPowerShell,
  nsisSilentInstallArgs,
  shortcutMetadataPowerShell,
  stopInstalledAppProcessesPowerShell,
  windowsShortcutPaths
} from "./smoke-install-nsis";

describe("Windows NSIS install smoke helpers", () => {
  it("builds silent install args with the target directory last", () => {
    expect(nsisSilentInstallArgs("C:\\hcb\\app")).toEqual([
      "/S",
      "/D=C:\\hcb\\app"
    ]);
  });

  it("resolves the installed executable path", () => {
    expect(basename(installedExecutablePath("C:\\hcb\\app"))).toBe("Hot Cross Buns.exe");
  });

  it("finds the NSIS uninstaller in an install directory", async () => {
    const installDir = await mkdtemp(join(tmpdir(), "hcb-nsis-uninstaller-"));
    await mkdir(join(installDir, "resources"), { recursive: true });
    await writeFile(join(installDir, "Hot Cross Buns.exe"), "");
    await writeFile(join(installDir, "Uninstall Hot Cross Buns.exe"), "");

    await expect(findUninstaller(installDir)).resolves.toBe(join(installDir, "Uninstall Hot Cross Buns.exe"));
  });

  it("resolves current-user Start Menu and Desktop shortcut paths", () => {
    expect(windowsShortcutPaths({
      APPDATA: "C:\\Users\\runneradmin\\AppData\\Roaming",
      USERPROFILE: "C:\\Users\\runneradmin"
    })).toEqual([
      "C:\\Users\\runneradmin\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Hot Cross Buns.lnk",
      "C:\\Users\\runneradmin\\Desktop\\Hot Cross Buns.lnk"
    ]);
  });

  it("escapes shortcut paths in PowerShell metadata reads", () => {
    expect(shortcutMetadataPowerShell("C:\\Users\\O'Hara\\Desktop\\Hot Cross Buns.lnk")).toContain(
      "$shortcut = $shell.CreateShortcut('C:\\Users\\O''Hara\\Desktop\\Hot Cross Buns.lnk')"
    );
  });

  it("escapes installed app paths in PowerShell process cleanup", () => {
    const appExe = "C:\\Users\\O'Hara\\App\\Hot Cross Buns.exe";

    expect(installedAppProcessIdsPowerShell(appExe)).toContain("$target = 'C:\\Users\\O''Hara\\App\\Hot Cross Buns.exe'");
    expect(installedAppProcessIdsPowerShell(appExe)).toContain("$_.CommandLine -like '*--disable-gpu*'");
    expect(stopInstalledAppProcessesPowerShell(appExe)).toContain("Stop-Process -Id $processIds -Force");
  });
});
