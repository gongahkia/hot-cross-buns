import SwiftUI

struct SearchView: View {
    @Environment(AppModel.self) private var model
    @Environment(RouterPath.self) private var router
    @State private var query = ""

    var body: some View {
        List {
            if trimmedQuery.isEmpty {
                SearchPromptView()
            } else {
                Section("Tasks") {
                    if matchingTasks.isEmpty {
                        Text("No matching tasks")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(matchingTasks) { task in
                            Button {
                                router.navigate(to: .task(task.id))
                            } label: {
                                SearchTaskRow(task: task, taskListTitle: taskListTitle(for: task))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                Section("Events") {
                    if matchingEvents.isEmpty {
                        Text("No matching events")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(matchingEvents) { event in
                            Button {
                                router.navigate(to: .event(event.id))
                            } label: {
                                SearchEventRow(event: event, calendarTitle: calendarTitle(for: event))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
        .appBackground()
        .navigationTitle("Search")
        .searchable(text: $query, placement: .automatic, prompt: "Tasks, notes, events, calendars")
    }

    private var trimmedQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var matchingTasks: [TaskMirror] {
        guard trimmedQuery.isEmpty == false else {
            return []
        }

        return model.tasks
            .filter { $0.isDeleted == false && matches(task: $0, query: trimmedQuery) }
            .sorted { lhs, rhs in
                (lhs.dueDate ?? lhs.updatedAt ?? .distantFuture) < (rhs.dueDate ?? rhs.updatedAt ?? .distantFuture)
            }
    }

    private var matchingEvents: [CalendarEventMirror] {
        guard trimmedQuery.isEmpty == false else {
            return []
        }

        return model.events
            .filter { $0.status != .cancelled && matches(event: $0, query: trimmedQuery) }
            .sorted { $0.startDate < $1.startDate }
    }

    private func matches(task: TaskMirror, query: String) -> Bool {
        let values = [
            task.title,
            task.notes,
            taskListTitle(for: task),
            task.status.rawValue
        ]
        return values.contains { $0.localizedCaseInsensitiveContains(query) }
    }

    private func matches(event: CalendarEventMirror, query: String) -> Bool {
        let values = [
            event.summary,
            event.details,
            calendarTitle(for: event),
            event.status.rawValue
        ]
        return values.contains { $0.localizedCaseInsensitiveContains(query) }
    }

    private func taskListTitle(for task: TaskMirror) -> String {
        model.taskLists.first(where: { $0.id == task.taskListID })?.title ?? task.taskListID
    }

    private func calendarTitle(for event: CalendarEventMirror) -> String {
        model.calendars.first(where: { $0.id == event.calendarID })?.summary ?? event.calendarID
    }
}

private struct SearchPromptView: View {
    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 10) {
                Label("Search local Google cache", systemImage: "magnifyingglass.circle.fill")
                    .font(.headline)
                    .foregroundStyle(AppColor.ink)
                Text("Find synced tasks and calendar events instantly without another Google round trip.")
                    .foregroundStyle(.secondary)
            }
            .padding(.vertical, 8)
        }
    }
}

private struct SearchTaskRow: View {
    let task: TaskMirror
    let taskListTitle: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: task.isCompleted ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(task.isCompleted ? AppColor.moss : AppColor.ember)
                .font(.title3)
            VStack(alignment: .leading, spacing: 5) {
                Text(task.title)
                    .font(.headline)
                    .foregroundStyle(AppColor.ink)
                Text(taskListTitle)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                if !task.notes.isEmpty {
                    Text(task.notes)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
        }
        .contentShape(Rectangle())
    }
}

private struct SearchEventRow: View {
    let event: CalendarEventMirror
    let calendarTitle: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(AppColor.blue)
                .frame(width: 6)
            VStack(alignment: .leading, spacing: 5) {
                Text(event.summary)
                    .font(.headline)
                    .foregroundStyle(AppColor.ink)
                Text(calendarTitle)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                Text(timeRange)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                if !event.details.isEmpty {
                    Text(event.details)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
        }
        .contentShape(Rectangle())
    }

    private var timeRange: String {
        if event.isAllDay {
            return event.startDate.formatted(date: .abbreviated, time: .omitted) + " all day"
        }

        return "\(event.startDate.formatted(date: .abbreviated, time: .shortened)) - \(event.endDate.formatted(date: .omitted, time: .shortened))"
    }
}

#Preview {
    NavigationStack {
        SearchView()
            .environment(AppModel.preview)
            .environment(RouterPath())
    }
}
