import Foundation
import Testing
@testable import HotCrossBunsCore

@Test @MainActor func localActualGoReadOnlyStatusKeepsDraftProviderAndOwner() async throws {
    let fixture = try CatalogIntegrationFixture.prepare(count: 2)
    defer { try? FileManager.default.removeItem(at: fixture.root) }
    let server = Process(), pipe = Pipe(), log = fixture.root.appendingPathComponent("local-get-events.json")
    server.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    server.arguments = ["node", try #require(Bundle.module.url(forResource: "local-inspection-provider", withExtension: "mjs", subdirectory: "Fixtures")).path, log.path]
    server.environment = ["PATH": ProcessInfo.processInfo.environment["PATH"] ?? "/usr/bin:/bin"]
    server.standardOutput = pipe; server.standardError = FileHandle.standardError
    try server.run()
    defer { if server.isRunning { server.terminate(); server.waitUntilExit() } }
    var line = Data()
    while !line.contains(10) { let data = pipe.fileHandleForReading.availableData; guard !data.isEmpty else { throw BridgeFailure("Local fixture did not start") }; line.append(data) }
    let endpoint = String(decoding: line, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    let path = fixture.root.appendingPathComponent("config/hot-cross-buns/config.json")
    var settings = try #require(try JSONSerialization.jsonObject(with: Data(contentsOf: path)) as? [String: Any])
    var providers = settings["custom_providers"] as? [[String: Any]] ?? []
    providers.append(["id": "hot-cross-buns-local", "base_url": endpoint + "/v1/chat/completions", "models": ["qwen3:4b"], "default_model": "qwen3:4b"])
    settings["custom_providers"] = providers
    try JSONSerialization.data(withJSONObject: settings, options: [.sortedKeys]).write(to: path)
    let before = try Data(contentsOf: path)
    let app = fixture.application()
    await app.start()
    let original = app.current, generation = original.generation
    original.editDraft("Local inspection preserves this draft")
    #expect(await original.flushDrafts())
    app.showProviders()
    try await managedEventually("provider peer readiness") { !app.providers.busy && !app.providers.rows.isEmpty }
    await app.providers.refreshLocal()
    let status = try #require(app.providers.localStatus)
    #expect(status.reachable && status.version == "l2a-fixture")
    #expect(status.installedKnown && status.loadedKnown)
    #expect(status.installed.first?.downloaded == true && status.installed.first?.loaded == false)
    #expect(status.installed.first?.digest == "sha256:inert-fixture")
    #expect(status.selectedProvider == "fixture")
    #expect(app.providers.rows.count == 38 && app.providers.rows.contains { $0.id == "openai" })
    #expect(app.ownerCount == 1 && app.current === original && original.generation == generation)
    #expect(original.draftText == "Local inspection preserves this draft")
    #expect(try Data(contentsOf: path) == before)
    let events = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: log)).array
    #expect(events.count == 3 && events.allSatisfy { $0["method"].string == "GET" })
    #expect(events.map { $0["path"].string } == ["/api/version", "/api/tags", "/api/ps"])
    app.providers.dismiss()
    #expect(await app.shutdown(confirmed: true))
}
