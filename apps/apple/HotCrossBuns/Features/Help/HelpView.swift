import SwiftUI

struct HelpView: View {
    @Environment(AppModel.self) private var model
    @AppStorage(HCBShortcutStorage.userDefaultsKey) private var overridesJSON: String = "{}"
    @State private var searchText = ""

    private enum EntryKind {
        case bullet
        case shortcut(keys: String)
        case example(code: String)
    }

    private struct HelpEntry: Identifiable {
        let id = UUID()
        let title: String?
        let detail: String
        let kind: EntryKind

        func matches(_ query: String) -> Bool {
            guard query.isEmpty == false else { return true }
            let haystack = [
                title ?? "",
                detail,
                {
                    switch kind {
                    case .bullet:
                        return ""
                    case .shortcut(let keys):
                        return keys
                    case .example(let code):
                        return code
                    }
                }()
            ]
            .joined(separator: " ")
            .localizedCaseInsensitiveContains(query)
            return haystack
        }
    }

    private struct HelpSectionData: Identifiable {
        let title: String
        let entries: [HelpEntry]

        var id: String { title }
    }

    private func glyph(_ command: HCBShortcutCommand) -> String {
        let overrides = HCBShortcutStorage.decode(overridesJSON)
        return (overrides[command.rawValue] ?? command.defaultBinding).displayLabel
    }

    private var filteredSections: [HelpSectionData] {
        helpSections.compactMap { section in
            if searchText.isEmpty {
                return section
            }

            if section.title.localizedCaseInsensitiveContains(searchText) {
                return section
            }

            let matches = section.entries.filter { $0.matches(searchText) }
            guard matches.isEmpty == false else { return nil }
            return HelpSectionData(title: section.title, entries: matches)
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                header

                if filteredSections.isEmpty {
                    ContentUnavailableView(
                        "No Help Matches",
                        systemImage: "magnifyingglass",
                        description: Text("Try searching for sync, chords, deep links, notes, or quick-add.")
                    )
                    .frame(maxWidth: .infinity)
                    .hcbScaledPadding(.top, 40)
                } else {
                    ForEach(filteredSections) { section in
                        sectionView(section)
                    }
                }
            }
            .hcbScaledPadding(24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationTitle("Help")
        .searchable(text: $searchText, prompt: "Search help")
        .hcbSurface(.inspector)
        .id(model.settings.colorSchemeID)
        .withHCBAppearance(model.settings)
        .environment(\.hcbShortcutOverrides, model.settings.shortcutOverrides)
        .hcbPreferredColorScheme(model.settings)
        .appBackground()
        .hcbScaledFrame(minWidth: 700, idealWidth: 760, minHeight: 560, idealHeight: 700)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Hot Cross Buns")
                .hcbFont(.title3, weight: .semibold)
                .foregroundStyle(AppColor.ink)
            Text("A Mac-native planner on top of Google Tasks and Google Calendar.")
                .hcbFont(.subheadline)
                .foregroundStyle(.secondary)
        }
    }

    private var helpSections: [HelpSectionData] {
        [
            HelpSectionData(
                title: "What Hot Cross Buns Is",
                entries: [
                    .init(title: nil, detail: "A Mac-native client for Google Tasks and Google Calendar.", kind: .bullet),
                    .init(title: nil, detail: "Your data lives in Google. Edits in Gmail, the Calendar web UI, or your phone round-trip here.", kind: .bullet),
                    .init(title: nil, detail: "There's no separate backend. OAuth tokens stay in the Keychain. Disconnect in Settings to wipe local state.", kind: .bullet)
                ]
            ),
            HelpSectionData(
                title: "Capture",
                entries: [
                    .init(title: "Global quick-add from any app", detail: "Opens quick capture anywhere on your Mac.", kind: .shortcut(keys: "⌘⇧␣")),
                    .init(title: "New task", detail: "Natural-language task capture.", kind: .shortcut(keys: glyph(.newTask))),
                    .init(title: "New note", detail: "Natural-language note capture.", kind: .shortcut(keys: glyph(.newNote))),
                    .init(title: "New event", detail: "Natural-language event capture.", kind: .shortcut(keys: glyph(.newEvent))),
                    .init(title: nil, detail: "Task quick-add parses due-date aliases and list hints, eg. 'email rent receipt tmr #personal'.", kind: .bullet)
                ]
            ),
            HelpSectionData(
                title: "Navigation",
                entries: [
                    .init(title: "Jump to Calendar / Tasks", detail: "Switches the main sidebar surface immediately.", kind: .shortcut(keys: "\(glyph(.goToCalendar))  \(glyph(.goToStore))")),
                    .init(title: "Open Settings window", detail: "Detached macOS settings window.", kind: .shortcut(keys: glyph(.goToSettings))),
                    .init(title: "Command palette", detail: "Runs commands and searches tasks, notes, events, lists, calendars, and saved filters.", kind: .shortcut(keys: glyph(.commandPalette))),
                    .init(title: "Toggle task inspector", detail: "Shows or hides the read-only inspector surface.", kind: .shortcut(keys: glyph(.storeShowInspector))),
                    .init(title: "Refresh sync", detail: "Runs a foreground sync immediately.", kind: .shortcut(keys: glyph(.refresh))),
                    .init(title: "Force full resync", detail: "Clears checkpoints and refetches everything.", kind: .shortcut(keys: glyph(.forceResync))),
                    .init(title: "Zoom in / out / reset", detail: "Adjusts interface scale without changing data.", kind: .shortcut(keys: "\(glyph(.zoomIn))  \(glyph(.zoomOut))  \(glyph(.zoomReset))"))
                ]
            ),
            HelpSectionData(
                title: "Store",
                entries: [
                    .init(title: nil, detail: "Tasks, notes, smart filters, stale-list review, and saved custom filters all live here.", kind: .bullet),
                    .init(title: nil, detail: "The toolbar filter menu switches between All / Overdue / Today / Next 7 / No Date / Notes / Stale Lists / saved custom filters.", kind: .bullet),
                    .init(title: nil, detail: "Notes are undated tasks. They still sync through Google Tasks.", kind: .bullet)
                ]
            ),
            HelpSectionData(
                title: "Calendar",
                entries: [
                    .init(title: "Previous / next period", detail: "Moves the visible calendar range.", kind: .shortcut(keys: "\(glyph(.calendarPrevious))  \(glyph(.calendarNext))")),
                    .init(title: "Jump one larger period", detail: "Month in week view, year in month view.", kind: .shortcut(keys: "\(glyph(.calendarJumpBack))  \(glyph(.calendarJumpForward))")),
                    .init(title: "Jump to today", detail: "Returns to today in the active calendar mode.", kind: .shortcut(keys: glyph(.calendarToday))),
                    .init(title: "Go to date", detail: "Opens the date-jump sheet.", kind: .shortcut(keys: glyph(.calendarGoToDate))),
                    .init(title: "Focus search", detail: "Moves focus to the calendar search field.", kind: .shortcut(keys: glyph(.calendarFocusSearch))),
                    .init(title: "Toggle schedule drawer in week view", detail: "Shows or hides the week drawer.", kind: .shortcut(keys: "⌘J")),
                    .init(title: nil, detail: "Drag a task from the drawer onto a day column to create a 60-minute event back-linked to the task.", kind: .bullet),
                    .init(title: nil, detail: "Drag an existing event to reschedule it while preserving duration and 15-minute snapping.", kind: .bullet)
                ]
            ),
            HelpSectionData(
                title: "Task Editor",
                entries: [
                    .init(title: "Toggle complete", detail: "Marks the focused task complete or open.", kind: .shortcut(keys: glyph(.taskQuickSave))),
                    .init(title: "Save and close", detail: "Commits inspector edits and closes the sheet.", kind: .shortcut(keys: glyph(.taskSaveAndClose))),
                    .init(title: "Delete task", detail: "Deletes the focused task from the inspector or list selection.", kind: .shortcut(keys: glyph(.taskDelete))),
                    .init(title: "Duplicate task", detail: "Creates a copy of the current task.", kind: .shortcut(keys: glyph(.taskDuplicate))),
                    .init(title: "Indent / outdent", detail: "Adjusts subtask hierarchy.", kind: .shortcut(keys: "Tab / ⇧Tab")),
                    .init(title: nil, detail: "Adding ⭐ to a task title shows as a real star emoji in Google Tasks everywhere.", kind: .bullet),
                    .init(title: nil, detail: "Reminders, repeat rules, guests, and duplicate review all live in the inspector flow.", kind: .bullet)
                ]
            ),
            HelpSectionData(
                title: "Sync Behavior",
                entries: [
                    .init(title: nil, detail: "Creates appear instantly and show an icloud-slash glyph until Google accepts them.", kind: .bullet),
                    .init(title: nil, detail: "Updates send If-Match etags so conflicts can be reviewed instead of silently overwritten.", kind: .bullet),
                    .init(title: nil, detail: "Completed tasks show a short Undo toast at the bottom of the window.", kind: .bullet)
                ]
            ),
            HelpSectionData(
                title: "Chord System",
                entries: HCBChordRegistry.defaults.map { binding in
                    HelpEntry(
                        title: binding.hint,
                        detail: "Leader chords reuse the same command system as menus and shortcuts.",
                        kind: .shortcut(keys: chordDisplay(binding))
                    )
                }
            ),
            HelpSectionData(
                title: "Deep Links",
                entries: HCBDeepLinkRouter.helpRoutes.map { route in
                    HelpEntry(title: route.title, detail: route.summary, kind: .example(code: route.example))
                }
            ),
            HelpSectionData(
                title: "Quick-Add Grammar",
                entries: quickAddEntries
            ),
            HelpSectionData(
                title: "Troubleshooting",
                entries: [
                    .init(title: nil, detail: "Preview DMG blocked by macOS? Open Hot Cross Buns once, then go to System Settings > Privacy & Security and click Open Anyway.", kind: .bullet),
                    .init(title: nil, detail: "Preview DMGs do not auto-update in place. Install newer builds from the GitHub Releases page when one is published.", kind: .bullet),
                    .init(title: nil, detail: "Sign-in disabled? This build is missing Google sign-in credentials. Install an official release or use a configured local build.", kind: .bullet),
                    .init(title: nil, detail: "Stuck sync? Use Sync menu > Force Full Resync or open Sync Issues to inspect conflicts, invalid payloads, and deferred reminders.", kind: .bullet),
                    .init(title: nil, detail: "Something weird? Settings > Diagnostics and Recovery exports state and recent logs.", kind: .bullet)
                ]
            )
        ]
    }

    private var quickAddEntries: [HelpEntry] {
        let taskEntries = NaturalLanguageTaskParser.helpEntries.map { entry in
            HelpEntry(
                title: "Task quick-add: \(entry.title)",
                detail: entry.summary,
                kind: .example(code: entry.examples.joined(separator: "  ·  "))
            )
        }
        let eventEntries = NaturalLanguageEventParser.helpEntries.map { entry in
            HelpEntry(
                title: "Event quick-add: \(entry.title)",
                detail: entry.summary,
                kind: .example(code: entry.examples.joined(separator: "  ·  "))
            )
        }
        return taskEntries + eventEntries
    }

    private func chordDisplay(_ binding: HCBChordBinding) -> String {
        let tail = binding.sequence.map { $0.uppercased() }.joined(separator: " ")
        return "⌘K  \(tail)"
    }

    @ViewBuilder
    private func sectionView(_ section: HelpSectionData) -> some View {
        GroupBox(section.title) {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(section.entries) { entry in
                    entryView(entry)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private func entryView(_ entry: HelpEntry) -> some View {
        switch entry.kind {
        case .bullet:
            Text(.init("• \(entry.detail)"))
                .hcbFont(.callout)
                .foregroundStyle(AppColor.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
        case .shortcut(let keys):
            LabeledContent {
                Text(keys)
                    .font(.system(.callout, design: .monospaced, weight: .semibold))
                    .foregroundStyle(.secondary)
            } label: {
                VStack(alignment: .leading, spacing: 2) {
                    if let title = entry.title {
                        Text(title)
                            .hcbFont(.callout)
                            .foregroundStyle(AppColor.ink)
                    }
                    Text(entry.detail)
                        .hcbFont(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        case .example(let code):
            VStack(alignment: .leading, spacing: 4) {
                if let title = entry.title {
                    Text(title)
                        .hcbFont(.callout, weight: .semibold)
                        .foregroundStyle(AppColor.ink)
                }
                Text(code)
                    .font(.system(.caption, design: .monospaced, weight: .medium))
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                Text(entry.detail)
                    .hcbFont(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}
