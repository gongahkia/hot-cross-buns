import Foundation
import Testing
@testable import GatorCore

@Test @MainActor func localSelectionActualGoReviewSelectRestartAndReconcileWithoutInference() async throws {
    let fixture = try CatalogIntegrationFixture.prepare(count:2)
    defer { try? FileManager.default.removeItem(at:fixture.root) }
    let server = Process(), pipe = Pipe()
    server.executableURL = URL(fileURLWithPath:"/usr/bin/env")
    server.arguments = ["node",try #require(Bundle.module.url(forResource:"local-selection-provider",withExtension:"mjs",subdirectory:"Fixtures")).path,fixture.root.path]
    server.environment = ["PATH":ProcessInfo.processInfo.environment["PATH"] ?? "/usr/bin:/bin"]
    server.standardOutput=pipe;server.standardError=FileHandle.standardError
    try server.run();defer { if server.isRunning {server.terminate();server.waitUntilExit()} }
    var line=Data()
    while !line.contains(10) {let data=pipe.fileHandleForReading.availableData;guard !data.isEmpty else {throw BridgeFailure("selection fixture did not start")};line.append(data)}
    let endpoint=String(decoding:line,as:UTF8.self).trimmingCharacters(in:.whitespacesAndNewlines)
    let path=fixture.root.appendingPathComponent("config/gator/config.json")
    var settings=try #require(try JSONSerialization.jsonObject(with:Data(contentsOf:path)) as? [String:Any])
    var providers=settings["custom_providers"] as? [[String:Any]] ?? []
    providers.append(["id":"gator-local","base_url":endpoint+"/v1/chat/completions","models":["qwen3:4b"],"default_model":"qwen3:4b"])
    settings["custom_providers"]=providers
    try JSONSerialization.data(withJSONObject:settings,options:[.sortedKeys]).write(to:path)
    let originalSettings=try Data(contentsOf:path)
    let app=fixture.application();await app.start()
    let owner=app.current, generation=owner.generation
    owner.editDraft("Local selection keeps this unsent draft");#expect(await owner.flushDrafts())
    app.showProviders();try await managedEventually("API peer ready") { !app.providers.busy && !app.providers.rows.isEmpty }
    #expect(app.providers.rows.count==38)
    await app.providers.refreshLocal()
    #expect(await app.providers.prepareLocalSelection("qwen3-4b"))
    #expect(app.providers.localReview?.digest==String(repeating:"a",count:64))
    #expect(try Data(contentsOf:path)==originalSettings)
    await app.providers.cancelLocalSelection()
    #expect(try Data(contentsOf:path)==originalSettings)
    #expect(await app.providers.prepareLocalSelection("qwen3-4b"))
    #expect(await app.providers.confirmLocalSelection())
    #expect(app.providers.futureSelection?.provider=="gator-local")
    #expect(app.providers.localReceipt?.phase=="published")
    let operation=try #require(app.providers.localReceipt?.id)
    #expect(app.current===owner && app.ownerCount==1 && owner.generation==generation)
    #expect(owner.draftText=="Local selection keeps this unsent draft")
    let persisted=try JSONDecoder().decode(JSONValue.self,from:Data(contentsOf:path))
    #expect(persisted["defaults"]["provider"].string=="gator-local")
    let local=try #require(persisted["custom_providers"].array.first { $0["id"].string=="gator-local" })
    #expect(local["model_digests"]["qwen3:4b"].string==String(repeating:"a",count:64))
    app.providers.dismiss();#expect(await app.shutdown(confirmed:true))
    let reopened=fixture.application();await reopened.start()
    reopened.showProviders();try await managedEventually("reopened peer ready") { !reopened.providers.busy && !reopened.providers.rows.isEmpty }
    await reopened.providers.refreshLocal()
    #expect(reopened.providers.localReceipt?.id==operation)
    #expect(reopened.current.draftText=="Local selection keeps this unsent draft")
    let beforeReconcile=try Data(contentsOf:path)
    await reopened.providers.reconcileLocalSelection()
    #expect(reopened.providers.localReceipt?.phase=="reconciled")
    #expect(try Data(contentsOf:path)==beforeReconcile)
    let events=try JSONDecoder().decode(JSONValue.self,from:Data(contentsOf:fixture.root.appendingPathComponent("requests.json"))).array
    #expect(!events.isEmpty && events.allSatisfy { $0["method"].string=="GET" && ["/api/version","/api/tags","/api/ps"].contains($0["path"].string) })
    #expect(!FileManager.default.fileExists(atPath:fixture.root.appendingPathComponent("state/gator/auth.json").path))
    if let output=ProcessInfo.processInfo.environment["GATOR_L2B_INTEGRATION_EVIDENCE"] {
        let target=URL(fileURLWithPath:output);try FileManager.default.createDirectory(at:target,withIntermediateDirectories:true)
        try JSONEncoder().encode(JSONValue.array(events)).write(to:target.appendingPathComponent("real-go-requests.json"))
        try JSONEncoder().encode(reopened.current.snapshot?.value["native_provider_result"] ?? .null).write(to:target.appendingPathComponent("real-go-final-result.json"))
    }
    reopened.providers.dismiss();#expect(await reopened.shutdown(confirmed:true))
}
