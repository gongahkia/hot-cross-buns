import Foundation

public struct NativeFutureSelection: Decodable, Sendable, Equatable {
    public let provider, model: String
}
public struct NativeLocalSelectionReview: Decodable, Sendable, Equatable {
    public let id, generation, modelID, tag, digest, endpoint, settingsRevision, notice: String
    enum CodingKeys: String, CodingKey { case id, generation, tag, digest, endpoint, notice; case modelID = "model_id", settingsRevision = "settings_revision" }
    func validate() throws {
        guard validLocalOperationID(id), validLocalOperationID(generation), !modelID.isEmpty,
              normalizedLocalModelDigest(digest) != nil, normalizedLocalModelDigest(settingsRevision) != nil,
              [modelID, tag, endpoint, notice].allSatisfy({ $0.utf8.count <= 4096 }) else { throw BridgeFailure("Invalid local selection review") }
    }
}
public struct NativeLocalSelectionReceipt: Decodable, Sendable, Equatable {
    public let version: Int
    public let id, requestID, profileID, generation, endpoint, modelID, tag, digest, settingsRevision, phase, createdAt, updatedAt: String
    enum CodingKeys: String, CodingKey { case version, id, generation, endpoint, tag, digest, phase; case requestID = "request_id", profileID = "profile_id", modelID = "model_id", settingsRevision = "settings_revision", createdAt = "created_at", updatedAt = "updated_at" }
    public var needsReconciliation: Bool { phase == "prepared" || phase == "uncertain" }
    public var summary: String {
        switch phase {
        case "published": return "Go confirmed future-settings publication. This is not live model verification."
        case "reconciled": return "Current settings and inventory inspected. No selection was replayed."
        case "failed": return "The selection was not confirmed. Refresh and review explicitly."
        default: return "Selection outcome unconfirmed — refresh and reconcile."
        }
    }
    func validate() throws {
        guard version == 1, [id, requestID, profileID, generation].allSatisfy(validLocalOperationID),
              normalizedLocalModelDigest(digest) != nil, normalizedLocalModelDigest(settingsRevision) != nil,
              ["prepared", "published", "failed", "uncertain", "reconciled"].contains(phase),
              [endpoint, modelID, tag, createdAt, updatedAt].allSatisfy({ $0.utf8.count <= 4096 }) else { throw BridgeFailure("Invalid local selection receipt") }
    }
}
func validLocalOperationID(_ value: String) -> Bool { value.range(of: "^[a-zA-Z0-9_-]{1,128}$", options: .regularExpression) != nil }
public func normalizedLocalModelDigest(_ value: String) -> String? {
    let lower = value.lowercased(), digest = lower.hasPrefix("sha256:") ? String(lower.dropFirst(7)) : lower
    return digest.utf8.count == 64 && digest.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) } ? digest : nil
}
extension NativeLocalModel {
    public var canReviewSelection: Bool { eligible && downloaded == true && normalizedLocalModelDigest(digest) != nil }
}
