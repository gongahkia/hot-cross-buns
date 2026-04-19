import SwiftUI

struct HelpView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationStack {
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
                        keyRow("⌘N", "Quick-add inside Hot Cross Buns")
                        keyRow("⌘⇧N", "New event")
                        keyRow("⌘⇧T", "New task with the detailed form")
                        bullet("Natural language in quick-add: 'email rent receipt tmr #personal' parses due date + list.")
                    }

                    section(title: "Navigation") {
                        keyRow("⌘1  ⌘2", "Jump to Calendar / Store")
                        keyRow("⌘,", "Open Settings window")
                        keyRow("⌘P  ⌘K", "Command palette — also searches tasks and events")
                        keyRow("⌘S", "Collapse sidebar to icons / expand")
                        keyRow("⌘I", "Toggle task inspector")
                        keyRow("⌘R", "Refresh sync")
                        keyRow("⌘⇧R", "Force full resync")
                        keyRow("⌘=  ⌘-  ⌘0", "Zoom in / out / reset")
                    }

                    section(title: "Store") {
                        bullet("Tasks, notes, smart filters, review-stale-lists, and saved custom filters all live here.")
                        bullet("Filter menu in the toolbar switches between All / Overdue / Today / Next 7 / No Date / Notes / Stale Lists / any saved custom filter.")
                        bullet("Notes = tasks without a due date that have notes body — Google Tasks' notes field is the backing store.")
                    }

                    section(title: "Calendar") {
                        keyRow("⌘←  ⌘→", "Previous / next period in the grid")
                        keyRow("⌘⌥←  ⌘⌥→", "Jump one larger period (month in week view, year in month)")
                        keyRow("⌘T", "Jump to today")
                        keyRow("⌘J", "Toggle schedule drawer in week view")
                        bullet("Drag a task from the drawer onto any day column to create a 60-minute event back-linked to the task.")
                        bullet("Drag an existing event to reschedule it (preserves duration, snaps to 15 min).")
                    }

                    section(title: "Task editor") {
                        keyRow("⌘↩", "Toggle complete")
                        keyRow("⌘⇧↩", "Save pending edits and close the inspector")
                        keyRow("⌘⌫", "Delete task (in inspector or Store selection)")
                        keyRow("⌘D", "Duplicate task")
                        keyRow("Tab / ⇧Tab", "Indent / outdent (subtask)")
                        bullet("Star a task with ⭐ — it shows as a real star emoji in Google Tasks everywhere.")
                        bullet("Add reminders, repeat rules, and guests right from the inspector.")
                    }

                    section(title: "Vim mode") {
                        if model.settings.enableVimKeybindings {
                            Text("Vim mode is enabled. Press **?** anywhere (outside text fields) to open the in-app cheatsheet overlay.")
                                .font(.callout)
                                .foregroundStyle(.secondary)
                        } else {
                            Text("Turn it on in Settings → Keyboard. Modal navigation: j/k move, gg/G jump, x complete, dd delete, : palette, / search. Text editors keep native macOS shortcuts.")
                                .font(.callout)
                                .foregroundStyle(.secondary)
                        }
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
                .padding(24)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .appBackground()
            .navigationTitle("Help")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .keyboardShortcut(.defaultAction)
                }
            }
        }
        .frame(minWidth: 640, idealWidth: 720, minHeight: 520, idealHeight: 620)
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: "checkmark.circle")
                .font(.system(size: 40))
                .foregroundStyle(AppColor.ember)
                .frame(width: 60, height: 60)
                .background(Circle().fill(AppColor.ember.opacity(0.12)))
            VStack(alignment: .leading, spacing: 4) {
                Text("Hot Cross Buns")
                    .font(.system(.largeTitle, design: .serif, weight: .bold))
                    .foregroundStyle(AppColor.ink)
                Text("A Mac-native planner on top of Google Tasks and Google Calendar.")
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private func section<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title.uppercased())
                .font(.caption.weight(.bold))
                .foregroundStyle(.secondary)
            content()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(.ultraThinMaterial)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(AppColor.cardStroke, lineWidth: 0.6)
        )
    }

    private func bullet(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text("•").foregroundStyle(.secondary)
            Text(.init(text))
                .font(.callout)
                .foregroundStyle(AppColor.ink)
            Spacer(minLength: 0)
        }
    }

    private func keyRow(_ keys: String, _ description: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(keys)
                .font(.system(.callout, design: .monospaced, weight: .semibold))
                .frame(width: 96, alignment: .leading)
            Text(description)
                .font(.callout)
                .foregroundStyle(AppColor.ink)
            Spacer(minLength: 0)
        }
    }
}
