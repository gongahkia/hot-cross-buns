import AppKit
import SwiftUI

struct HelpWindow: View {
    @StateObject private var model = HelpViewModel()
    @SceneStorage("help.selectedCategory") private var selection = HelpCategory.gettingStarted.id
    private let closesWindowOnExit: Bool

    init(closesWindowOnExit: Bool = true) {
        self.closesWindowOnExit = closesWindowOnExit
    }

    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                ForEach(HelpCategory.all) { category in
                    Label(category.title, systemImage: category.systemImage)
                        .tag(category.id)
                }
            }
            .listStyle(.sidebar)
            .frame(minWidth: 180)
        } detail: {
            if model.query.isEmpty {
                selectedCategoryView
            } else {
                HelpSearchResultsView(hits: model.searchHits()) { hit in
                    selection = hit.category.id
                    model.query = ""
                }
            }
        }
        .helpSearchField(model: model) {
            guard let first = model.searchHits().first else { return }
            selection = first.category.id
            model.query = ""
        }
        .frame(minWidth: 720, minHeight: 520)
        .task { await model.preload() }
        .onExitCommand {
            if model.query.isEmpty {
                if closesWindowOnExit {
                    NSApp.keyWindow?.close()
                }
            } else {
                model.query = ""
            }
        }
    }

    @ViewBuilder
    private var selectedCategoryView: some View {
        if let category = HelpCategory.all.first(where: { $0.id == selection }) {
            HelpCategoryView(category: category)
                .environmentObject(model)
        } else {
            HelpUnavailableView(title: "Pick a category", systemImage: "questionmark.circle")
        }
    }
}

struct HelpCategory: Identifiable, Hashable {
    let id: String
    let title: String
    let systemImage: String
    let markdownAsset: String
    let inlineShortcuts: [ShortcutEntry]

    static let gettingStarted = HelpCategory(id: "getting-started", title: "Getting Started", systemImage: "sparkles", markdownAsset: "getting-started", inlineShortcuts: [])
    static let shortcuts = HelpCategory(id: "shortcuts", title: "Keyboard Shortcuts", systemImage: "keyboard", markdownAsset: "shortcuts", inlineShortcuts: GlobalShortcuts.all)
    static let vim = HelpCategory(id: "vim", title: "Vim Mode", systemImage: "command", markdownAsset: "vim", inlineShortcuts: [])
    static let markdown = HelpCategory(id: "markdown", title: "Markdown Syntax", systemImage: "text.alignleft", markdownAsset: "markdown", inlineShortcuts: [])
    static let sync = HelpCategory(id: "sync", title: "Sync & Conflicts", systemImage: "arrow.triangle.2.circlepath", markdownAsset: "sync", inlineShortcuts: SyncShortcuts.all)
    static let drive = HelpCategory(id: "drive", title: "Drive", systemImage: "externaldrive", markdownAsset: "drive", inlineShortcuts: [])
    static let settings = HelpCategory(id: "settings", title: "Settings", systemImage: "gearshape", markdownAsset: "settings", inlineShortcuts: [])
    static let troubleshooting = HelpCategory(id: "troubleshooting", title: "Troubleshooting", systemImage: "stethoscope", markdownAsset: "troubleshooting", inlineShortcuts: [])

    static let all: [HelpCategory] = [
        .gettingStarted,
        .shortcuts,
        .vim,
        .markdown,
        .sync,
        .drive,
        .settings,
        .troubleshooting
    ]
}

struct ShortcutEntry: Identifiable, Hashable {
    let id = UUID()
    let command: String
    let chord: String
    let description: String
}

enum GlobalShortcuts {
    static let all: [ShortcutEntry] = [
        ShortcutEntry(command: "Open command palette", chord: "⌘P", description: "Search commands, panes, documents, and sync actions."),
        ShortcutEntry(command: "New local draft", chord: "⌘N", description: "Create a new Markdown draft in the editor workspace."),
        ShortcutEntry(command: "Close active tab", chord: "⌘W", description: "Close the focused editor tab."),
        ShortcutEntry(command: "Switch panes", chord: "⌘1...⌘5", description: "Jump to Home, Drive, Conflicts, Diagnostics, or Settings."),
        ShortcutEntry(command: "Open Settings window", chord: "⌘,", description: "Open the macOS Settings scene."),
        ShortcutEntry(command: "Open Help window", chord: "⌘?", description: "Open this searchable reference."),
        ShortcutEntry(command: "Open History window", chord: "⌥⌘Y", description: "Open the sync history and snapshot recovery window.")
    ]
}

enum SyncShortcuts {
    static let all: [ShortcutEntry] = [
        ShortcutEntry(command: "Pull document", chord: "⌘R", description: "Re-fetch the current document or Drive tree state."),
        ShortcutEntry(command: "Push document", chord: "⌥⌘R", description: "Send queued editor changes to Google Docs."),
        ShortcutEntry(command: "Drain queue", chord: "⇧⌘R", description: "Replay pending sync mutations and surface conflicts.")
    ]
}

struct HelpSearchHit: Identifiable, Hashable {
    let id = UUID()
    let category: HelpCategory
    let snippet: String
}

private struct HelpSearchResultsView: View {
    let hits: [HelpSearchHit]
    let onSelect: (HelpSearchHit) -> Void

    var body: some View {
        Group {
            if hits.isEmpty {
                HelpUnavailableView(
                    title: "No Help Matches",
                    systemImage: "magnifyingglass",
                    description: "Try searching for palette, yank, conflict, drive, or ⌘N."
                )
            } else {
                List(hits) { hit in
                    Button {
                        onSelect(hit)
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(hit.category.title)
                                .font(.callout.weight(.semibold))
                            Text(hit.snippet)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 4)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .navigationTitle("Search")
    }
}

private struct HelpUnavailableView: View {
    let title: String
    let systemImage: String
    var description: String?

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: systemImage)
                .font(.system(size: 34, weight: .semibold))
                .foregroundStyle(.secondary)
            Text(title)
                .font(.title3)
                .fontWeight(.semibold)
            if let description {
                Text(description)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
