import Foundation

struct GoogleTasksClient: Sendable {
    private let transport: GoogleAPITransport

    init(transport: GoogleAPITransport) {
        self.transport = transport
    }

    func listTaskLists() async throws -> [TaskListMirror] {
        let response: GoogleTaskListsResponse = try await transport.get(path: "/tasks/v1/users/@me/lists")
        return response.items.map { item in
            TaskListMirror(id: item.id, title: item.title, updatedAt: item.updated, etag: item.etag)
        }
    }

    func listTasks(taskListID: String, updatedMin: Date?) async throws -> [TaskMirror] {
        let encodedTaskListID = taskListID.googlePathComponentEncoded
        let baseQueryItems = [
            URLQueryItem(name: "showCompleted", value: "true"),
            URLQueryItem(name: "showDeleted", value: "true"),
            URLQueryItem(name: "showHidden", value: "true"),
            URLQueryItem(name: "maxResults", value: "100")
        ]
        var pageToken: String?
        var tasks: [TaskMirror] = []

        repeat {
            var queryItems = baseQueryItems

            if let updatedMin {
                queryItems.append(URLQueryItem(name: "updatedMin", value: ISO8601DateFormatter.google.string(from: updatedMin)))
            }

            if let pageToken {
                queryItems.append(URLQueryItem(name: "pageToken", value: pageToken))
            }

            let response: GoogleTasksResponse = try await transport.get(
                path: "/tasks/v1/lists/\(encodedTaskListID)/tasks",
                queryItems: queryItems
            )

            tasks.append(contentsOf: response.items.map { $0.mirror(taskListID: taskListID) })
            pageToken = response.nextPageToken
        } while pageToken != nil

        return tasks
    }

    func insertTask(
        taskListID: String,
        title: String,
        notes: String,
        dueDate: Date?
    ) async throws -> TaskMirror {
        let encodedTaskListID = taskListID.googlePathComponentEncoded
        let requestBody = GoogleTaskMutationDTO(
            title: title,
            notes: notes.isEmpty ? nil : notes,
            due: dueDate
        )
        let response: GoogleTaskDTO = try await transport.request(
            method: "POST",
            path: "/tasks/v1/lists/\(encodedTaskListID)/tasks",
            body: requestBody
        )
        return response.mirror(taskListID: taskListID)
    }

    func updateTask(
        taskListID: String,
        taskID: String,
        title: String,
        notes: String,
        dueDate: Date?
    ) async throws -> TaskMirror {
        try await patchTask(
            taskListID: taskListID,
            taskID: taskID,
            body: GoogleTaskPatchDTO(
                title: title,
                notes: .value(notes),
                status: nil,
                due: dueDate.map(NullableField.value) ?? .null,
                completed: .omitted
            )
        )
    }

    func setTaskCompleted(_ isCompleted: Bool, task: TaskMirror) async throws -> TaskMirror {
        try await patchTask(
            taskListID: task.taskListID,
            taskID: task.id,
            body: GoogleTaskPatchDTO(
                title: nil,
                notes: .omitted,
                status: isCompleted ? .completed : .needsAction,
                due: .omitted,
                completed: isCompleted ? .value(Date()) : .null
            )
        )
    }

    func deleteTask(taskListID: String, taskID: String) async throws {
        let encodedTaskListID = taskListID.googlePathComponentEncoded
        let encodedTaskID = taskID.googlePathComponentEncoded
        try await transport.send(
            method: "DELETE",
            path: "/tasks/v1/lists/\(encodedTaskListID)/tasks/\(encodedTaskID)"
        )
    }

    private func patchTask(
        taskListID: String,
        taskID: String,
        body: GoogleTaskPatchDTO
    ) async throws -> TaskMirror {
        let encodedTaskListID = taskListID.googlePathComponentEncoded
        let encodedTaskID = taskID.googlePathComponentEncoded
        let response: GoogleTaskDTO = try await transport.request(
            method: "PATCH",
            path: "/tasks/v1/lists/\(encodedTaskListID)/tasks/\(encodedTaskID)",
            body: body
        )
        return response.mirror(taskListID: taskListID)
    }
}

private struct GoogleTaskListsResponse: Decodable, Sendable {
    var items: [GoogleTaskListDTO]
}

private struct GoogleTaskListDTO: Decodable, Sendable {
    var id: String
    var title: String
    var updated: Date?
    var etag: String?
}

private struct GoogleTasksResponse: Decodable, Sendable {
    var items: [GoogleTaskDTO]
    var nextPageToken: String?
}

private struct GoogleTaskDTO: Decodable, Sendable {
    var id: String
    var title: String
    var notes: String?
    var status: String
    var due: Date?
    var completed: Date?
    var deleted: Bool?
    var hidden: Bool?
    var parent: String?
    var position: String?
    var etag: String?
    var updated: Date?

    func mirror(taskListID: String) -> TaskMirror {
        TaskMirror(
            id: id,
            taskListID: taskListID,
            parentID: parent,
            title: title,
            notes: notes ?? "",
            status: TaskStatus(rawValue: status) ?? .needsAction,
            dueDate: due,
            completedAt: completed,
            isDeleted: deleted ?? false,
            isHidden: hidden ?? false,
            position: position,
            etag: etag,
            updatedAt: updated
        )
    }
}

private struct GoogleTaskMutationDTO: Encodable, Sendable {
    var title: String
    var notes: String?
    var due: Date?
}

private struct GoogleTaskPatchDTO: Encodable, Sendable {
    var title: String?
    var notes: NullableField<String>
    var status: TaskStatus?
    var due: NullableField<Date>
    var completed: NullableField<Date>

    enum CodingKeys: String, CodingKey {
        case title
        case notes
        case status
        case due
        case completed
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(title, forKey: .title)
        try container.encodeIfPresent(status, forKey: .status)
        try container.encode(notes, forKey: .notes)
        try container.encode(due, forKey: .due)
        try container.encode(completed, forKey: .completed)
    }
}

private enum NullableField<Value: Encodable & Sendable>: Encodable, Sendable {
    case omitted
    case null
    case value(Value)

    func encode(to encoder: Encoder) throws {
        switch self {
        case .omitted:
            break
        case .null:
            var container = encoder.singleValueContainer()
            try container.encodeNil()
        case .value(let value):
            try value.encode(to: encoder)
        }
    }
}

private extension KeyedEncodingContainer {
    mutating func encode<Value: Encodable & Sendable>(
        _ value: NullableField<Value>,
        forKey key: Key
    ) throws {
        switch value {
        case .omitted:
            break
        case .null:
            try encodeNil(forKey: key)
        case .value(let wrappedValue):
            try encode(wrappedValue, forKey: key)
        }
    }
}

private extension String {
    var googlePathComponentEncoded: String {
        var allowedCharacters = CharacterSet.urlPathAllowed
        allowedCharacters.remove(charactersIn: "/?#")
        return addingPercentEncoding(withAllowedCharacters: allowedCharacters) ?? self
    }
}
