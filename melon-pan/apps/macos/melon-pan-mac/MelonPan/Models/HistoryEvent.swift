import Foundation

public struct HistoryEvent: Codable, Identifiable, Hashable {
    public enum Kind: String, Codable, CaseIterable, Hashable {
        case pull, push, drain, conflict, drift, error
        case `import`
    }

    public let timestampUnix: UInt64
    public let kind: Kind
    public let documentId: String
    public let revision: String
    public let message: String

    public var id: String { "\(timestampUnix)-\(kind.rawValue)-\(documentId)-\(revision)" }
    public var date: Date { Date(timeIntervalSince1970: TimeInterval(timestampUnix)) }

    enum CodingKeys: String, CodingKey {
        case timestampUnix = "ts"
        case kind, revision, message
        case documentId = "document_id"
    }

    var rawJSONString: String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(self) else { return "{}" }
        return String(decoding: data, as: UTF8.self)
    }
}
