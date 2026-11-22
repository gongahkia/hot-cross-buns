#!/usr/bin/env bun
import { existsSync, realpathSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

const directory = dirname(realpathSync(process.argv[1]))
const base = resolve(directory, "..")
const installed = existsSync(join(base, "ui", "dist", "index.js"))
const frontend = installed ? join(base, "ui", "dist", "index.js") : join(base, "dist", "index.js")
const runtime = process.env.HOT_CROSS_BUNS_TERMINAL_BINARY || join(base, installed ? "runtime" : "runtime", process.platform === "win32" ? "hot-cross-buns-runtime.exe" : "hot-cross-buns-runtime")
const args = process.argv.slice(2)
if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
  console.log(`Hot Cross Buns terminal application

hot-cross-buns                         Open the terminal workspace
hot-cross-buns resume <chat-id>         Reopen a retained conversation
hot-cross-buns --version               Show build information
hot-cross-buns work "task"              Run a scripted task
hot-cross-buns work-rpc                JSON-lines automation
hot-cross-buns config|provider|agent|job|goal|memory|note|data|usage|doctor ...
                              Retained Hot Cross Buns command families
hot-cross-buns update                  Explain manual updates

Interactive: Ctrl+P commands, /following, /saved, /settings, /files.
Requires Bun 1.4.2 or newer. Native helpers are described in TERMINAL.md.`)
} else if (args.length === 1 && ["update", "-u"].includes(args[0])) {
  console.log("This terminal distribution uses explicit manual updates. Finish work, save drafts and stop background checks through Recovery before replacing the installation. Existing profiles are retained. Releases: https://github.com/gongahkia/hot-cross-buns/releases")
} else if (!existsSync(runtime)) {
  console.error("Hot Cross Buns: the bundled Go runtime is missing. In a checkout, run make terminal-build.")
  process.exitCode = 1
} else if (args.length && args[0] !== "resume" && args[0] !== "--goal") {
  if (["ui-backend", "desktop-speech", "desktop-update-guard"].includes(args[0])) throw new Error("This is a private application service.")
  const result = spawnSync(runtime, args, { stdio: args.length === 1 && ["--version", "-v"].includes(args[0]) ? ["inherit", "pipe", "inherit"] : "inherit", env: { ...process.env, HOT_CROSS_BUNS_UI_FRONTEND: "terminal" }, windowsHide: false })
  if (result.stdout) process.stdout.write(result.stdout.toString().replace(/^hot-cross-buns /, "hot-cross-buns terminal "))
  if (result.error) console.error("Hot Cross Buns:", result.error.message)
  process.exitCode = result.status ?? 1
} else {
  if (!process.stdin.isTTY || !process.stdout.isTTY) { console.error("Hot Cross Buns: interactive mode needs a terminal. Use --help or work-rpc for scripts."); process.exitCode = 1 }
  else { process.env.HOT_CROSS_BUNS_TERMINAL_LAUNCHER = realpathSync(process.argv[1]); process.env.HOT_CROSS_BUNS_TERMINAL_BINARY = runtime; await import(join(dirname(frontend), "../node_modules/@opentui/solid/scripts/preload.js")); await import(frontend) }
}
