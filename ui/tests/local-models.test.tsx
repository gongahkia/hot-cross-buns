import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { Application } from "@hot-cross-buns/application-host/application"
import { App } from "../src/app"
import { HotCrossBunsClient } from "../src/hot-cross-buns/client"

test("local model keyboard reviews download cancellation selection rename and refuses unsafe removal", async () => {
  const root = await mkdtemp(join(tmpdir(), "hot-cross-buns-terminal-local-model-")), config = join(root, "config/hot-cross-buns/config.json"), modelID = "qwen2.5-coder:0.5b"
  let installed = false, pulls = 0, cancelled = 0, removed = 0, calls = 0
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname
    if (path === "/api/version") return Response.json({ version: "terminal-fixture" })
    if (path === "/api/tags") return Response.json({ models: installed ? [{ name: modelID, size: 398000000 }] : [] })
    if (path === "/api/pull") {
      const body = await request.json() as { model: string }; expect(body.model).toBe(modelID); pulls++
      const first = pulls === 1
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode('{"status":"pulling layers","completed":5,"total":10}\n'))
        if (!first) { installed = true; controller.enqueue(new TextEncoder().encode('{"status":"success"}\n')); controller.close() }
      }, cancel() { cancelled++ } }), { headers: { "content-type": "application/x-ndjson" } })
    }
    if (path === "/api/delete") { expect(request.method).toBe("DELETE"); expect((await request.json() as { model: string }).model).toBe(modelID); removed++; installed = false; return Response.json({}) }
    if (path === "/v1/chat/completions") { expect((await request.json() as { model: string }).model).toBe(modelID); calls++; return Response.json({ choices: [{ message: { role: "assistant", content: "Local model response." }, finish_reason: "stop" }] }) }
    return new Response("Unknown fixture route", { status: 404 })
  } })
  await mkdir(join(root, "config/hot-cross-buns"), { recursive: true }); await writeFile(config, JSON.stringify({ version: 4, defaults: {}, custom_providers: [{ id: "hot-cross-buns-local", base_url: `http://127.0.0.1:${server.port}/v1/chat/completions`, models: [modelID], default_model: modelID }] }))
  const client = new HotCrossBunsClient(new Application({ binary: process.env.HOT_CROSS_BUNS_TEST_BINARY || resolve(import.meta.dir, "../runtime/" + (process.platform === "win32" ? "hot-cross-buns-runtime.exe" : "hot-cross-buns-runtime")), workspace: join(root, "workspace"), userData: join(root, "app"), env: { ...process.env, HOT_CROSS_BUNS_STATE_DIR: join(root, "state"), HOT_CROSS_BUNS_CONFIG_DIR: join(root, "config") } }))
  const setup = await testRender(() => <App client={client} quit={() => client.close()} clipboard={{ read: async () => ({ data: "", mime: "text/plain" }), write: async () => {} }} />, { width: 120, height: 38 })
  const flush = async () => { await setup.flush(); await Bun.sleep(30); await setup.flush() }
  const until = async (predicate: () => boolean | Promise<boolean>, label: string) => { const end = Date.now() + 15000; while (!await predicate()) { if (Date.now() > end) throw new Error(label + ": " + JSON.stringify(client.state?.panel)); await flush() } }
  const select = async (text: string) => {
    await until(() => !!client.state?.panel?.rows?.some(row => row.label === text), "available " + text); await flush()
    setup.mockInput.pressKey("f", { ctrl: true }); await flush(); setup.mockInput.pressKey("u", { ctrl: true }); await setup.mockInput.typeText(text); setup.mockInput.pressEnter(); await flush()
    await until(() => client.state?.panel?.rows?.[client.state.panel.selected ?? 0]?.label === text, "selected " + text)
  }
  const review = async (key: string, title: string) => { setup.mockInput.pressKey(key); await until(() => client.state?.panel?.title === title, title); await flush() }
  try {
    await client.start(); await client.edit("Keep local setup draft"); await client.navigate("/model"); await select("Local model"); setup.mockInput.pressEnter()
    await until(() => client.state?.panel?.title === "Local models" && !!client.state.panel.subtitle?.includes("terminal-fixture"), "local runtime")
    const name = "Qwen2.5-Coder 0.5B"; await select(name); expect(calls).toBe(0)
    await review("p", "Confirm download"); expect(pulls).toBe(0)
    setup.mockInput.pressEscape(); await Bun.sleep(80); await until(() => client.state?.panel?.title === "Local models", "cancel download review"); await flush(); expect(pulls).toBe(0)
    await review("p", "Confirm download"); setup.mockInput.pressEnter(); await until(() => pulls === 1 && !!client.state?.panel?.notice?.includes("pulling layers"), "visible download progress")
    await flush(); setup.mockInput.pressEscape(); await Bun.sleep(80); await until(() => cancelled === 1, "cancel network download"); expect(installed).toBe(false)
    await until(() => client.state?.panel?.title === "Local models", "cancelled catalog"); await flush()
    await review("p", "Confirm download"); setup.mockInput.pressEnter(); await until(() => installed && !!client.state?.panel?.rows?.find(row => row.label === name)?.detail?.startsWith("installed"), "installed catalog")
    await select(name); setup.mockInput.pressKey("e"); await until(() => client.state?.panel?.title === "Rename model", "rename")
    await flush(); setup.mockInput.pressEnter(); await flush(); setup.mockInput.pressKey("u", { ctrl: true }); await setup.mockInput.typeText("Tiny local fixture"); setup.mockInput.pressEnter(); await flush(); setup.mockInput.pressKey("r", { ctrl: true })
    await until(() => !!client.state?.panel?.rows?.some(row => row.label === "Tiny local fixture"), "alias")
    await select("Tiny local fixture"); setup.mockInput.pressEnter(); await flush(); await until(() => !!client.state?.panel?.notice?.includes("Local model selected") && !client.state?.pending_operation, "model selection saved"); await client.navigate("/chat"); await until(() => !client.state?.panel && client.state?.model === modelID, "return to chat after model selection")
    expect(client.draft.text).toBe("Keep local setup draft"); expect(calls).toBe(0)
    await client.send({ type: "submit", text: "/mode inspect" }); await client.submit(); await until(() => calls === 1 && !client.state?.running, "local model task")
    await client.navigate("/model"); await select("Local model"); setup.mockInput.pressEnter(); await select("Tiny local fixture")
    const beforeRemoval = await readFile(config, "utf8")
    await review("x", "Confirm removal"); expect(removed).toBe(0); setup.mockInput.pressEnter()
    await until(() => !!client.state?.panel?.notice?.includes("model removal not admitted"), "blocked removal explained")
    expect(client.state?.panel?.notice).toContain("no delete request was sent")
    expect(removed).toBe(0); expect(installed).toBe(true)
    expect(await readFile(config, "utf8")).toBe(beforeRemoval)
    expect(calls).toBe(1)
  } finally { await client.close(); await setup.dispose(); server.stop(true); await rm(root, { recursive: true, force: true }) }
}, 60000)
