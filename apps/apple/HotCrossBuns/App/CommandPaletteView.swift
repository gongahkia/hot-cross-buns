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

// Merged palette — runs commands *and* jumps to tasks / notes / events /
// lists / calendars / saved filters in a single surface. Previously split
// into CommandPaletteView (do) and QuickSwitcherView (go) under ⌘P / ⌘O;
// unified here behind ⌘P so there's one muscle-memory entry point. Free-
// text matches rank commands and entities together by fuzzy score. Field
// operators (title:, tag:, list:, kind:, has:, attendee:, calendar:,
// /regex/) suppress commands — when the user is clearly searching
// entities, don't clutter the result set with command hits.
//
// Notes vs tasks: a note is a TaskMirror with dueDate == nil. Kind labels
// and icons discriminate in the row, and `kind:note` / `kind:task` in the
// DSL filters to one or the other.

enum QuickSwitcherEntity: Hashable, Identifiable {
    case task(TaskMirror)
    case event(CalendarEventMirror)
    case taskList(TaskListMirror)
    case calendar(CalendarListMirror)
    case customFilter(CustomFilterDefinition)

    var id: String {
        switch self {
        case .task(let t): return "task-\(t.id)"
        case .event(let e): return "event-\(e.id)"
        case .taskList(let l): return "list-\(l.id)"
        case .calendar(let c): return "cal-\(c.id)"
        case .customFilter(let f): return "cf-\(f.id.uuidString)"
        }
    }

    fileprivate var label: String {
        switch self {
        case .task(let t): return TagExtractor.stripped(from: t.title)
        case .event(let e): return e.summary
        case .taskList(let l): return l.title
        case .calendar(let c): return c.summary
        case .customFilter(let f): return f.name
        }
    }

    fileprivate var keywords: [String] {
        switch self {
        case .task(let t):
            return TagExtractor.tags(in: t.title) + [t.notes]
        case .event(let e):
            return [e.details, e.location]
        case .taskList, .calendar: return []
        case .customFilter(let f): return f.queryExpression.map { [$0] } ?? []
        }
    }

    // Task vs Note is a display-only distinction (both are TaskMirror on
    // Google's side). Undated tasks read as notes everywhere else in the
    // product, so the palette follows suit.
    fileprivate var kindLabel: String {
        switch self {
        case .task(let t): return t.dueDate == nil ? "Note" : "Task"
        case .event: return "Event"
        case .taskList: return "List"
        case .calendar: return "Calendar"
        case .customFilter: return "Filter"
        }
    }

    fileprivate var symbol: String {
        switch self {
        case .task(let t):
            if t.dueDate == nil { return "note.text" }
            return t.isCompleted ? "checkmark.circle.fill" : "circle"
        case .event: return "calendar"
        case .taskList: return "checklist"
        case .calendar: return "calendar.badge.clock"
        case .customFilter(let f): return f.systemImage
        }
    }
}

// Union type backing the merged ranked list. Commands and entities share
// a row renderer + numeric-shortcut handling so the UX is uniform.
fileprivate enum PaletteItem: Identifiable {
    case command(CommandPaletteCommand)
    case entity(QuickSwitcherEntity)

    var id: String {
        switch self {
        case .command(let c): return "cmd-\(c.id)"
        case .entity(let e): return "ent-\(e.id)"
        }
    }

    var rankLabel: String {
        switch self {
        case .command(let c): return c.title
        case .entity(let e): return e.label
        }
    }

    var rankKeywords: [String] {
        switch self {
        case .command(let c): return [c.subtitle] + c.keywords
        case .entity(let e): return e.keywords
        }
    }
}

struct CommandPaletteView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model
    @State private var query = ""
    // Debounced view of `query`. Rebuilt 150ms after the user stops typing
    // so a typing burst doesn't run the rank pipeline on every keystroke.
    @State private var debouncedQuery = ""
    // Snapshot of the entity universe, built once and refreshed only when
    // model.tasks / events / taskLists / calendars / customFilters counts
    // change. Avoids re-allocating ~17k QuickSwitcherEntity values on every
    // render. The cheap snapshotKey check makes the refresh free in the
    // common (no-data-change) case.
    @State private var cachedEntities: [QuickSwitcherEntity] = []
    // Parallel lowercased label cache for the cheap substring pre-filter.
    // Same indices as cachedEntities. Lowercasing 17k strings once on
    // build is cheap; doing it per-keystroke for every match was the
    // hottest cost after entity rebuild.
    @State private var cachedLowercaseLabels: [String] = []
    @State private var entitiesSnapshotKey: String = ""
    @FocusState private var isSearchFocused: Bool

    let commands: [CommandPaletteCommand]
    let onSelectEntity: (QuickSwitcherEntity) -> Void

    var body: some View {
        VStack(spacing: 0) {
            searchHeader

            if trimmedQuery.isEmpty == false {
                Divider().overlay(.secondary.opacity(0.25))

                ScrollView {
                    LazyVStack(spacing: 0) {
                        if rankedItems.isEmpty {
                            emptyState
                        } else {
                            ForEach(Array(rankedItems.enumerated()), id: \.element.id) { index, item in
                                rowButton(item: item, index: index)
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
                debouncedQuery = staged
                model.pendingPaletteQuery = nil
            }
            isSearchFocused = true
            rebuildCachedEntitiesIfNeeded()
        }
        .onChange(of: snapshotKey) { _, _ in
            rebuildCachedEntitiesIfNeeded()
        }
        // 150ms debounce: each keystroke restarts this task; only the final
        // sleep that completes uncancelled writes through to debouncedQuery.
        .task(id: query) {
            do {
                try await Task.sleep(for: .milliseconds(150))
                debouncedQuery = query
            } catch {
                // task cancelled by next keystroke — drop, the next one runs.
            }
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
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(.ultraThinMaterial) // Alfred-style translucent vibrancy
        }
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .presentationBackground(.clear)
        .hcbScaledPadding(14)
    }

    private var trimmedQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var debouncedTrimmedQuery: String {
        debouncedQuery.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // Cheap fingerprint for the entity universe. Concat of the counts that
    // determine cachedEntities. When this changes (e.g., a sync brings in
    // new events), the cache is rebuilt; otherwise the cache stays warm
    // across body re-evaluations and keystrokes.
    private var snapshotKey: String {
        "\(model.tasks.count)|\(model.events.count)|\(model.taskLists.count)|\(model.calendars.count)|\(model.settings.customFilters.count)"
    }

    private func rebuildCachedEntitiesIfNeeded() {
        let key = snapshotKey
        guard key != entitiesSnapshotKey else { return }
        entitiesSnapshotKey = key
        var out: [QuickSwitcherEntity] = []
        out.reserveCapacity(model.tasks.count + model.events.count + 32)
        for t in model.tasks where t.isDeleted == false { out.append(.task(t)) }
        for e in model.events where e.status != .cancelled { out.append(.event(e)) }
        for l in model.taskLists { out.append(.taskList(l)) }
        for c in model.calendars { out.append(.calendar(c)) }
        for f in model.settings.customFilters { out.append(.customFilter(f)) }
        cachedEntities = out
        cachedLowercaseLabels = out.map { $0.label.lowercased() }
    }

    // Merged ranked list. Behaviour:
    //   - Regex mode (/…/): entity-only regex filter, no commands.
    //   - Field-operator query with no free-text: entity-only structured
    //     filter, alphabetic, no commands. Keeps power-user DSL output stable.
    //   - Free-text (with or without operators): rank commands + entities
    //     together by fuzzy score; commands bubble up when the title matches.
    private var rankedItems: [PaletteItem] {
        rank(forQuery: debouncedTrimmedQuery)
    }

    // Pure rank pipeline. The computed `rankedItems` reads it with
    // debouncedTrimmedQuery; executeFirstMatch reads it with trimmedQuery
    // so Enter-immediately-after-typing doesn't pick a stale top match
    // from the previous debounce window.
    private func rank(forQuery q: String) -> [PaletteItem] {
        guard q.isEmpty == false else { return [] }
        let parsed = AdvancedSearchParser.parse(q)

        if let pattern = parsed.regex {
            return cachedEntities
                .filter { AdvancedSearchMatcher.regexMatches($0, regexPattern: pattern) }
                .prefix(30)
                .map { PaletteItem.entity($0) }
        }

        let freeText = parsed.freeText.trimmingCharacters(in: .whitespacesAndNewlines)
        let hasStructuredFilters = parsed != .empty && (
            parsed.regex != nil
            || parsed.titleContains.isEmpty == false
            || parsed.tagsAll.isEmpty == false
            || parsed.listMatch != nil
            || parsed.calendarMatch != nil
            || parsed.attendeeMatch != nil
            || parsed.kind != nil
            || parsed.requireNotes
            || parsed.requireLocation
            || parsed.requireDue
            || parsed.requireCompleted
            || parsed.requireOverdue
        )

        // If the user is clearly entity-searching (field operators / bare
        // keywords present), suppress commands so the list stays focused.
        let includeCommands = hasStructuredFilters == false || hasFreeTextOnly(parsed)

        // Pre-filter pool. The hot path here is free-text without structured
        // filters: walk cachedLowercaseLabels (one .contains per item) to
        // shrink the pool from ~17k to typically <500 BEFORE the heavier
        // AdvancedSearchMatcher / FuzzySearcher passes. Structured filters
        // skip this fast path and use the full matcher (correctness first).
        let entitiesFiltered: [QuickSwitcherEntity]
        if hasStructuredFilters {
            entitiesFiltered = cachedEntities.filter {
                AdvancedSearchMatcher.matches(
                    $0,
                    query: parsed,
                    calendars: model.calendars,
                    taskLists: model.taskLists
                )
            }
        } else if freeText.count >= 2 {
            let lowered = freeText.lowercased()
            var hits: [QuickSwitcherEntity] = []
            hits.reserveCapacity(min(cachedEntities.count, 500))
            for (idx, lowerLabel) in cachedLowercaseLabels.enumerated() {
                if lowerLabel.contains(lowered) {
                    hits.append(cachedEntities[idx])
                    if hits.count >= 500 { break }
                }
            }
            entitiesFiltered = hits
        } else {
            // Single-char query — substring matching across 17k entities is
            // too noisy. Restrict to the small, stable surface (lists,
            // calendars, custom filters) so the palette stays useful.
            entitiesFiltered = cachedEntities.filter {
                switch $0 {
                case .taskList, .calendar, .customFilter: return true
                case .task, .event: return false
                }
            }
        }

        if freeText.isEmpty {
            // Operator-only query — alphabetic by label, entity-only.
            return entitiesFiltered
                .sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
                .prefix(30)
                .map { PaletteItem.entity($0) }
        }

        var pool: [PaletteItem] = []
        pool.reserveCapacity(entitiesFiltered.count + commands.count)
        pool.append(contentsOf: entitiesFiltered.map(PaletteItem.entity))
        if includeCommands {
            pool.append(contentsOf: commands.map(PaletteItem.command))
        }

        let ranked = FuzzySearcher.rank(
            pool,
            query: freeText,
            labelForItem: { $0.rankLabel },
            keywordsForItem: { $0.rankKeywords },
            limit: 50
        )
        return ranked.map(\.item)
    }

    // True when the parsed query carries only free text (no field operators
    // / bare keywords / regex). Drives the "should I include commands?"
    // decision — entity-filter-heavy queries suppress commands so the list
    // isn't noisy.
    private func hasFreeTextOnly(_ q: AdvancedSearchQuery) -> Bool {
        q.regex == nil
            && q.titleContains.isEmpty
            && q.tagsAll.isEmpty
            && q.listMatch == nil
            && q.calendarMatch == nil
            && q.attendeeMatch == nil
            && q.kind == nil
            && q.requireNotes == false
            && q.requireLocation == false
            && q.requireDue == false
            && q.requireCompleted == false
            && q.requireOverdue == false
    }

    private func executeFirstMatch() {
        // Bypass the debounced view — Enter is an explicit confirm and
        // should act on what the user just typed, not what was visible
        // 150ms ago.
        if let first = rank(forQuery: trimmedQuery).first {
            select(first)
        }
    }

    private func select(_ item: PaletteItem) {
        dismiss()
        // Defer execution so sheet dismissal animation doesn't fight
        // downstream navigation / sheet presentation.
        DispatchQueue.main.async {
            switch item {
            case .command(let command): command.action()
            case .entity(let entity): onSelectEntity(entity)
            }
        }
    }

    private var searchHeader: some View {
        HStack(spacing: 8) {
            Image(systemName: "command")
                .hcbFont(.subheadline, weight: .medium)
                .foregroundStyle(.secondary)

            TextField("Run a command or search — New Task, refresh, tag:deep, kind:note …", text: $query)
                .textFieldStyle(.plain)
                .focused($isSearchFocused)
                .hcbFont(.body)
                .onSubmit(executeFirstMatch)

            if query.isEmpty {
                Text("⌘P")
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
    private func rowButton(item: PaletteItem, index: Int) -> some View {
        let button = Button { select(item) } label: {
            HStack(spacing: 6) {
                switch item {
                case .command(let c): CommandPaletteRow(command: c)
                case .entity(let e): EntityRow(entity: e, subtitle: entitySubtitle(e))
                }
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

    private func entitySubtitle(_ entity: QuickSwitcherEntity) -> String {
        switch entity {
        case .task(let t):
            let list = model.taskLists.first(where: { $0.id == t.taskListID })?.title ?? "—"
            if let due = t.dueDate {
                return "\(list) · due \(due.formatted(.dateTime.month(.abbreviated).day()))"
            }
            return list
        case .event(let e):
            let cal = model.calendars.first(where: { $0.id == e.calendarID })?.summary ?? "—"
            if e.isAllDay {
                return "\(cal) · \(e.startDate.formatted(.dateTime.month(.abbreviated).day()))"
            }
            return "\(cal) · \(e.startDate.formatted(.dateTime.month(.abbreviated).day().hour().minute()))"
        case .taskList(let l):
            let count = model.tasks.filter { $0.taskListID == l.id && $0.isDeleted == false && $0.isCompleted == false }.count
            return "\(count) open"
        case .calendar(let c):
            return c.colorHex
        case .customFilter(let f):
            return f.isUsingQueryDSL ? "DSL · \(f.queryExpression ?? "")" : f.dueWindow.title
        }
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .hcbFont(.title2, weight: .semibold)
                .foregroundStyle(.secondary)
            Text("Nothing matches \"\(query)\"")
                .hcbFont(.headline)
                .foregroundStyle(.secondary)
            Text("Try a bare word, or `kind:note`, `tag:deep`, `/regex/`.")
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

            Text("Command")
                .font(.system(.caption2, design: .rounded, weight: .medium))
                .foregroundStyle(.secondary)
                .hcbScaledPadding(.horizontal, 6)
                .hcbScaledPadding(.vertical, 2)
                .background(
                    Capsule().fill(.quaternary.opacity(0.4))
                )

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

private struct EntityRow: View {
    let entity: QuickSwitcherEntity
    let subtitle: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: entity.symbol)
                .hcbFont(.headline)
                .foregroundStyle(tint)
                .hcbScaledFrame(width: 24)

            VStack(alignment: .leading, spacing: 2) {
                Text(entity.label.isEmpty ? "(untitled)" : entity.label)
                    .hcbFontSystem(size: 19, weight: .semibold, design: .rounded)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.system(.subheadline, design: .rounded))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 12)

            Text(entity.kindLabel)
                .font(.system(.caption2, design: .rounded, weight: .medium))
                .foregroundStyle(.secondary)
                .hcbScaledPadding(.horizontal, 6)
                .hcbScaledPadding(.vertical, 2)
                .background(
                    Capsule().fill(.quaternary.opacity(0.4))
                )
        }
        .contentShape(Rectangle())
        .hcbScaledPadding(.vertical, 2)
    }

    private var tint: Color {
        switch entity {
        case .task(let t):
            if t.dueDate == nil { return AppColor.ink }
            return t.isCompleted ? AppColor.moss : AppColor.ember
        case .event: return AppColor.blue
        case .taskList: return AppColor.ink
        case .calendar: return AppColor.blue
        case .customFilter: return AppColor.ember
        }
    }
}
