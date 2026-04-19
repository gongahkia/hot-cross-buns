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
    var location: String = ""
    var recurrence: [String] = []
    var attendeeEmails: [String] = []
    var notifyGuests: Bool = false
}

struct PendingTaskUpdatePayload: Codable, Sendable, Equatable {
    var taskListID: String
    var taskID: String
    var title: String
    var notes: String
    var dueDate: Date?
    var etagSnapshot: String?
}

struct PendingTaskCompletionPayload: Codable, Sendable, Equatable {
    var taskListID: String
    var taskID: String
    var isCompleted: Bool
    var etagSnapshot: String?
}

struct PendingTaskDeletePayload: Codable, Sendable, Equatable {
    var taskListID: String
    var taskID: String
    var etagSnapshot: String?
}

struct PendingEventUpdatePayload: Codable, Sendable, Equatable {
    var calendarID: String
    var eventID: String
    var summary: String
    var details: String
    var startDate: Date
    var endDate: Date
    var isAllDay: Bool
    var reminderMinutes: Int?
    var location: String
    var recurrence: [String]
    var attendeeEmails: [String]
    var notifyGuests: Bool
    var etagSnapshot: String?
}

struct PendingEventDeletePayload: Codable, Sendable, Equatable {
    var calendarID: String
    var eventID: String
    var etagSnapshot: String?
}

enum PendingMutationEncoder {
    static func encode(_ payload: PendingTaskCreatePayload) throws -> Data {
        try JSONEncoder().encode(payload)
    }

    static func encode(_ payload: PendingEventCreatePayload) throws -> Data {
        try JSONEncoder().encode(payload)
    }

    static func encode(_ payload: PendingTaskUpdatePayload) throws -> Data {
        try JSONEncoder().encode(payload)
    }

    static func encode(_ payload: PendingTaskCompletionPayload) throws -> Data {
        try JSONEncoder().encode(payload)
    }

    static func encode(_ payload: PendingTaskDeletePayload) throws -> Data {
        try JSONEncoder().encode(payload)
    }

    static func encode(_ payload: PendingEventUpdatePayload) throws -> Data {
        try JSONEncoder().encode(payload)
    }

    static func encode(_ payload: PendingEventDeletePayload) throws -> Data {
        try JSONEncoder().encode(payload)
    }

    static func decodeTaskCreate(_ data: Data) throws -> PendingTaskCreatePayload {
        try JSONDecoder().decode(PendingTaskCreatePayload.self, from: data)
    }

    static func decodeEventCreate(_ data: Data) throws -> PendingEventCreatePayload {
        try JSONDecoder().decode(PendingEventCreatePayload.self, from: data)
    }

    static func decodeTaskUpdate(_ data: Data) throws -> PendingTaskUpdatePayload {
        try JSONDecoder().decode(PendingTaskUpdatePayload.self, from: data)
    }

    static func decodeTaskCompletion(_ data: Data) throws -> PendingTaskCompletionPayload {
        try JSONDecoder().decode(PendingTaskCompletionPayload.self, from: data)
    }

    static func decodeTaskDelete(_ data: Data) throws -> PendingTaskDeletePayload {
        try JSONDecoder().decode(PendingTaskDeletePayload.self, from: data)
    }

    static func decodeEventUpdate(_ data: Data) throws -> PendingEventUpdatePayload {
        try JSONDecoder().decode(PendingEventUpdatePayload.self, from: data)
    }

    static func decodeEventDelete(_ data: Data) throws -> PendingEventDeletePayload {
        try JSONDecoder().decode(PendingEventDeletePayload.self, from: data)
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

    static func taskUpdate(payload: PendingTaskUpdatePayload) throws -> PendingMutation {
        PendingMutation(
            id: UUID(),
            createdAt: Date(),
            resourceType: .task,
            resourceID: payload.taskID,
            action: .update,
            payload: try PendingMutationEncoder.encode(payload)
        )
    }

    static func taskCompletion(payload: PendingTaskCompletionPayload) throws -> PendingMutation {
        PendingMutation(
            id: UUID(),
            createdAt: Date(),
            resourceType: .task,
            resourceID: payload.taskID,
            action: .completion,
            payload: try PendingMutationEncoder.encode(payload)
        )
    }

    static func taskDelete(payload: PendingTaskDeletePayload) throws -> PendingMutation {
        PendingMutation(
            id: UUID(),
            createdAt: Date(),
            resourceType: .task,
            resourceID: payload.taskID,
            action: .delete,
            payload: try PendingMutationEncoder.encode(payload)
        )
    }

    static func eventUpdate(payload: PendingEventUpdatePayload) throws -> PendingMutation {
        PendingMutation(
            id: UUID(),
            createdAt: Date(),
            resourceType: .event,
            resourceID: payload.eventID,
            action: .update,
            payload: try PendingMutationEncoder.encode(payload)
        )
    }

    static func eventDelete(payload: PendingEventDeletePayload) throws -> PendingMutation {
        PendingMutation(
            id: UUID(),
            createdAt: Date(),
            resourceType: .event,
            resourceID: payload.eventID,
            action: .delete,
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
