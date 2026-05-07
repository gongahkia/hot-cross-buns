import Foundation

public struct OpenHistoryEntry: Codable, Identifiable, Hashable {
    public let entry: String
    public let recordedAtUnix: UInt64?

    public var id: String { entry }
}
