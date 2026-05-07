import Foundation

public struct SnapshotInfo: Codable, Identifiable, Hashable {
    public enum Kind: String, Codable, Hashable {
        case revision, prePush
    }

    public let documentId: String
    public let kind: Kind
    public let revisionOrStamp: String
    public let markdownPath: String
    public let docsJsonPath: String?
    public let createdAtUnix: UInt64
    public let sizeBytes: UInt64

    public var id: String { markdownPath }
    public var createdAt: Date { Date(timeIntervalSince1970: TimeInterval(createdAtUnix)) }
}
