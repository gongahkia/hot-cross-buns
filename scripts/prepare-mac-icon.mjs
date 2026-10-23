import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

if (process.platform !== "darwin") throw new Error("The macOS preview icon must be prepared on macOS.");
const directory = mkdtempSync(join(tmpdir(), "hcb-icon-"));
try {
  const iconset = join(directory, "App.iconset");
  mkdirSync(iconset);
  const source = resolve("assets/brand/app-icon.png");
  for (const size of [16, 32, 128, 256]) {
    for (const scale of [1, 2]) {
      const pixels = String(size * scale);
      const target = join(iconset, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`);
      execFileSync("sips", ["-z", pixels, pixels, source, "--out", target], { stdio: "ignore" });
    }
  }
  copyFileSync(source, join(iconset, "icon_512x512.png"));
  mkdirSync(resolve("dist/brand"), { recursive: true });
  execFileSync("iconutil", ["--convert", "icns", "--output", resolve("dist/brand/app.icns"), iconset]);
} finally { rmSync(directory, { recursive: true, force: true }); }
