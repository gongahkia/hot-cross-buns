import SwiftUI

struct CommandPaletteCommand: Identifiable {
    let id: String
    let title: String
    let subtitle: String
    let symbol: String
    let shortcut: String
    let keywords: [String]
    let action: () -> Void
}

struct CommandPaletteView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model
    @State private var query = ""
    @FocusState private var isSearchFocused: Bool

    let commands: [CommandPaletteCommand]
    let onSelectTask: (TaskMirror) -> Void
    let onSelectEvent: (CalendarEventMirror) -> Void

    private enum Row: Identifiable {
        case command(CommandPaletteCommand)
        case task(TaskMirror)
        case event(CalendarEventMirror)

        var id: String {
            switch self {
            case .command(let c): return "cmd-\(c.id)"
            case .task(let t): return "task-\(t.id)"
            case .event(let e): return "event-\(e.id)"
            }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            searchHeader

            Divider()
                .overlay(.secondary.opacity(0.25))

            ScrollView {
                LazyVStack(spacing: 0) {
                    if filteredCommands.isEmpty, searchResults.isEmpty {
                        emptyState
                    } else {
                        if filteredCommands.isEmpty == false {
                            sectionHeader("Commands")
                            ForEach(filteredCommands) { command in
                                Button { run(.command(command)) } label: {
                                    CommandPaletteRow(command: command)
                                }
                                .buttonStyle(.plain)
                                .hcbScaledPadding(.horizontal, 20)
                                .hcbScaledPadding(.vertical, 8)
                            }
                        }
                        if searchResults.isEmpty == false {
                            sectionHeader("Results")
                            ForEach(searchResults) { row in
                                Button { run(row) } label: {
                                    resultRow(row)
                                }
                                .buttonStyle(.plain)
                                .hcbScaledPadding(.horizontal, 20)
                                .hcbScaledPadding(.vertical, 8)
                            }
                        }
                    }
                }
                .hcbScaledPadding(.vertical, 12)
            }
            .onAppear {
                isSearchFocused = true
            }
            .onSubmit(of: .text, executeFirstMatch)
        }
        .hcbScaledFrame(minWidth: 760, idealWidth: 760, minHeight: 520, idealHeight: 560)
        .background {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(.regularMaterial)
        }
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .presentationBackground(.clear)
        .hcbScaledPadding(14)
    }

    private var trimmedQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var filteredCommands: [CommandPaletteCommand] {
        let normalizedQuery = trimmedQuery.lowercased()
        guard normalizedQuery.isEmpty == false else {
            return commands
        }

        return commands.filter { command in
            if command.title.lowercased().contains(normalizedQuery) { return true }
            if command.subtitle.lowercased().contains(normalizedQuery) { return true }
            return command.keywords.contains { $0.lowercased().contains(normalizedQuery) }
        }
    }

    private var searchResults: [Row] {
        guard trimmedQuery.isEmpty == false else { return [] }
        let q = trimmedQuery
        let taskRows: [Row] = model.tasks
            .filter { $0.isDeleted == false }
            .filter { matches(task: $0, query: q) }
            .sorted { ($0.dueDate ?? $0.updatedAt ?? .distantFuture) < ($1.dueDate ?? $1.updatedAt ?? .distantFuture) }
            .prefix(12)
            .map(Row.task)
        let eventRows: [Row] = model.events
            .filter { $0.status != .cancelled }
            .filter { matches(event: $0, query: q) }
            .sorted { $0.startDate < $1.startDate }
            .prefix(12)
            .map(Row.event)
        return taskRows + eventRows
    }

    private func matches(task: TaskMirror, query: String) -> Bool {
        [task.title, task.notes, taskListTitle(for: task)].contains {
            $0.localizedCaseInsensitiveContains(query)
        }
    }

    private func matches(event: CalendarEventMirror, query: String) -> Bool {
        [event.summary, event.details, event.location, calendarTitle(for: event)].contains {
            $0.localizedCaseInsensitiveContains(query)
        }
    }

    private func taskListTitle(for task: TaskMirror) -> String {
        model.taskLists.first(where: { $0.id == task.taskListID })?.title ?? ""
    }

    private func calendarTitle(for event: CalendarEventMirror) -> String {
        model.calendars.first(where: { $0.id == event.calendarID })?.summary ?? ""
    }

    private func executeFirstMatch() {
        if let first = filteredCommands.first { run(.command(first)); return }
        if let first = searchResults.first { run(first); return }
    }

    private func run(_ row: Row) {
        dismiss()
        DispatchQueue.main.async {
            switch row {
            case .command(let command): command.action()
            case .task(let task): onSelectTask(task)
            case .event(let event): onSelectEvent(event)
            }
        }
    }

    private var searchHeader: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .hcbFont(.body, weight: .medium)
                .foregroundStyle(.secondary)

            TextField("Commands, tasks, events…", text: $query)
                .textFieldStyle(.plain)
                .focused($isSearchFocused)
                .font(.system(.title2, design: .rounded, weight: .medium))
                .onSubmit(executeFirstMatch)

            if query.isEmpty {
                Text("⌘P")
                    .font(.system(.title3, design: .rounded, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .hcbScaledPadding(.horizontal, 10)
                    .hcbScaledPadding(.vertical, 4)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(.thinMaterial)
                    )
            }
        }
        .hcbScaledPadding(.horizontal, 18)
        .hcbScaledPadding(.vertical, 14)
    }

    private func sectionHeader(_ title: String) -> some View {
        HStack {
            Text(title.uppercased())
                .hcbFont(.caption, weight: .bold)
                .foregroundStyle(.secondary)
            Spacer()
        }
        .hcbScaledPadding(.horizontal, 20)
        .hcbScaledPadding(.top, 6)
        .hcbScaledPadding(.bottom, 4)
    }

    @ViewBuilder
    private func resultRow(_ row: Row) -> some View {
        switch row {
        case .command: EmptyView()
        case .task(let task):
            HStack(spacing: 12) {
                Image(systemName: task.isCompleted ? "checkmark.circle.fill" : "circle")
                    .hcbFont(.headline)
                    .foregroundStyle(task.isCompleted ? AppColor.moss : AppColor.ember)
                    .hcbScaledFrame(width: 24)
                VStack(alignment: .leading, spacing: 2) {
                    Text(TagExtractor.stripped(from: TaskStarring.displayTitle(for: task)))
                        .font(.system(.title3, design: .rounded, weight: .semibold))
                    Text(taskListTitle(for: task))
                        .font(.system(.subheadline, design: .rounded))
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 12)
                if let due = task.dueDate {
                    Text(due.formatted(.dateTime.month(.abbreviated).day()))
                        .font(.system(.footnote, design: .monospaced, weight: .medium))
                        .foregroundStyle(.secondary)
                }
            }
            .contentShape(Rectangle())
        case .event(let event):
            HStack(spacing: 12) {
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(AppColor.blue)
                    .hcbScaledFrame(width: 6, height: 24)
                    .hcbScaledPadding(.leading, 9)
                VStack(alignment: .leading, spacing: 2) {
                    Text(event.summary)
                        .font(.system(.title3, design: .rounded, weight: .semibold))
                    Text(calendarTitle(for: event))
                        .font(.system(.subheadline, design: .rounded))
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 12)
                Text(eventTimeLabel(event))
                    .hcbFontSystem(size: 13, weight: .medium, design: .monospaced)
                    .foregroundStyle(.secondary)
            }
            .contentShape(Rectangle())
        }
    }

    private func eventTimeLabel(_ event: CalendarEventMirror) -> String {
        if event.isAllDay { return event.startDate.formatted(.dateTime.month(.abbreviated).day()) }
        return event.startDate.formatted(.dateTime.month(.abbreviated).day().hour().minute())
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "command")
                .hcbFont(.title2, weight: .semibold)
                .foregroundStyle(.secondary)
            Text("Nothing matches \"\(query)\"")
                .hcbFont(.headline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, minHeight: 180)
    }
}

private struct CommandPaletteRow: View {
    let command: CommandPaletteCommand

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: command.symbol)
                .hcbFont(.headline)
                .foregroundStyle(.secondary)
                .hcbScaledFrame(width: 24)

            VStack(alignment: .leading, spacing: 2) {
                Text(command.title)
                    .hcbFontSystem(size: 19, weight: .semibold, design: .rounded)
                Text(command.subtitle)
                    .font(.system(.subheadline, design: .rounded))
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 12)

            if command.shortcut.isEmpty == false {
                Text(formattedShortcut)
                    .font(.system(.subheadline, design: .monospaced, weight: .medium))
                    .foregroundStyle(.secondary)
            }
        }
        .contentShape(Rectangle())
        .hcbScaledPadding(.vertical, 2)
    }

    private var formattedShortcut: String {
        command.shortcut
            .replacingOccurrences(of: "Cmd+", with: "⌘")
            .replacingOccurrences(of: "Shift+", with: "⇧")
            .replacingOccurrences(of: "Option+", with: "⌥")
            .replacingOccurrences(of: "+", with: "")
    }
}
