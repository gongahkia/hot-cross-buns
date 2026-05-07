import AppKit
import SwiftUI

struct CommandPaletteView: View {
    @Environment(\.appTheme) private var theme
    @Environment(\.appUIFont) private var appUIFont
    @EnvironmentObject private var session: AppSession
    @AppStorage("melonpan.palette.recentIDs") private var recentIDsJSON = "[]"
    @State private var query = ""
    @State private var docs: [DriveItem] = []
    @State private var selectedIndex = 0
    @FocusState private var inputFocused: Bool

    var onClose: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(rankedItems.enumerated()), id: \.element.id) { index, item in
                            row(item: item, index: index)
                                .id(item.id)
                        }
                    }
                    .padding(.vertical, 8)
                }
                .onChange(of: selectedItemID) { id in
                    guard let id else { return }
                    proxy.scrollTo(id, anchor: .center)
                }
            }
        }
        .frame(width: 560, height: rankedItems.isEmpty ? 64 : 420)
        .background(theme.elevatedSurface.opacity(0.96), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(theme.separator.opacity(0.85), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityIdentifier("CommandPalette")
        .onAppear {
            docs = DriveTree.load(from: session.cacheRoot).files
                .filter { $0.isDocument && !$0.trashed }
            if let prefill = session.pendingPalettePrefill {
                query = prefill
                session.pendingPalettePrefill = nil
            }
            DispatchQueue.main.async {
                inputFocused = true
            }
        }
        .onChange(of: query) { _ in
            selectedIndex = 0
        }
        .onChange(of: rankedItems.map(\.id)) { ids in
            if ids.isEmpty {
                selectedIndex = 0
            } else {
                selectedIndex = min(selectedIndex, ids.count - 1)
            }
        }
        .onMoveCommand(perform: moveSelection)
        .onExitCommand(perform: onClose)
    }

    private var commandCatalog: [PaletteCommand] {
        let commands = PaletteCommand.allCases
        if session.activeAccount == nil {
            return [.signIn] + commands.filter { $0 != .signIn && $0 != .signOut }
        }
        return commands.filter { $0 != .signIn }
    }

    private var allItems: [PaletteItem] {
        commandCatalog.map(PaletteItem.command) + docs.map(PaletteItem.document)
    }

    private var rankedItems: [PaletteItem] {
        if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return emptyQueryItems
        }
        return FuzzySearcher.rank(
            allItems,
            query: query,
            labelForItem: { $0.label },
            keywordsForItem: { $0.keywords },
            limit: 30
        )
        .map(\.item)
    }

    private var emptyQueryItems: [PaletteItem] {
        let commandsById = Dictionary(uniqueKeysWithValues: commandCatalog.map { ($0.id, $0) })
        let recents = recentCommandIDs.prefix(10).compactMap { commandsById[$0] }
        if recents.isEmpty {
            return commandCatalog.map(PaletteItem.command)
        }
        return recents.map(PaletteItem.command)
    }

    private var recentCommandIDs: [String] {
        guard let data = recentIDsJSON.data(using: .utf8),
              let decoded = try? JSONDecoder().decode([String].self, from: data)
        else {
            return []
        }
        return decoded
    }

    private var selectedItemID: String? {
        guard rankedItems.indices.contains(selectedIndex) else { return nil }
        return rankedItems[selectedIndex].id
    }

    private var header: some View {
        HStack(spacing: 9) {
            Image(systemName: "command")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(theme.secondaryForeground)

            TextField("Run a command or jump to a doc — Drive, Diagnostics, Push…", text: $query)
                .textFieldStyle(.plain)
                .focused($inputFocused)
                .font(.melonPanUI(appUIFont))
                .onSubmit(executeSelectedOrFirst)
                .accessibilityIdentifier("CommandPaletteSearchField")

            if query.isEmpty {
                Text("⌘P")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(theme.secondaryForeground)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(
                        RoundedRectangle(cornerRadius: 5, style: .continuous)
                            .fill(theme.surface.opacity(0.9))
                    )
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
    }

    @ViewBuilder
    private func row(item: PaletteItem, index: Int) -> some View {
        let isSelected = selectedIndex == index
        let button = Button {
            execute(item)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: item.systemImage)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(theme.secondaryForeground)
                    .frame(width: 20)

                VStack(alignment: .leading, spacing: 2) {
                    Text(item.label)
                        .font(.melonPanUI(appUIFont, relativeSize: 1, weight: .medium))
                        .lineLimit(1)
                    Text(item.subtitle)
                        .font(.melonPanUI(appUIFont, relativeSize: -1))
                        .foregroundStyle(theme.secondaryForeground)
                        .lineLimit(1)
                }

                Spacer(minLength: 12)

                if !item.shortcut.isEmpty {
                    shortcutChip(item.shortcut)
                }
                if let numeric = numericShortcutLabel(for: index) {
                    shortcutChip(numeric)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(isSelected ? theme.selection.opacity(0.78) : Color.clear)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 8)
        .padding(.vertical, 1)
        .accessibilityLabel(item.label)
        .onHover { hovering in
            if hovering {
                selectedIndex = index
            }
        }

        if index < 10 {
            button.keyboardShortcut(numericKeyEquivalent(for: index), modifiers: [.command])
        } else {
            button
        }
    }

    private func shortcutChip(_ label: String) -> some View {
        Text(label)
            .font(.system(.caption2, design: .monospaced, weight: .medium))
            .foregroundStyle(theme.secondaryForeground)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background(
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(theme.surface.opacity(0.9))
            )
    }

    private func moveSelection(_ direction: MoveCommandDirection) {
        guard rankedItems.isEmpty == false else { return }
        switch direction {
        case .up:
            selectedIndex = max(0, selectedIndex - 1)
        case .down:
            selectedIndex = min(rankedItems.count - 1, selectedIndex + 1)
        default:
            break
        }
    }

    private func executeSelectedOrFirst() {
        guard let item = rankedItems[safe: selectedIndex] ?? rankedItems.first else {
            return
        }
        execute(item)
    }

    private func execute(_ item: PaletteItem) {
        recordRecent(item)
        onClose()
        Task { @MainActor in
            switch item {
            case .command(let command):
                execute(command)
            case .document(let document):
                session.openDocumentById(document.id)
            }
        }
    }

    private func execute(_ command: PaletteCommand) {
        switch command {
        case .openHome:
            session.activePane = .home
        case .openDrive:
            session.refreshDriveTree()
        case .openGraph:
            session.openUtilityWindow(.graph)
        case .openTemplates:
            session.openUtilityWindow(.templates)
        case .openConflicts:
            session.openUtilityWindow(.conflicts)
        case .openDiagnostics:
            session.openUtilityWindow(.diagnostics)
        case .openSettings:
            session.openUtilityWindow(.settings)
        case .newLocalDraft:
            session.newLocalDraft()
        case .newFromTemplate:
            session.openUtilityWindow(.templates)
        case .closeActiveTab:
            if let id = session.activeDocumentId {
                session.closeTab(id)
            }
        case .syncPush:
            session.runSync(.push)
        case .syncPull:
            session.runSync(.pull)
        case .syncDrain:
            session.runSync(.drain)
        case .signIn:
            session.showSignInSheet = true
        case .signOut:
            session.setActiveAccount(nil)
        case .showShortcutsHelp:
            session.showShortcutsHelp = true
        case .openCacheRootInFinder:
            NSWorkspace.shared.activateFileViewerSelecting([
                URL(fileURLWithPath: session.cacheRoot)
            ])
        case .refreshDriveTree:
            session.refreshDriveTree()
        }
    }

    private func recordRecent(_ item: PaletteItem) {
        guard case .command(let command) = item else { return }
        var ids = recentCommandIDs.filter { $0 != command.id }
        ids.insert(command.id, at: 0)
        ids = Array(ids.prefix(10))
        if let data = try? JSONEncoder().encode(ids),
           let json = String(data: data, encoding: .utf8) {
            recentIDsJSON = json
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
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
