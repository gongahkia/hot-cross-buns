import Foundation
import Observation

/// Non-secret presentation only. The secure editor owns its transient key;
/// credential expectations and configuration validation belong to Go.
@MainActor @Observable public final class NativeProviderSetup {
    public private(set) var futureSelection: NativeFutureSelection?
    public private(set) var localReview: NativeLocalSelectionReview?
    public private(set) var localReceipt: NativeLocalSelectionReceipt?
    public private(set) var localNotice = ""
    public var futureSelectionLabel: String { guard let futureSelection else { return "Future model: unknown · refresh status" }; return "Future model: \(futureSelection.provider.isEmpty ? "none" : futureSelection.provider) / \(futureSelection.model.isEmpty ? "none" : futureSelection.model)" }
    public private(set) var localStatus: NativeLocalStatus?
    public private(set) var localIssue = ""
    @ObservationIgnored private var presentationEpoch = UUID()
    public private(set) var rows: [NativeProviderRow] = []
    public var selection: String? { didSet { if selection != oldValue { review = nil; editorEpoch = UUID() } } }
    public var forms: [String: NativeProviderForm] = [:]
    public private(set) var review: NativeProviderReview?
    public private(set) var issue = ""
    public private(set) var notice = ""
    public private(set) var busy = false
    public private(set) var isPresented = false
    public private(set) var needsRefresh = false
    public private(set) var editorEpoch = UUID()
    @ObservationIgnored private var sender: (@MainActor (NativeProviderRequest) async throws -> NativeProviderResult)?
    @ObservationIgnored private var operation: Task<Bool, Never>?
    @ObservationIgnored private var operationID = UUID()
    public func isFutureProvider(_ row: NativeProviderRow) -> Bool { futureSelection.map { $0.provider == row.id } ?? (row.isDefault == true) }
    public var selected: NativeProviderRow? { rows.first { $0.id == selection } }
    public var retainsHost: Bool { isPresented || busy || needsRefresh }
    public var canReview: Bool { !busy && !needsRefresh && selected != nil }
    func present(sender: @escaping @MainActor (NativeProviderRequest) async throws -> NativeProviderResult) {
        if !isPresented { presentationEpoch = UUID(); localStatus = nil; localIssue = "" }; self.sender = sender; isPresented = true
        if !busy { Task { await refresh() } }
    }
    public func prepareLocalSelection(_ id: String) async -> Bool {
        guard !busy, isPresented, localReceipt?.needsReconciliation != true, localStatus?.selectionBlock?.isEmpty != false, localStatus?.catalog.contains(where: { $0.id == id && $0.canReviewSelection }) == true else { return false }
        var request = NativeProviderRequest(.local_review_select); request.modelID = id
        return await perform(request)
    }
    public func confirmLocalSelection() async -> Bool {
        guard !busy, isPresented, localReceipt?.needsReconciliation != true, let localReview else { return false }
        var request = NativeProviderRequest(.local_select); request.reviewID = localReview.id; request.generation = localReview.generation; request.modelID = localReview.modelID
        let saved = await perform(request)
        if saved, isPresented { await refreshLocal() }
        return saved
    }
    public func cancelLocalSelection() async {
        guard !busy, let localReview else { return }
        var request = NativeProviderRequest(.local_cancel_review); request.reviewID = localReview.id; request.generation = localReview.generation
        _ = await perform(request)
    }
    public func reconcileLocalSelection() async {
        guard !busy, isPresented, let localReceipt else { return }
        var request = NativeProviderRequest(.local_reconcile); request.operationID = localReceipt.id
        _ = await perform(request)
        if isPresented { await refreshLocal() }
    }
    public func refreshLocal() async {
        guard !busy, isPresented else { return }
        localReview = nil
        _ = await perform(NativeProviderRequest(.local_status))
    }
    public func refresh() async {
        guard !busy else { return }
        _ = await perform(NativeProviderRequest(.status))
    }
    public func prepare(replacing: Bool, removal: Bool = false) async -> Bool {
        guard canReview, let row = selected else { return false }
        var request = NativeProviderRequest(removal ? .review_remove : .review)
        request.provider = row.id; request.form = forms[row.id] ?? NativeProviderForm(row); request.replaceKey = replacing
        return await perform(request)
    }
    public func save(apiKey: String) async -> Bool {
        guard !busy, !needsRefresh, let review, review.provider == selection else { return false }
        var request = NativeProviderRequest(review.operation == "remove" ? .remove : .save)
        request.provider = review.provider; request.reviewID = review.id; request.apiKey = apiKey
        self.review = nil
        return await perform(request)
    }
    public func cancelReview() {
        guard !busy else { return }; review = nil; editorEpoch = UUID()
        // A discarded opaque review cannot cause an operation by itself.
    }
    public func dismiss() { localReview = nil; presentationEpoch = UUID(); localStatus = nil; localIssue = ""; isPresented = false; review = nil; editorEpoch = UUID() }
    func finishOperation() async { _ = await operation?.value }
    private func perform(_ request: NativeProviderRequest) async -> Bool {
        guard !busy, let sender else { return false }
        busy = true; issue = ""; notice = ""
        let selectedID = selection, id = UUID(), epoch = presentationEpoch
        operationID = id
        let task = Task { @MainActor [weak self] () -> Bool in
            guard let self else { return false }
            defer { self.busy = false }
            do {
                let result = try await sender(request)
                guard result.requestID == request.id, result.action == request.action.rawValue,
                      request.provider.isEmpty || result.provider == request.provider else { throw BridgeFailure("Provider completion identity did not match. Refresh before reviewing again.") }
                if request.action.rawValue.hasPrefix("local_"), (!self.isPresented || self.presentationEpoch != epoch) { return false }
                if let future = result.futureSelection {
                    guard future.provider.utf8.count <= 2048, future.model.utf8.count <= 2048 else { throw BridgeFailure("Invalid future model identity") }
                    self.futureSelection = future
                }
                if request.action.rawValue.hasPrefix("local_") {
                    guard self.isPresented, self.presentationEpoch == epoch else { return false }
                    if let receipt = result.localReceipt { try receipt.validate(); self.localReceipt = receipt }
                    if let error = result.error, !error.isEmpty { self.localIssue = error; self.localReview = nil; if result.changed { self.localStatus = nil }; return false }
                    self.localIssue = ""
                    if let notice = result.notice, !notice.isEmpty { self.localNotice = notice }
                    if let status = result.local { try status.validate(); self.localStatus = status }
                    if let reviewed = result.localReview {
                        try reviewed.validate()
                        guard request.action == .local_review_select, reviewed.modelID == request.modelID else { throw BridgeFailure("Local review identity mismatch") }
                        self.localReview = reviewed
                    }
                    if request.action == .local_select {
                        guard result.confirmed, result.changed, result.localReceipt?.phase == "published" else { throw BridgeFailure("Selection publication was not confirmed") }
                        self.localReview = nil; self.localStatus = nil
                    }
                    if request.action == .local_cancel_review { self.localReview = nil }
                    return true
                }
                if let rows = result.rows {
                    guard rows.count <= 64, Set(rows.map(\.id)).count == rows.count else { throw BridgeFailure("Provider status was invalid. Refresh before setup.") }
                    self.rows = rows
                    for row in rows where self.forms[row.id] == nil { self.forms[row.id] = NativeProviderForm(row) }
                    if self.selection == nil { self.selection = rows.first?.id }
                }
                if let error = result.error, !error.isEmpty {
                    self.issue = error; self.review = nil; self.needsRefresh = true; self.editorEpoch = UUID(); return false
                }
                if request.action == .status { self.needsRefresh = false; self.review = nil }
                if let review = result.review, self.isPresented, self.selection == selectedID { self.review = review }
                if request.action == .save || request.action == .remove {
                    guard result.confirmed else { throw BridgeFailure("Provider storage was not confirmed. Refresh and review; no retry was sent.") }
                    self.needsRefresh = false; self.notice = request.provider + ": " + (result.notice ?? "Go confirmed this provider change. No live request was made.")
                    self.editorEpoch = UUID()
                }
                return true
            } catch {
                if request.action.rawValue.hasPrefix("local_") {
                    self.localReview = nil
                    if self.isPresented, self.presentationEpoch == epoch { self.localIssue = "Local inspection was not confirmed. Reopen after reconnecting, then refresh explicitly." }
                    return false
                }
                self.issue = "Provider outcome is unconfirmed. Refresh status, inspect the result and explicitly review again. Nothing is retried automatically."
                self.needsRefresh = true; self.review = nil; self.editorEpoch = UUID(); return false
            }
        }
        operation = task
        let result = await task.value
        if operationID == id { operation = nil }
        return result
    }
}
