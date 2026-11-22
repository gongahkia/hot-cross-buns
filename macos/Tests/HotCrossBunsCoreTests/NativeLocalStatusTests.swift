import Foundation
import Testing
@testable import HotCrossBunsCore

func localObservationValue(_ resultID: String = "observation") -> JSONValue {
    .object([
        "result_id": .string(resultID), "observed_at": .string("2026-11-21T01:00:00Z"), "runtime_path": .string(""), "discovery": .string("fixture PATH"),
        "reachable": .bool(false), "version": .string(""), "ownership": .string("unknown"), "endpoint": .string("http://127.0.0.1:9"), "issue": .string("Runtime unavailable"),
        "installed_known": .bool(false), "loaded_known": .bool(false), "selected_provider": .string("openai"), "selected_model": .string("future-fixture"),
        "total_memory": .number(17179869184), "available_memory": .null, "available_disk": .null, "hardware_note": .string("Available memory unknown"), "blocked": .string("Destructive lifecycle unavailable"),
        "catalog": .array([.object(["id": .string("qwen3-4b"), "name": .string("Qwen3 4B"), "tag": .string("qwen3:4b"), "digest": .string(""), "size": .null, "downloaded": .null, "loaded": .null, "eligible": .bool(true), "reason": .string(""), "source": .string("https://ollama.com/library/qwen3")])]), "installed": .array([])
    ])
}
@MainActor private final class LocalReplyControl { var wrong = false; var count = 0 }
private func localReply(_ request: NativeProviderRequest, value: JSONValue? = nil, wrongID: Bool = false, error: String = "") throws -> NativeProviderResult {
    try NativeProviderResult(.object(["request_id": .string(wrongID ? "stale" : request.id), "action": .string(request.action.rawValue), "local": value ?? localObservationValue(), "confirmed": .bool(false), "changed": .bool(false), "conflict": .bool(false), "error": .string(error)]))
}

@Test func localProtocolReadOnlyAndExplicitUnknowns() throws {
    #expect(NativeModelsArea.allCases.map(\.rawValue) == ["Local Models", "API-Key Providers"])
    var request = NativeProviderRequest(.local_status)
    request.apiKey = "INERT_NEVER_SERIALIZE"
    let data = try BridgeCommand.host(.provider(request)).data(nonce: "fixture")
    let json = try JSONDecoder().decode(JSONValue.self, from: data)
    #expect(json["native_provider"]["action"].string == "local_status")
    #expect(json["native_provider"]["api_key"] == .null)
    #expect(json["text"] == .null && json["key"] == .null && json["panel"] == .null)
    let status = try #require(try localReply(request).local)
    try status.validate()
    #expect(status.availableMemory == nil && status.availableDisk == nil)
    #expect(status.catalog[0].downloadLabel == "Download state unknown")
    #expect(status.catalog[0].loadedLabel == "Loaded state unknown")
    #expect(status.selectedProvider == "openai" && !status.reachable)
}
@Test @MainActor func localRefreshPreservesProviderFormsAndRejectsStaleIdentities() async throws {
    let setup = NativeProviderSetup()
    let control = LocalReplyControl()
    setup.present { request in
        if request.action == .local_status { control.count += 1; return try localReply(request, wrongID: control.wrong) }
        return try providerReply(request)
    }
    try await waitUntil { !setup.busy && setup.selected != nil }
    setup.forms["openai"]?.model = "Unsent provider form"
    #expect(await setup.prepare(replacing: false))
    let review = setup.review
    await setup.refreshLocal()
    #expect(setup.localStatus?.resultID == "observation")
    #expect(setup.forms["openai"]?.model == "Unsent provider form" && setup.review == review)
    control.wrong = true
    await setup.refreshLocal()
    #expect(!setup.localIssue.isEmpty && setup.localStatus?.resultID == "observation")
    #expect(control.count == 2)
    setup.dismiss()
    #expect(setup.localStatus == nil && !setup.isPresented)
}
@MainActor private final class LocalRefreshGate {
    var continuation: CheckedContinuation<NativeProviderResult, any Error>?
    var request: NativeProviderRequest?
}
@Test @MainActor func localDismissalCancelsPublicationAndRepeatedRefreshIsBounded() async throws {
    let setup = NativeProviderSetup(), gate = LocalRefreshGate()
    setup.present { request in
        if request.action != .local_status { return try providerReply(request) }
        gate.request = request
        return try await withCheckedThrowingContinuation { gate.continuation = $0 }
    }
    try await waitUntil { !setup.busy && setup.selected != nil }
    let refresh = Task { await setup.refreshLocal() }
    try await waitUntil { gate.request != nil }
    let first = gate.request?.id
    await setup.refreshLocal()
    #expect(gate.request?.id == first)
    setup.dismiss()
    gate.continuation?.resume(returning: try localReply(#require(gate.request)))
    await refresh.value
    #expect(!setup.busy && setup.localStatus == nil && setup.localIssue.isEmpty)
}
@Test func localMalformedObservationRejected() throws {
    guard case .object(var fields) = localObservationValue() else { throw BridgeFailure("fixture object missing") }
    fields["result_id"] = .string("")
    let bad = try JSONDecoder().decode(NativeLocalStatus.self, from: JSONEncoder().encode(JSONValue.object(fields)))
    #expect(throws: BridgeFailure.self) { try bad.validate() }
}
