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

// Command palette — strictly an action launcher after the §6.7 split. Entity
// lookup (tasks / events / lists / calendars / saved filters) moved to
// QuickSwitcherView under ⌘O. Keeping the two surfaces separate means one has
// one job: palette = "do", switcher = "go".
struct CommandPaletteView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model
    @State private var query = ""
    @FocusState private var isSearchFocused: Bool

    let commands: [CommandPaletteCommand]

    var body: some View {
        VStack(spacing: 0) {
            searchHeader

            if trimmedQuery.isEmpty == false {
                Divider().overlay(.secondary.opacity(0.25))

                ScrollView {
                    LazyVStack(spacing: 0) {
                        if filteredCommands.isEmpty {
                            emptyState
                        } else {
                            ForEach(Array(filteredCommands.enumerated()), id: \.element.id) { index, command in
                                commandButton(command: command, index: index)
                            }
                        }
                    }
                    .hcbScaledPadding(.vertical, 12)
                }
            }
        }
        .onAppear {
            // Honour any deep-link-staged query: hotcrossbuns://search?q=… sets
            // model.pendingPaletteQuery before toggling the palette open. Clear
            // after consuming so a subsequent manual open starts blank.
            if let staged = model.pendingPaletteQuery, staged.isEmpty == false {
                query = staged
                model.pendingPaletteQuery = nil
            }
            isSearchFocused = true
        }
        .onSubmit(of: .text, executeFirstMatch)
        .hcbScaledFrame(
            minWidth: 520,
            idealWidth: 560,
            maxWidth: 620,
            minHeight: trimmedQuery.isEmpty ? 54 : 360,
            idealHeight: trimmedQuery.isEmpty ? 54 : 420
        )
        .background {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(.ultraThinMaterial) // Alfred-style translucent vibrancy
        }
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .presentationBackground(.clear)
        .hcbScaledPadding(14)
    }

    private var trimmedQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // FuzzySearcher provides consistent ranking with the quick switcher. We
    // still fall back to the old substring filter if the fuzzy pass finds
    // nothing (paranoid default — empty palette is worse than a messy one).
    private var filteredCommands: [CommandPaletteCommand] {
        let q = trimmedQuery
        guard q.isEmpty == false else { return commands }
        let ranked = FuzzySearcher.rank(
            commands,
            query: q,
            labelForItem: { $0.title },
            keywordsForItem: { [$0.subtitle] + $0.keywords },
            limit: 50
        )
        if ranked.isEmpty == false {
            return ranked.map(\.item)
        }
        // Fallback substring match — should rarely fire given fuzzy is permissive.
        let lower = q.lowercased()
        return commands.filter { command in
            command.title.lowercased().contains(lower)
                || command.subtitle.lowercased().contains(lower)
                || command.keywords.contains(where: { $0.lowercased().contains(lower) })
        }
    }

    private func executeFirstMatch() {
        if let first = filteredCommands.first {
            dismiss()
            DispatchQueue.main.async { first.action() }
        }
    }

    private var searchHeader: some View {
        HStack(spacing: 8) {
            Image(systemName: "command")
                .hcbFont(.subheadline, weight: .medium)
                .foregroundStyle(.secondary)

            TextField("Run a command — New Task, Refresh, Print Today…", text: $query)
                .textFieldStyle(.plain)
                .focused($isSearchFocused)
                .hcbFont(.body)
                .onSubmit(executeFirstMatch)

            if query.isEmpty {
                Text("⇧⌘P")
                    .hcbFont(.caption, weight: .semibold)
                    .foregroundStyle(.secondary)
                    .hcbScaledPadding(.horizontal, 6)
                    .hcbScaledPadding(.vertical, 2)
                    .background(
                        RoundedRectangle(cornerRadius: 5, style: .continuous)
                            .fill(.thinMaterial)
                    )
            }
        }
        .hcbScaledPadding(.horizontal, 12)
        .hcbScaledPadding(.vertical, 9)
    }

    @ViewBuilder
    private func commandButton(command: CommandPaletteCommand, index: Int) -> some View {
        let button = Button {
            dismiss()
            DispatchQueue.main.async { command.action() }
        } label: {
            HStack(spacing: 6) {
                CommandPaletteRow(command: command)
                if let label = numericShortcutLabel(for: index) {
                    Text(label)
                        .font(.system(.caption2, design: .monospaced, weight: .medium))
                        .foregroundStyle(.secondary)
                        .hcbScaledPadding(.horizontal, 5)
                        .hcbScaledPadding(.vertical, 1)
                        .background(
                            RoundedRectangle(cornerRadius: 4, style: .continuous)
                                .fill(.quaternary.opacity(0.5))
                        )
                }
            }
        }
        .buttonStyle(.plain)
        .hcbScaledPadding(.horizontal, 20)
        .hcbScaledPadding(.vertical, 8)

        if index < 10 {
            button.keyboardShortcut(numericKeyEquivalent(for: index), modifiers: [.command])
        } else {
            button
        }
    }

    private func numericKeyEquivalent(for index: Int) -> KeyEquivalent {
        let digit: Character = index == 9 ? "0" : Character(String(index + 1))
        return KeyEquivalent(digit)
    }

    private func numericShortcutLabel(for index: Int) -> String? {
        guard index < 10 else { return nil }
        let digit = index == 9 ? "0" : "\(index + 1)"
        return "⌘\(digit)"
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "command")
                .hcbFont(.title2, weight: .semibold)
                .foregroundStyle(.secondary)
            Text("No command matches \"\(query)\"")
                .hcbFont(.headline)
                .foregroundStyle(.secondary)
            Text("Use ⌘O to search for tasks, events, and lists.")
                .hcbFont(.footnote)
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
