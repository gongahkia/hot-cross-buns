import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

if (process.platform !== "darwin") throw new Error("The macOS preview icon must be prepared on macOS.");
const directory = mkdtempSync(join(tmpdir(), "hcb-icon-"));
try {
  const iconset = join(directory, "App.iconset");
  mkdirSync(iconset);
  // Preserve the original 64px artwork exactly in a native ICNS container.
  copyFileSync(resolve("assets/logo/logo.png"), join(iconset, "icon_32x32@2x.png"));
  mkdirSync(resolve("dist/brand"), { recursive: true });
  execFileSync("iconutil", ["--convert", "icns", "--output", resolve("dist/brand/app.icns"), iconset]);
} finally { rmSync(directory, { recursive: true, force: true }); }
