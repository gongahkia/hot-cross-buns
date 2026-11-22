import Foundation
import Testing
@testable import GatorCore

private let selectionDigest = String(repeating: "a", count: 64)
private func selectionStatusValue() throws -> JSONValue {
    guard case .object(var value) = localObservationValue() else { throw BridgeFailure("missing status fixture") }
    value["reachable"] = .bool(true)
    value["catalog"] = .array([.object(["id":.string("qwen3-4b"),"name":.string("Qwen3 4B"),"tag":.string("qwen3:4b"),"digest":.string(selectionDigest),"reason":.string(""),"source":.string("https://ollama.com/library/qwen3"),"eligible":.bool(true),"downloaded":.bool(true),"loaded":.bool(false),"size":.number(2500000000)])])
    return .object(value)
}
private func selectionReviewValue(_ id: String = "review-local") -> JSONValue {
    .object(["id":.string(id),"generation":.string("backend-generation"),"model_id":.string("qwen3-4b"),"tag":.string("qwen3:4b"),"digest":.string(selectionDigest),"endpoint":.string("http://127.0.0.1:9"),"settings_revision":.string(String(repeating:"b",count:64)),"notice":.string("Future requests only; no inference")])
}
private func selectionReceiptValue(_ phase: String = "published") -> JSONValue {
    .object(["version":.number(1),"id":.string("operation"),"request_id":.string("select-request"),"profile_id":.string("profile"),"generation":.string("backend-generation"),"endpoint":.string("http://127.0.0.1:9"),"model_id":.string("qwen3-4b"),"tag":.string("qwen3:4b"),"digest":.string(selectionDigest),"settings_revision":.string(String(repeating:"b",count:64)),"phase":.string(phase),"created_at":.string("2026-11-21T01:00:00Z"),"updated_at":.string("2026-11-21T01:00:01Z")])
}
@MainActor private final class SelectionControl {
    var requests: [NativeProviderRequest] = []
    var saved = false
    var error = ""
    var confirmation = true
    var continuation: CheckedContinuation<Void, Never>?
    var hold = false
    func reply(_ request: NativeProviderRequest) async throws -> NativeProviderResult {
        requests.append(request)
        if request.action == .local_select, hold { await withCheckedContinuation { continuation = $0 } }
        if request.action == .local_select, confirmation, error.isEmpty { saved = true }
        var value: [String:JSONValue] = ["request_id":.string(request.id),"action":.string(request.action.rawValue),"confirmed":.bool(request.action == .local_select && confirmation),"changed":.bool(request.action == .local_select && confirmation),"error":.string(error),"conflict":.bool(false),"future_selection":.object(["provider":.string(saved ? "gator-local" : "openai"),"model":.string(saved ? "qwen3:4b" : "fixture-cloud")])]
        switch request.action {
        case .local_status: value["local"] = try selectionStatusValue()
        case .local_review_select: value["local_review"] = selectionReviewValue()
        case .local_select: value["local_receipt"] = selectionReceiptValue(confirmation ? "published" : "prepared")
        case .local_reconcile: value["local_receipt"] = selectionReceiptValue("reconciled")
        default: break
        }
        return try NativeProviderResult(.object(value))
    }
}
@MainActor private func localSelectionSetup(_ control: SelectionControl) async throws -> NativeProviderSetup {
    let setup = NativeProviderSetup(); setup.present { try await control.reply($0) }
    await setup.refreshLocal()
    try await waitUntil { !setup.busy && setup.localStatus != nil }
    return setup
}
@Test @MainActor func localSelectionReviewedProtocolAndAPIParity() async throws {
    let control = SelectionControl(), setup = try await localSelectionSetup(control)
    #expect(setup.futureSelectionLabel.contains("openai"))
    #expect(await setup.prepareLocalSelection("qwen3-4b"))
    #expect(setup.localReview?.tag == "qwen3:4b" && !control.saved)
    #expect(await setup.confirmLocalSelection())
    #expect(control.saved && setup.futureSelectionLabel.contains("gator-local"))
    #expect(setup.localReceipt?.phase == "published" && setup.localReview == nil)
    let request = try #require(control.requests.first { $0.action == .local_select })
    #expect(request.reviewID == "review-local" && request.generation == "backend-generation" && request.modelID == "qwen3-4b")
    let data = try BridgeCommand.host(.provider(request)).data(nonce:"fixture")
    let json = try JSONDecoder().decode(JSONValue.self, from:data)
    #expect(json["native_provider"]["generation"].string == "backend-generation")
    #expect(json["native_provider"]["api_key"] == .null && json["text"] == .null && json["approval_token"] == .null)
    #expect(!setup.isFutureProvider(try JSONDecoder().decode(NativeProviderRow.self, from: JSONEncoder().encode(providerRowValue()))))
    await setup.reconcileLocalSelection()
    #expect(setup.localReceipt?.phase == "reconciled")
}
@Test @MainActor func localSelectionCancelAndUnconfirmedAckNeverClaimSuccess() async throws {
    let control = SelectionControl(), setup = try await localSelectionSetup(control)
    #expect(await setup.prepareLocalSelection("qwen3-4b"))
    await setup.cancelLocalSelection()
    #expect(setup.localReview == nil && !control.saved)
    #expect(!control.requests.contains { $0.action == .local_select })
    #expect(await setup.prepareLocalSelection("qwen3-4b"))
    control.confirmation = false
    #expect(!(await setup.confirmLocalSelection()))
    #expect(!setup.localIssue.isEmpty && setup.localReceipt?.needsReconciliation == true)
    #expect(!control.saved && setup.localReview == nil)
    #expect(!(await setup.confirmLocalSelection()))
}
@Test @MainActor func localSelectionDismissalRejectsLatePublicationAndNoDuplicateRequest() async throws {
    let control = SelectionControl(), setup = try await localSelectionSetup(control)
    #expect(await setup.prepareLocalSelection("qwen3-4b"))
    control.hold = true
    let selecting = Task { await setup.confirmLocalSelection() }
    try await waitUntil { control.continuation != nil }
    #expect(!(await setup.confirmLocalSelection()))
    setup.dismiss()
    control.continuation?.resume(); control.continuation = nil
    #expect(!(await selecting.value))
    #expect(setup.localReview == nil && setup.localStatus == nil)
    #expect(control.requests.filter { $0.action == .local_select }.count == 1)
    #expect(setup.futureSelection?.provider == "openai")
}
@Test func localSelectionDigestAndUnknownOutcomePresentation() throws {
    #expect(normalizedLocalModelDigest("sha256:" + selectionDigest) == selectionDigest)
    #expect(normalizedLocalModelDigest("unknown") == nil)
    for phase in ["prepared","uncertain","published","reconciled","failed"] {
        let receipt = try JSONDecoder().decode(NativeLocalSelectionReceipt.self, from: JSONEncoder().encode(selectionReceiptValue(phase)))
        try receipt.validate()
        #expect(receipt.needsReconciliation == (phase == "prepared" || phase == "uncertain"))
        #expect(!receipt.summary.isEmpty)
    }
    var review = try JSONDecoder().decode(NativeLocalSelectionReview.self, from: JSONEncoder().encode(selectionReviewValue()))
    try review.validate()
    review = try JSONDecoder().decode(NativeLocalSelectionReview.self, from: JSONEncoder().encode(selectionReviewValue("invalid id")))
    #expect(throws:BridgeFailure.self) { try review.validate() }
}
