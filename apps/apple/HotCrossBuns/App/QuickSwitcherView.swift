import SwiftUI

// Entity-only jump surface. Complements the command palette (which runs
// commands) with a navigation surface for "take me to X" workflows —
// tasks, events, task lists, calendars, and saved custom filters.
//
// Design parallels CommandPaletteView: ultrathin translucent material,
// Alfred-style empty-when-blank, numeric ⌘1..⌘0 quick-select for the
// top ten results. Ranking uses the shared FuzzySearcher so muscle memory
// matches the palette.

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
        case .task(let t): return TagExtractor.stripped(from: TaskStarring.displayTitle(for: t))
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

    fileprivate var kindLabel: String {
        switch self {
        case .task: return "Task"
        case .event: return "Event"
        case .taskList: return "List"
        case .calendar: return "Calendar"
        case .customFilter: return "Filter"
        }
    }

    fileprivate var symbol: String {
        switch self {
        case .task(let t): return t.isCompleted ? "checkmark.circle.fill" : "circle"
        case .event: return "calendar"
        case .taskList: return "checklist"
        case .calendar: return "calendar.badge.clock"
        case .customFilter(let f): return f.systemImage
        }
    }
}

struct QuickSwitcherView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model
    @State private var query = ""
    @FocusState private var isSearchFocused: Bool

    let onSelect: (QuickSwitcherEntity) -> Void

    var body: some View {
        VStack(spacing: 0) {
            header
            if trimmedQuery.isEmpty == false {
                Divider().overlay(.secondary.opacity(0.25))
                ScrollView {
                    LazyVStack(spacing: 0) {
                        if rankedResults.isEmpty {
                            emptyState
                        } else {
                            ForEach(Array(rankedResults.enumerated()), id: \.element.id) { index, entity in
                                resultButton(entity: entity, index: index)
                            }
                        }
                    }
                    .hcbScaledPadding(.vertical, 12)
                }
            }
        }
        .onAppear { isSearchFocused = true }
        .onSubmit(of: .text, executeFirstMatch)
        .hcbScaledFrame(
            minWidth: 480,
            idealWidth: 520,
            maxWidth: 580,
            minHeight: trimmedQuery.isEmpty ? 54 : 360,
            idealHeight: trimmedQuery.isEmpty ? 54 : 420
        )
        .background {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(.ultraThinMaterial)
        }
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .presentationBackground(.clear)
        .hcbScaledPadding(14)
    }

    private var trimmedQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var allEntities: [QuickSwitcherEntity] {
        var out: [QuickSwitcherEntity] = []
        out.reserveCapacity(model.tasks.count + model.events.count + 32)
        for t in model.tasks where t.isDeleted == false {
            out.append(.task(t))
        }
        for e in model.events where e.status != .cancelled {
            out.append(.event(e))
        }
        for l in model.taskLists { out.append(.taskList(l)) }
        for c in model.calendars { out.append(.calendar(c)) }
        for f in model.settings.customFilters { out.append(.customFilter(f)) }
        return out
    }

    private var rankedResults: [QuickSwitcherEntity] {
        guard trimmedQuery.isEmpty == false else { return [] }
        let ranked = FuzzySearcher.rank(
            allEntities,
            query: trimmedQuery,
            labelForItem: { $0.label },
            keywordsForItem: { $0.keywords },
            limit: 30
        )
        return ranked.map(\.item)
    }

    private var header: some View {
        HStack(spacing: 8) {
            Image(systemName: "arrow.right.circle")
                .hcbFont(.subheadline, weight: .medium)
                .foregroundStyle(.secondary)
            TextField("Jump to a task, event, list, calendar, or filter…", text: $query)
                .textFieldStyle(.plain)
                .focused($isSearchFocused)
                .hcbFont(.body)
                .onSubmit(executeFirstMatch)
            if query.isEmpty {
                Text("⌘O")
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
    private func resultButton(entity: QuickSwitcherEntity, index: Int) -> some View {
        let button = Button { pick(entity) } label: {
            HStack(spacing: 6) {
                resultRow(entity)
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

    @ViewBuilder
    private func resultRow(_ entity: QuickSwitcherEntity) -> some View {
        HStack(spacing: 10) {
            Image(systemName: entity.symbol)
                .hcbFont(.subheadline)
                .foregroundStyle(tint(for: entity))
                .hcbScaledFrame(width: 18)
            VStack(alignment: .leading, spacing: 1) {
                Text(entity.label.isEmpty ? "(untitled)" : entity.label)
                    .font(.system(.subheadline, design: .rounded, weight: .medium))
                    .lineLimit(1)
                Text(subtitle(for: entity))
                    .font(.system(.caption2, design: .rounded))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
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
    }

    private func tint(for entity: QuickSwitcherEntity) -> Color {
        switch entity {
        case .task(let t): return t.isCompleted ? AppColor.moss : AppColor.ember
        case .event: return AppColor.blue
        case .taskList: return AppColor.ink
        case .calendar: return AppColor.blue
        case .customFilter: return AppColor.ember
        }
    }

    private func subtitle(for entity: QuickSwitcherEntity) -> String {
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

    private func executeFirstMatch() {
        if let first = rankedResults.first { pick(first) }
    }

    private func pick(_ entity: QuickSwitcherEntity) {
        dismiss()
        // Defer selection callback so the sheet dismissal animation doesn't
        // fight navigation; matches existing CommandPaletteView pattern.
        DispatchQueue.main.async {
            onSelect(entity)
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
        }
        .frame(maxWidth: .infinity, minHeight: 180)
    }
}
