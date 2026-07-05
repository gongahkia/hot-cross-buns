import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { build } from "vite";
import packageJson from "../package.json";

const root = resolve(__dirname, "..");
const sourceRoot = resolve(root, "src/browser-extension");
const distRoot = resolve(root, "dist/browser-extension");
const sharedOut = resolve(distRoot, "_shared");
const chromeOut = resolve(distRoot, "chrome");
const firefoxOut = resolve(distRoot, "firefox");
const iconSource = resolve(root, "assets/brand/buns-app-icon.png");

async function main(): Promise<void> {
  rmSync(distRoot, { recursive: true, force: true });

  await build({
    configFile: false,
    root: sourceRoot,
    plugins: [react()],
    build: {
      outDir: sharedOut,
      emptyOutDir: true,
      sourcemap: false,
      rollupOptions: {
        input: {
          sidebar: resolve(sourceRoot, "sidebar.html"),
          options: resolve(sourceRoot, "options.html")
        },
        output: {
          assetFileNames: "assets/[name]-[hash][extname]",
          chunkFileNames: "assets/[name]-[hash].js",
          entryFileNames: "assets/[name]-[hash].js"
        }
      }
    }
  });

  await build({
    configFile: false,
    build: {
      outDir: sharedOut,
      emptyOutDir: false,
      sourcemap: false,
      lib: {
        entry: resolve(sourceRoot, "background.ts"),
        name: "HcbBrowserExtensionBackground",
        formats: ["iife"],
        fileName: () => "background.js"
      }
    }
  });

  for (const target of [chromeOut, firefoxOut]) {
    cpSync(sharedOut, target, { recursive: true });
    mkdirSync(resolve(target, "icons"), { recursive: true });
    cpSync(iconSource, resolve(target, "icons/icon-128.png"));
  }

  writeJson(resolve(chromeOut, "manifest.json"), chromeManifest());
  writeJson(resolve(firefoxOut, "manifest.json"), firefoxManifest());
  console.log(`browser extension builds written to ${chromeOut} and ${firefoxOut}`);
}

function chromeManifest(): Record<string, unknown> {
  return {
    manifest_version: 3,
    name: "Hot Cross Buns",
    short_name: "HCB",
    version: packageJson.version,
    description: "Read-only sidebar search for Google Tasks and Calendar.",
    icons: {
      128: "icons/icon-128.png"
    },
    action: {
      default_title: "Hot Cross Buns"
    },
    side_panel: {
      default_path: "sidebar.html"
    },
    background: {
      service_worker: "background.js"
    },
    options_page: "options.html",
    permissions: ["identity", "storage", "sidePanel"],
    host_permissions: googleHostPermissions()
  };
}

function firefoxManifest(): Record<string, unknown> {
  return {
    manifest_version: 3,
    name: "Hot Cross Buns",
    short_name: "HCB",
    version: packageJson.version,
    description: "Read-only sidebar search for Google Tasks and Calendar.",
    icons: {
      128: "icons/icon-128.png"
    },
    action: {
      default_title: "Hot Cross Buns"
    },
    sidebar_action: {
      default_title: "Hot Cross Buns",
      default_panel: "sidebar.html"
    },
    background: {
      scripts: ["background.js"]
    },
    options_ui: {
      page: "options.html",
      open_in_tab: true
    },
    permissions: ["identity", "storage"],
    host_permissions: googleHostPermissions(),
    browser_specific_settings: {
      gecko: {
        id: "hot-cross-buns@gongahkia.dev",
        strict_min_version: "127.0"
      }
    }
  };
}

function googleHostPermissions(): string[] {
  return [
    "https://accounts.google.com/*",
    "https://oauth2.googleapis.com/*",
    "https://openidconnect.googleapis.com/*",
    "https://tasks.googleapis.com/*",
    "https://www.googleapis.com/*"
  ];
}

function writeJson(path: string, value: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
