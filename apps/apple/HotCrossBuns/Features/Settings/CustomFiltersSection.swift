import SwiftUI

// TODO: prune — dead after the Calendar/Tasks/Notes sidebar refactor.
// The Tasks toolbar filter menu that surfaced saved custom filters was
// removed. This section still edits AppSettings.customFilters and the
// MenuBarExtra still pins them, but there's no in-app way to view the
// result of a filter. Either drop the section + AppSettings.customFilters
// + CustomFilterDefinition + the MenuBar integration, or reroute filters
// into a new Tasks-tab surface before deleting.

struct CustomFiltersSection: View {
    @Environment(AppModel.self) private var model
    @State private var editor: CustomFilterDefinition?
    @State private var isCreating = false

    var body: some View {
        Section("Custom Filters") {
            if model.settings.customFilters.isEmpty {
                Text("No custom filters yet. Save a combination of due-window, list, star, and tag criteria — or a full DSL query — as a reusable sidebar entry.")
                    .hcbFont(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(model.settings.customFilters) { filter in
                    Button {
                        editor = filter
                    } label: {
                        HStack {
                            Label(filter.name, systemImage: filter.systemImage)
                            Spacer()
                            if queryHasError(filter) {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .foregroundStyle(.orange)
                                    .help("Query has an error — open to fix.")
                            }
                            Text(summary(filter))
                                .hcbFont(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .buttonStyle(.plain)
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) {
                            model.deleteCustomFilter(filter.id)
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                    .contextMenu {
                        Button {
                            editor = filter
                        } label: {
                            Label("Edit", systemImage: "pencil")
                        }
                        Divider()
                        Button(role: .destructive) {
                            model.deleteCustomFilter(filter.id)
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                }
            }

            Button {
                isCreating = true
            } label: {
                Label("New Filter", systemImage: "plus")
            }
        }
        .sheet(isPresented: $isCreating) {
            CustomFilterEditor(draft: CustomFilterDefinition(name: "New Filter"), onSave: { filter in
                model.upsertCustomFilter(filter)
                isCreating = false
            }, onCancel: { isCreating = false })
        }
        .sheet(item: $editor) { filter in
            CustomFilterEditor(draft: filter, onSave: { updated in
                model.upsertCustomFilter(updated)
                editor = nil
            }, onCancel: { editor = nil })
        }
    }

    private func queryHasError(_ filter: CustomFilterDefinition) -> Bool {
        guard filter.isUsingQueryDSL, let expr = filter.queryExpression else { return false }
        if case .failure = QueryCompiler.compile(expr) { return true }
        return false
    }

    private func summary(_ filter: CustomFilterDefinition) -> String {
        if filter.isUsingQueryDSL {
            return "DSL"
        }
        var parts: [String] = [filter.dueWindow.title]
        if filter.includeCompleted { parts.append("+ completed") }
        if filter.taskListIDs.isEmpty == false { parts.append("\(filter.taskListIDs.count) lists") }
        if filter.tagsAny.isEmpty == false { parts.append(filter.tagsAny.map { "#\($0)" }.joined(separator: " ")) }
        return parts.joined(separator: " · ")
    }
}

private struct CustomFilterEditor: View {
    @Environment(AppModel.self) private var model
    @State var draft: CustomFilterDefinition
    @State private var tagsText: String
    @State private var queryText: String
    let onSave: (CustomFilterDefinition) -> Void
    let onCancel: () -> Void

    init(draft: CustomFilterDefinition, onSave: @escaping (CustomFilterDefinition) -> Void, onCancel: @escaping () -> Void) {
        _draft = State(initialValue: draft)
        _tagsText = State(initialValue: draft.tagsAny.joined(separator: " "))
        _queryText = State(initialValue: draft.queryExpression ?? "")
        self.onSave = onSave
        self.onCancel = onCancel
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        SettingsSheetSection("Filter") {
                            SettingsSheetRow("Name") {
                                TextField("", text: $draft.name)
                                    .textFieldStyle(.roundedBorder)
                            }
                            SettingsSheetRow("SF Symbol") {
                                TextField("", text: $draft.systemImage)
                                    .font(.body.monospaced())
                                    .textFieldStyle(.roundedBorder)
                            }
                            SettingsSheetRow("") {
                                Toggle("Pin to menu bar", isOn: $draft.pinnedToMenuBar)
                                    .toggleStyle(.checkbox)
                            }
                        }

                    if draft.pinnedToMenuBar {
                        Text("Appears as a section in the menu-bar popover with a match count and a short preview.")
                            .hcbFont(.caption2)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                        SettingsSheetSection("Query (advanced)") {
                            TextEditor(text: $queryText)
                                .font(.body.monospaced())
                                .frame(minHeight: 120)
                                .scrollContentBackground(.hidden)
                                .background(AppColor.cardSurface)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 6)
                                        .strokeBorder(borderColor, lineWidth: 0.5)
                                )
                            queryStatusRow
                            DisclosureGroup("DSL cheatsheet") {
                                VStack(alignment: .leading, spacing: 4) {
                                    cheat("title:bug",         "task title contains 'bug'")
                                    cheat("notes:\"grocery\"", "notes contain 'grocery' (quoted for spaces)")
                                    cheat("list:Work",         "task belongs to list matching 'Work' (by title or id)")
                                    cheat("tag:deep",          "task has #deep tag")
                                    cheat("#deep",             "same as tag:deep")
                                    cheat("completed",         "task is completed")
                                    cheat("overdue",           "due date is before today")
                                    cheat("has:notes",         "notes field non-empty")
                                    cheat("has:due",           "due date set")
                                    cheat("has:tag",           "any tag present")
                                    cheat("due:today",         "due today")
                                    cheat("due<+7d",           "due within the next 7 days")
                                    cheat("due>=2026-01-01",   "due on or after an absolute date")
                                    cheat("not completed",     "NOT completed")
                                    cheat("A AND B",           "both; whitespace also implies AND")
                                    cheat("A OR B",            "either")
                                    cheat("(A OR B) AND C",    "parentheses group precedence")
                                }
                                .hcbFont(.caption)
                                .foregroundStyle(.secondary)
                            }
                            Text("When the query field is non-empty, the fields below are ignored. Invalid queries match nothing — your tasks aren't modified.")
                                .hcbFont(.footnote)
                                .foregroundStyle(.secondary)
                        }

                        SettingsSheetSection("Due") {
                            SettingsSheetRow("Due window") {
                                Picker("", selection: $draft.dueWindow) {
                                    ForEach(DueWindow.allCases, id: \.self) { window in
                                        Text(window.title).tag(window)
                                    }
                                }
                                .labelsHidden()
                                .frame(maxWidth: 260, alignment: .leading)
                            }
                            .disabled(usingDSL)
                        }

                        SettingsSheetSection("Qualifiers") {
                            Toggle("Include completed", isOn: $draft.includeCompleted)
                                .toggleStyle(.checkbox)
                        }
                        .disabled(usingDSL)
                        if usingDSL {
                            Text("Structured fields are disabled while the query field is non-empty.")
                                .hcbFont(.caption2)
                                .foregroundStyle(.secondary)
                        }

                        SettingsSheetSection("Lists") {
                            Text("Leave empty to match every list.")
                                .hcbFont(.caption2)
                                .foregroundStyle(.secondary)
                            VStack(alignment: .leading, spacing: 8) {
                                ForEach(model.taskLists) { list in
                                    Toggle(list.title, isOn: Binding(
                                        get: { draft.taskListIDs.contains(list.id) },
                                        set: { isOn in
                                            if isOn { draft.taskListIDs.insert(list.id) }
                                            else { draft.taskListIDs.remove(list.id) }
                                        }
                                    ))
                                    .toggleStyle(.checkbox)
                                }
                            }
                        }
                        .disabled(usingDSL)

                        SettingsSheetSection("Tags") {
                            SettingsSheetRow("Any match") {
                                TextField("#work #urgent", text: $tagsText)
                                    .textFieldStyle(.roundedBorder)
                            }
                        }
                        .disabled(usingDSL)
                    }
                    .padding(24)
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                }

                Divider()

                SettingsSheetActions(cancelTitle: "Cancel", onCancel: onCancel) {
                    Button("Save") {
                        var out = draft
                        out.tagsAny = tagsText
                            .split(whereSeparator: { $0.isWhitespace })
                            .map { String($0).trimmingCharacters(in: CharacterSet(charactersIn: "#")) }
                            .filter { $0.isEmpty == false }
                        let trimmedQuery = queryText.trimmingCharacters(in: .whitespacesAndNewlines)
                        out.queryExpression = trimmedQuery.isEmpty ? nil : trimmedQuery
                        onSave(out)
                    }
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
                    .disabled(saveDisabled)
                }
            }
            .navigationTitle("Filter")
        }
        .frame(width: 720, height: 720)
    }

    private var usingDSL: Bool {
        queryText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
    }

    private var compileResult: Result<CompiledQuery, QueryCompileError>? {
        let trimmed = queryText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false else { return nil }
        return QueryCompiler.compile(queryText)
    }

    private var borderColor: Color {
        if case .failure = compileResult { return .orange }
        return .secondary.opacity(0.25)
    }

    @ViewBuilder
    private var queryStatusRow: some View {
        switch compileResult {
        case .none:
            Text("Leave empty to use the structured fields below.")
                .hcbFont(.footnote)
                .foregroundStyle(.secondary)
        case .failure(let err):
            HStack(alignment: .top, spacing: 6) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                Text(errorText(err))
                    .hcbFont(.footnote)
                    .foregroundStyle(.orange)
            }
        case .success(let q):
            let count = matchCount(for: q)
            HStack(spacing: 6) {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                Text("Valid · \(count) task\(count == 1 ? "" : "s") match now")
                    .hcbFont(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func matchCount(for q: CompiledQuery) -> Int {
        let ctx = QueryContext(now: Date(), calendar: .current, taskLists: model.taskLists)
        var count = 0
        for task in model.tasks where task.isDeleted == false {
            if q.matches(task, context: ctx) { count += 1 }
        }
        return count
    }

    private func errorText(_ err: QueryCompileError) -> String {
        if err.position >= 0 {
            return "\(err.message) (at char \(err.position + 1))"
        }
        return err.message
    }

    private var saveDisabled: Bool {
        if draft.name.trimmingCharacters(in: .whitespaces).isEmpty { return true }
        // Block save on a broken DSL — we never want to persist a filter that
        // the sidebar will immediately render as an error row.
        if case .failure = compileResult { return true }
        return false
    }

    @ViewBuilder
    private func cheat(_ code: String, _ desc: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text(code)
                .font(.caption.monospaced())
                .foregroundStyle(AppColor.ink)
                .frame(minWidth: 140, alignment: .leading)
            Text(desc)
                .foregroundStyle(.secondary)
            Spacer(minLength: 0)
        }
    }
}

struct SettingsSheetSection<Content: View>: View {
    private let title: String
    @ViewBuilder private let content: Content

    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .hcbFont(.headline, weight: .semibold)
                .foregroundStyle(AppColor.ink)
            VStack(alignment: .leading, spacing: 10) {
                content
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct SettingsSheetRow<Content: View>: View {
    private let title: String
    @ViewBuilder private let content: Content

    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Text(title)
                .hcbFont(.body, weight: .semibold)
                .foregroundStyle(title.isEmpty ? .clear : .secondary)
                .frame(width: 150, alignment: .trailing)
                .accessibilityHidden(title.isEmpty)
            content
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct SettingsSheetActions<Content: View>: View {
    let cancelTitle: String
    let onCancel: () -> Void
    @ViewBuilder let content: Content

    init(cancelTitle: String, onCancel: @escaping () -> Void, @ViewBuilder content: () -> Content) {
        self.cancelTitle = cancelTitle
        self.onCancel = onCancel
        self.content = content()
    }

    var body: some View {
        HStack(spacing: 12) {
            Spacer()
            Button(cancelTitle, action: onCancel)
                .keyboardShortcut(.cancelAction)
            content
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 16)
        .background(.bar)
    }
}
