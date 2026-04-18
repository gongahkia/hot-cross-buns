import Foundation

enum OptimisticID {
    static let prefix = "local-"

    static func generate() -> String {
        "\(prefix)\(UUID().uuidString)"
    }

    static func isPending(_ id: String) -> Bool {
        id.hasPrefix(prefix)
    }
}

struct PendingTaskCreatePayload: Codable, Sendable, Equatable {
    var localID: String
    var taskListID: String
    var title: String
    var notes: String
    var dueDate: Date?
    var parentID: String?
}

struct PendingEventCreatePayload: Codable, Sendable, Equatable {
    var localID: String
    var calendarID: String
    var summary: String
    var details: String
    var startDate: Date
    var endDate: Date
    var isAllDay: Bool
    var reminderMinutes: Int?
}

enum PendingMutationEncoder {
    static func encode(_ payload: PendingTaskCreatePayload) throws -> Data {
        try JSONEncoder().encode(payload)
    }

    static func encode(_ payload: PendingEventCreatePayload) throws -> Data {
        try JSONEncoder().encode(payload)
    }

    static func decodeTaskCreate(_ data: Data) throws -> PendingTaskCreatePayload {
        try JSONDecoder().decode(PendingTaskCreatePayload.self, from: data)
    }

    static func decodeEventCreate(_ data: Data) throws -> PendingEventCreatePayload {
        try JSONDecoder().decode(PendingEventCreatePayload.self, from: data)
    }
}

enum PendingMutationReplayOutcome: Sendable {
    case accepted(acceptedID: String)
    case retryLater
    case terminal(message: String)
}

extension PendingMutation {
    static func taskCreate(payload: PendingTaskCreatePayload) throws -> PendingMutation {
        PendingMutation(
            id: UUID(),
            createdAt: Date(),
            resourceType: .task,
            resourceID: payload.localID,
            action: .create,
            payload: try PendingMutationEncoder.encode(payload)
        )
    }

    static func eventCreate(payload: PendingEventCreatePayload) throws -> PendingMutation {
        PendingMutation(
            id: UUID(),
            createdAt: Date(),
            resourceType: .event,
            resourceID: payload.localID,
            action: .create,
            payload: try PendingMutationEncoder.encode(payload)
        )
    }
}

extension GoogleAPIError {
    var isTransient: Bool {
        switch self {
        case .preconditionFailed, .invalidURL, .invalidResponse:
            return false
        case .httpStatus(let status, _):
            return status == 429 || (500...599).contains(status)
        }
    }
}
