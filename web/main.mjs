import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWeb } from "./server.mjs";

try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); }
catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot load the local application environment.'); }
const env = process.env;
const home = homedir();
const userData = env.HOT_CROSS_BUNS_WEB_USER_DATA || env.HOT_CROSS_BUNS_TERMINAL_USER_DATA || env.HOT_CROSS_BUNS_DESKTOP_USER_DATA ||
  (process.platform === "darwin" ? join(home, "Library", "Application Support", "Hot Cross Buns") :
    join(process.platform === "win32" ? env.APPDATA || home : env.XDG_CONFIG_HOME || join(home, ".config"), "Hot Cross Buns"));
const binary = env.HOT_CROSS_BUNS_WEB_BINARY || fileURLToPath(new URL("../runtime/" +
  (process.platform === "win32" ? "hot-cross-buns-runtime.exe" : "hot-cross-buns-runtime"), import.meta.url));
const workspace = resolve(env.HOT_CROSS_BUNS_WEB_WORKSPACE || env.HOT_CROSS_BUNS_TERMINAL_WORKSPACE || env.HOT_CROSS_BUNS_DESKTOP_WORKSPACE || join(userData, "workspace"));
const port = Number(env.HOT_CROSS_BUNS_WEB_PORT ?? 4317);

if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Choose a valid local port.");
const app = await startWeb({ binary, workspace, userData, startScheduler: true, env: { ...env, HOT_CROSS_BUNS_UI_FRONTEND: "web" } }, port);
console.log("Hot Cross Buns · " + app.url);
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  if (stopping) return;
  stopping = true;
  void app.close().catch(error => { console.error(error.message); process.exitCode = 1; });
});
