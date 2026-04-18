import Foundation

struct GoogleTasksClient: Sendable {
    private let transport: GoogleAPITransport

    init(transport: GoogleAPITransport) {
        self.transport = transport
    }

    func listTaskLists() async throws -> [TaskListMirror] {
        let response: GoogleTaskListsResponse = try await transport.get(path: "/tasks/v1/users/@me/lists")
        return response.items.map(\.mirror)
    }

    func insertTaskList(title: String) async throws -> TaskListMirror {
        let response: GoogleTaskListDTO = try await transport.request(
            method: "POST",
            path: "/tasks/v1/users/@me/lists",
            body: GoogleTaskListMutationDTO(title: title)
        )
        return response.mirror
    }

    func updateTaskList(taskListID: String, title: String) async throws -> TaskListMirror {
        let encodedTaskListID = taskListID.googlePathComponentEncoded
        let response: GoogleTaskListDTO = try await transport.request(
            method: "PATCH",
            path: "/tasks/v1/users/@me/lists/\(encodedTaskListID)",
            body: GoogleTaskListMutationDTO(title: title)
        )
        return response.mirror
    }

    func deleteTaskList(taskListID: String) async throws {
        let encodedTaskListID = taskListID.googlePathComponentEncoded
        try await transport.send(
            method: "DELETE",
            path: "/tasks/v1/users/@me/lists/\(encodedTaskListID)"
        )
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
        dueDate: Date?,
        parent: String? = nil,
        previous: String? = nil
    ) async throws -> TaskMirror {
        let encodedTaskListID = taskListID.googlePathComponentEncoded
        let requestBody = GoogleTaskMutationDTO(
            title: title,
            notes: notes.isEmpty ? nil : notes,
            due: dueDate
        )
        var queryItems: [URLQueryItem] = []
        if let parent { queryItems.append(URLQueryItem(name: "parent", value: parent)) }
        if let previous { queryItems.append(URLQueryItem(name: "previous", value: previous)) }
        let response: GoogleTaskDTO = try await transport.request(
            method: "POST",
            path: "/tasks/v1/lists/\(encodedTaskListID)/tasks",
            queryItems: queryItems,
            body: requestBody
        )
        return response.mirror(taskListID: taskListID)
    }

    func moveTask(
        taskListID: String,
        taskID: String,
        parent: String?,
        previous: String?
    ) async throws -> TaskMirror {
        let encodedTaskListID = taskListID.googlePathComponentEncoded
        let encodedTaskID = taskID.googlePathComponentEncoded
        var queryItems: [URLQueryItem] = []
        if let parent { queryItems.append(URLQueryItem(name: "parent", value: parent)) }
        if let previous { queryItems.append(URLQueryItem(name: "previous", value: previous)) }
        let response: GoogleTaskDTO = try await transport.request(
            method: "POST",
            path: "/tasks/v1/lists/\(encodedTaskListID)/tasks/\(encodedTaskID)/move",
            queryItems: queryItems
        )
        return response.mirror(taskListID: taskListID)
    }

    func updateTask(
        taskListID: String,
        taskID: String,
        title: String,
        notes: String,
        dueDate: Date?,
        ifMatch: String? = nil
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
            ),
            ifMatch: ifMatch
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
            ),
            ifMatch: task.etag
        )
    }

    func deleteTask(taskListID: String, taskID: String, ifMatch: String? = nil) async throws {
        let encodedTaskListID = taskListID.googlePathComponentEncoded
        let encodedTaskID = taskID.googlePathComponentEncoded
        try await transport.send(
            method: "DELETE",
            path: "/tasks/v1/lists/\(encodedTaskListID)/tasks/\(encodedTaskID)",
            ifMatch: ifMatch
        )
    }

    private func patchTask(
        taskListID: String,
        taskID: String,
        body: GoogleTaskPatchDTO,
        ifMatch: String? = nil
    ) async throws -> TaskMirror {
        let encodedTaskListID = taskListID.googlePathComponentEncoded
        let encodedTaskID = taskID.googlePathComponentEncoded
        let response: GoogleTaskDTO = try await transport.request(
            method: "PATCH",
            path: "/tasks/v1/lists/\(encodedTaskListID)/tasks/\(encodedTaskID)",
            body: body,
            ifMatch: ifMatch
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

    var mirror: TaskListMirror {
        TaskListMirror(id: id, title: title, updatedAt: updated, etag: etag)
    }
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

private struct GoogleTaskListMutationDTO: Encodable, Sendable {
    var title: String
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
