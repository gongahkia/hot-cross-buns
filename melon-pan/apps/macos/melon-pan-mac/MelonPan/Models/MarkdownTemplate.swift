import Foundation

public struct MarkdownTemplate: Codable, Identifiable, Equatable {
    public let id: UUID
    public var name: String
    public var body: String
    public var createdAt: Date
    public var updatedAt: Date

    public init(
        id: UUID = UUID(),
        name: String,
        body: String,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.name = name
        self.body = body
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public struct TemplateInfo: Codable, Identifiable, Equatable {
    public let id: UUID
    public let name: String
    public let path: String
    public let updatedAt: Date

    public init(id: UUID, name: String, path: String, updatedAt: Date) {
        self.id = id
        self.name = name
        self.path = path
        self.updatedAt = updatedAt
    }
}
