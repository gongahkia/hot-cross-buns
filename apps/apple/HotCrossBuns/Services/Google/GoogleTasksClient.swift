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

        return response.items.map { item in
            TaskMirror(
                id: item.id,
                taskListID: taskListID,
                parentID: item.parent,
                title: item.title,
                notes: item.notes ?? "",
                status: TaskStatus(rawValue: item.status) ?? .needsAction,
                dueDate: item.due,
                completedAt: item.completed,
                isDeleted: item.deleted ?? false,
                isHidden: item.hidden ?? false,
                position: item.position,
                etag: item.etag,
                updatedAt: item.updated
            )
        }
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
}

private extension String {
    var googlePathComponentEncoded: String {
        var allowedCharacters = CharacterSet.urlPathAllowed
        allowedCharacters.remove(charactersIn: "/?#")
        return addingPercentEncoding(withAllowedCharacters: allowedCharacters) ?? self
    }
}
