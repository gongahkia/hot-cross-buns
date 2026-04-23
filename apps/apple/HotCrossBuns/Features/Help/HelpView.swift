import SwiftUI

struct HelpView: View {
    @Environment(AppModel.self) private var model
    // single source of truth: read live overrides so doc reflects user binds
    @AppStorage(HCBShortcutStorage.userDefaultsKey) private var overridesJSON: String = "{}"

    private func glyph(_ command: HCBShortcutCommand) -> String {
        let overrides = HCBShortcutStorage.decode(overridesJSON)
        return (overrides[command.rawValue] ?? command.defaultBinding).displayLabel
    }

    var body: some View {
        ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    header

                    section(title: "What Hot Cross Buns is") {
                        bullet("A Mac-native client for Google Tasks and Google Calendar.")
                        bullet("Your data lives in Google. Edits in Gmail, the Calendar web UI, or your phone round-trip here.")
                        bullet("There's no separate backend. OAuth tokens stay in the Keychain. Disconnect in Settings to wipe local state.")
                    }

                    section(title: "Capture") {
                        keyRow("⌘⇧␣", "Global quick-add from any app")
                        keyRow(glyph(.newTask), "New task")
                        keyRow(glyph(.newNote), "New note")
                        keyRow(glyph(.newEvent), "New event")
                        bullet("Natural language in quick-add: 'email rent receipt tmr #personal' parses due date + list.")
                    }

                    section(title: "Navigation") {
                        keyRow("\(glyph(.goToCalendar))  \(glyph(.goToStore))", "Jump to Calendar / Tasks")
                        keyRow(glyph(.goToSettings), "Open Settings window")
                        keyRow(glyph(.commandPalette), "Command palette — also searches tasks and events")
                        bullet("Use the toolbar sidebar button or the View menu to show or hide the sidebar.")
                        keyRow(glyph(.storeShowInspector), "Toggle task inspector")
                        keyRow(glyph(.refresh), "Refresh sync")
                        keyRow(glyph(.forceResync), "Force full resync")
                        keyRow("\(glyph(.zoomIn))  \(glyph(.zoomOut))  \(glyph(.zoomReset))", "Zoom in / out / reset")
                    }

                    section(title: "Store") {
                        bullet("Tasks, notes, smart filters, review-stale-lists, and saved custom filters all live here.")
                        bullet("Filter menu in the toolbar switches between All / Overdue / Today / Next 7 / No Date / Notes / Stale Lists / any saved custom filter.")
                        bullet("Notes = tasks without a due date that have notes body — Google Tasks' notes field is the backing store.")
                    }

                    section(title: "Calendar") {
                        keyRow("\(glyph(.calendarPrevious))  \(glyph(.calendarNext))", "Previous / next period in the grid")
                        keyRow("\(glyph(.calendarJumpBack))  \(glyph(.calendarJumpForward))", "Jump one larger period (month in week view, year in month)")
                        keyRow(glyph(.calendarToday), "Jump to today")
                        keyRow(glyph(.calendarGoToDate), "Go to a specific date")
                        keyRow(glyph(.calendarFocusSearch), "Focus the event filter field in the toolbar")
                        keyRow("⌘J", "Toggle schedule drawer in week view")
                        bullet("Drag a task from the drawer onto any day column to create a 60-minute event back-linked to the task.")
                        bullet("Drag an existing event to reschedule it (preserves duration, snaps to 15 min).")
                    }

                    section(title: "Task editor") {
                        keyRow(glyph(.taskQuickSave), "Toggle complete")
                        keyRow(glyph(.taskSaveAndClose), "Save pending edits and close the inspector")
                        keyRow(glyph(.taskDelete), "Delete task (in inspector or Store selection)")
                        keyRow(glyph(.taskDuplicate), "Duplicate task")
                        keyRow("Tab / ⇧Tab", "Indent / outdent (subtask)")
                        bullet("Star a task with ⭐ — it shows as a real star emoji in Google Tasks everywhere.")
                        bullet("Add reminders, repeat rules, and guests right from the inspector.")
                    }

                    section(title: "Sync behavior") {
                        bullet("Creates appear instantly (optimistic) and show an icloud-slash glyph until Google accepts them.")
                        bullet("Updates send If-Match etags — if Google rejects as out-of-date, HCB refreshes so you see the winning state before retrying.")
                        bullet("Completed tasks show a 5-second Undo toast at the bottom of the window.")
                    }

                    section(title: "Troubleshooting") {
                        bullet("Sign-in disabled? The OAuth client ID isn't provisioned — see `apps/apple/Configuration/GoogleOAuth.example.xcconfig`.")
                        bullet("Stuck sync? Sync menu → Force Full Resync clears all checkpoints and refetches.")
                        bullet("Something weird? Settings → Diagnostics and Recovery dumps state and lets you wipe cache.")
                    }
                }
                .hcbScaledPadding(24)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        .navigationTitle("Help")
        .hcbSurface(.inspector)
        .id(model.settings.colorSchemeID)
        .withHCBAppearance(model.settings)
        .environment(\.hcbShortcutOverrides, model.settings.shortcutOverrides)
        .preferredColorScheme(HCBColorScheme.scheme(id: model.settings.colorSchemeID)?.isDark == true ? .dark : .light)
        .appBackground()
        .hcbScaledFrame(minWidth: 640, idealWidth: 720, minHeight: 520, idealHeight: 620)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Hot Cross Buns")
                .hcbFont(.title3, weight: .semibold)
                .foregroundStyle(AppColor.ink)
            Text("A Mac-native planner on top of Google Tasks and Google Calendar.")
                .hcbFont(.subheadline)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func section<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        GroupBox(title) {
            VStack(alignment: .leading, spacing: 10) {
                content()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func bullet(_ text: String) -> some View {
        Text(.init("• \(text)"))
            .hcbFont(.callout)
            .foregroundStyle(AppColor.ink)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func keyRow(_ keys: String, _ description: String) -> some View {
        LabeledContent {
            Text(keys)
                .font(.system(.callout, design: .monospaced, weight: .semibold))
                .foregroundStyle(.secondary)
        } label: {
            Text(description)
                .hcbFont(.callout)
                .foregroundStyle(AppColor.ink)
        }
    }
}
