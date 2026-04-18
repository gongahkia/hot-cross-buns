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
    @State private var query = ""
    @FocusState private var isSearchFocused: Bool

    let commands: [CommandPaletteCommand]

    var body: some View {
        VStack(spacing: 0) {
            searchHeader

            Divider()
                .overlay(.secondary.opacity(0.25))

            ScrollView {
                LazyVStack(spacing: 0) {
                    if filteredCommands.isEmpty {
                        emptyState
                    } else {
                        ForEach(Array(filteredCommands.enumerated()), id: \.element.id) { index, command in
                            Button {
                                run(command)
                            } label: {
                                CommandPaletteRow(command: command)
                            }
                            .buttonStyle(.plain)
                            .padding(.horizontal, 20)
                            .padding(.vertical, 8)

                            if index < filteredCommands.count - 1 {
                                Divider()
                                    .padding(.leading, 58)
                                    .padding(.trailing, 20)
                                    .overlay(.secondary.opacity(0.22))
                            }
                        }
                    }
                }
                .padding(.vertical, 12)
            }
            .onAppear {
                isSearchFocused = true
            }
            .onSubmit(of: .text, executeFirstMatch)
        }
        .frame(minWidth: 760, idealWidth: 760, minHeight: 520, idealHeight: 560)
        .background {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(.regularMaterial)
        }
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .presentationBackground(.clear)
        .padding(14)
    }

    private var filteredCommands: [CommandPaletteCommand] {
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard normalizedQuery.isEmpty == false else {
            return commands
        }

        return commands.filter { command in
            if command.title.lowercased().contains(normalizedQuery) {
                return true
            }

            if command.subtitle.lowercased().contains(normalizedQuery) {
                return true
            }

            return command.keywords.contains { keyword in
                keyword.lowercased().contains(normalizedQuery)
            }
        }
    }

    private func executeFirstMatch() {
        guard let first = filteredCommands.first else {
            return
        }

        run(first)
    }

    private func run(_ command: CommandPaletteCommand) {
        dismiss()
        DispatchQueue.main.async {
            command.action()
        }
    }

    private var searchHeader: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(.secondary)

            TextField("Search commands...", text: $query)
                .textFieldStyle(.plain)
                .focused($isSearchFocused)
                .font(.system(size: 20, weight: .medium, design: .rounded))
                .onSubmit(executeFirstMatch)

            if query.isEmpty {
                Text("⌘P")
                    .font(.system(.title3, design: .rounded, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(.thinMaterial)
                    )
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "command")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(.secondary)
            Text("No command matches \"\(query)\"")
                .font(.headline)
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
                .font(.headline)
                .foregroundStyle(.secondary)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 2) {
                Text(command.title)
                    .font(.system(size: 19, weight: .semibold, design: .rounded))
                Text(command.subtitle)
                    .font(.system(size: 14, weight: .regular, design: .rounded))
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 12)

            if command.shortcut.isEmpty == false {
                Text(command.shortcut)
                    .font(.system(size: 14, weight: .medium, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
        }
        .contentShape(Rectangle())
        .padding(.vertical, 2)
    }
}

#Preview {
    CommandPaletteView(
        commands: [
            CommandPaletteCommand(
                id: "new-task",
                title: "New Task",
                subtitle: "Create a task in Google Tasks",
                symbol: "checklist",
                shortcut: "⌘N",
                keywords: ["task", "new", "create"],
                action: {}
            ),
            CommandPaletteCommand(
                id: "refresh",
                title: "Refresh",
                subtitle: "Sync Google Tasks and Calendar now",
                symbol: "arrow.clockwise",
                shortcut: "⌘R",
                keywords: ["sync", "reload", "refresh"],
                action: {}
            )
        ]
    )
}
