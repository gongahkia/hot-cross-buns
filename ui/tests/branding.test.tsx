import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { App } from "../src/app"
import { HotCrossBunsClient } from "../src/hot-cross-buns/client"
import { FixtureHost } from "./fixture"

test("the full product name and connection status fit a narrow terminal", async () => {
  const root = await mkdtemp(join(tmpdir(), "hcb-branding-"))
  const host = new FixtureHost({ binary: "unused", userData: root, workspace: root, env: { HOT_CROSS_BUNS_STATE_DIR: root } })
  host.current.title = "A conversation title that should be truncated"
  const snapshot = host.snapshot.bind(host)
  let connection = "connected"
  host.snapshot = () => ({ ...snapshot(), connection })
  const client = new HotCrossBunsClient(host)
  const setup = await testRender(() => <App client={client} quit={() => client.close()} clipboard={{ read: async () => ({ data: "", mime: "text/plain" }), write: async () => {} }} />, { width: 42, height: 14 })
  try {
    await client.start()
    for (const width of [42, 60, 110]) {
      setup.resize(width, 14)
      for (connection of ["connected", "connecting", "disconnected"]) {
        host.emit("change")
        await setup.flush(); await Bun.sleep(40); await setup.flush()
        const header = setup.captureCharFrame().split("\n").find(line => line.includes("Hot Cross Buns"))
        expect(header).toContain(`Host ${connection}`)
        if (width === 110) expect(header).toContain(host.current.title)
      }
    }
  } finally { await client.close(); await setup.dispose(); await rm(root, { recursive: true, force: true }) }
})
