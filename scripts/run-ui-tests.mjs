import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Always isolate Linux's desktop from a running development app. This also works
// on a headless CI runner and avoids testing against the user's WSLg session.
const cli = fileURLToPath(new URL("../node_modules/@playwright/test/cli.js", import.meta.url));
const args = [cli, "test", "-c", "playwright.config.ts", ...process.argv.slice(2)];
const linux = process.platform === "linux";
const result = spawnSync(linux ? "xvfb-run" : process.execPath, linux ? ["-a", "-s", "-screen 0 1920x1200x24", process.execPath, ...args] : args, { stdio: "inherit", env: process.env });
if (result.error) {
  console.error(linux ? "Unable to start UI tests. Install xvfb (sudo apt install xvfb) and try again." : result.error.message);
}
process.exit(result.status ?? 1);
