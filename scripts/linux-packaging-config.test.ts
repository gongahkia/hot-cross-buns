import { createRequire } from "node:module";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface ElectronBuilderConfig {
  appImage?: {
    artifactName?: string;
  };
  linux?: {
    category?: string;
    desktop?: {
      entry?: Record<string, string>;
    };
    executableName?: string;
    icon?: string;
    target?: Array<{ arch?: string[]; target?: string } | string> | string;
  };
  mac?: {
    protocols?: Array<{ schemes?: string[] }>;
    target?: string[];
  };
  nsis?: {
    allowToChangeInstallationDirectory?: boolean;
    artifactName?: string;
    createDesktopShortcut?: boolean;
    createStartMenuShortcut?: boolean;
    oneClick?: boolean;
    perMachine?: boolean;
    shortcutName?: string;
  };
  protocols?: unknown;
  win?: {
    executableName?: string;
    icon?: string;
    protocols?: Array<{ schemes?: string[] }>;
    target?: Array<{ arch?: string[]; target?: string } | string> | string;
  };
}

async function loadBuilderConfig(): Promise<ElectronBuilderConfig> {
  const requireFromBuilder = createRequire(createRequire(import.meta.url).resolve("electron-builder"));
  const { getConfig } = requireFromBuilder("app-builder-lib/out/util/config/load") as {
    getConfig: (request: {
      configFilename: string;
      packageKey: string;
      packageMetadata: null;
      projectDir: string;
    }, configPath: string) => Promise<{ result: ElectronBuilderConfig } | null>;
  };
  const loaded = await getConfig(
    {
      configFilename: "electron-builder",
      packageKey: "build",
      packageMetadata: null,
      projectDir: process.cwd()
    },
    "electron-builder.yml"
  );

  if (!loaded) {
    throw new Error("electron-builder.yml could not be loaded");
  }

  return loaded.result;
}

describe("Linux packaging config", () => {
  it("adds AppImage metadata without removing macOS targets", async () => {
    const config = await loadBuilderConfig();

    expect(config.mac?.target).toEqual(["dmg", "zip"]);
    expect(config.mac?.protocols?.flatMap((protocol) => protocol.schemes ?? [])).toContain("hotcrossbuns");
    expect(config.protocols).toBeUndefined();
    expect(config.linux).toMatchObject({
      category: "Office",
      executableName: "hot-cross-buns-2",
      icon: "build/icons"
    });
    expect(config.linux?.target).toEqual([
      {
        target: "AppImage",
        arch: ["x64"]
      }
    ]);
    expect(config.appImage?.artifactName).toBe("Hot-Cross-Buns-2-${version}-linux-${arch}.${ext}");
    expect(config.linux?.desktop?.entry).toMatchObject({
      GenericName: "Planner",
      Keywords: "tasks;calendar;notes;planner;productivity;",
      StartupWMClass: "hot-cross-buns-2"
    });
  });

  it("provides Linux PNG icons in electron-builder's expected layout", async () => {
    const iconDir = resolve("build/icons");

    for (const size of [16, 24, 32, 48, 64, 96, 128, 256, 512, 1024]) {
      await expect(access(join(iconDir, `${size}x${size}.png`))).resolves.toBeUndefined();
    }
  });

  it("adds Windows NSIS metadata without removing existing platform targets", async () => {
    const config = await loadBuilderConfig();

    expect(config.win).toMatchObject({
      executableName: "Hot Cross Buns 2",
      icon: "build/icon.ico"
    });
    expect(config.win?.target).toEqual([
      {
        target: "nsis",
        arch: ["x64"]
      }
    ]);
    expect(config.win?.protocols?.flatMap((protocol) => protocol.schemes ?? [])).toContain("hotcrossbuns");
    expect(config.nsis).toMatchObject({
      artifactName: "Hot-Cross-Buns-2-${version}-windows-${arch}.${ext}",
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      oneClick: false,
      perMachine: false,
      shortcutName: "Hot Cross Buns 2"
    });
    await expect(access(resolve("build/icon.ico"))).resolves.toBeUndefined();
  });
});
