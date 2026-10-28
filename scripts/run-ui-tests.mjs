import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../node_modules/@playwright/test/cli.js", import.meta.url));
const result = spawnSync(process.execPath, [cli, "test", "-c", "playwright.config.ts", ...process.argv.slice(2)], { stdio: "inherit", env: process.env });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
