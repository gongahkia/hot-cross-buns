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
        var queryItems = [
            URLQueryItem(name: "showCompleted", value: "true"),
            URLQueryItem(name: "showDeleted", value: "true"),
            URLQueryItem(name: "showHidden", value: "true"),
            URLQueryItem(name: "maxResults", value: "100")
        ]

        if let updatedMin {
            queryItems.append(URLQueryItem(name: "updatedMin", value: ISO8601DateFormatter.google.string(from: updatedMin)))
        }

        let response: GoogleTasksResponse = try await transport.get(
            path: "/tasks/v1/lists/\(encodedTaskListID)/tasks",
            queryItems: queryItems
        )

        return response.items.map { $0.mirror(taskListID: taskListID) }
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

private extension String {
    var googlePathComponentEncoded: String {
        var allowedCharacters = CharacterSet.urlPathAllowed
        allowedCharacters.remove(charactersIn: "/?#")
        return addingPercentEncoding(withAllowedCharacters: allowedCharacters) ?? self
    }
}
