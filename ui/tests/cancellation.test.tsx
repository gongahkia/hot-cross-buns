import { test, expect } from "bun:test"
import { testRender } from "@opentui/solid"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { execFileSync } from "node:child_process"
import { Application } from "@hot-cross-buns/application-host/application"
import { HotCrossBunsClient } from "../src/hot-cross-buns/client"
import { App } from "../src/app"

async function until(predicate: () => boolean, label = "state", timeout = 15000) {
  const end = Date.now() + timeout
  while (!predicate()) { if (Date.now() > end) throw new Error(`Timed out waiting for ${label}`); await Bun.sleep(20) }
}
test("Ctrl+C stops a real active request through the allowed Go key and keeps the draft connected", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hot-cross-buns-terminal-stop-"))
  const binary = process.env.HOT_CROSS_BUNS_TEST_BINARY || resolve(import.meta.dir, "../runtime/" + (process.platform === "win32" ? "hot-cross-buns-runtime.exe" : "hot-cross-buns-runtime"))
  const env = { ...process.env, HOT_CROSS_BUNS_STATE_DIR: join(directory, "state"), HOT_CROSS_BUNS_CONFIG_DIR: join(directory, "config") }
  let release!: () => void, calls = 0; const gate = new Promise<void>(resolve => { release = resolve })
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) { await request.json(); calls++; await gate; return Response.json({ choices: [{ message: { role: "assistant", content: "Should be cancelled" }, finish_reason: "stop" }] }) } })
  const cli = (args: string[]) => execFileSync(binary, args, { env: { ...env, HOT_CROSS_BUNS_INTERNAL_COMMANDS: "1" } })
  cli(["provider", "add", "stop-fixture", "--base-url", `http://127.0.0.1:${server.port}/v1/chat/completions`, "--model", "fixture"]); cli(["config", "set", "default-provider", "stop-fixture"])
  const client = new HotCrossBunsClient(new Application({ binary, env, workspace: join(directory, "workspace"), userData: join(directory, "app") }))
  const setup = await testRender(() => <App client={client} quit={() => client.close()} clipboard={{ read: async () => ({ data: "", mime: "text/plain" }), write: async () => {} }} />, { width: 110, height: 32 })
  try {
    await client.start(); await client.send({ type: "submit", text: "/mode inspect" }); await client.edit("Long request"); await client.submit(); await until(() => calls === 1, "active request")
    await client.edit("Keep while stopping"); await setup.flush(); setup.mockInput.pressKey("c", { ctrl: true })
    await until(() => !client.state?.running, "stopped work")
    expect(client.draft.text).toBe("Keep while stopping"); expect(client.snapshot.connection).toBe("connected"); expect(client.issue).toBe(""); expect(calls).toBe(1)
  } finally { release(); await client.close(); await setup.dispose(); server.stop(true); await rm(directory, { recursive: true, force: true }) }
}, 30000)
