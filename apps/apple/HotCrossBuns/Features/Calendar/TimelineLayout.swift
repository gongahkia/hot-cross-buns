import Foundation
import SwiftUI

// Pure layout math for the Timeline view. Kept separate from the SwiftUI so
// the offsets, zoom bucketing, and item derivation are unit-testable without
// needing a SwiftUI test host.

enum TimelineZoom: String, CaseIterable, Hashable, Sendable {
    case day      // 200 pt/day — visible window ≈ 3 days
    case week     // 80 pt/day — visible window ≈ 1-2 weeks
    case month    // 22 pt/day — visible window ≈ 4 weeks
    case quarter  // 8 pt/day — visible window ≈ 3 months

    var title: String {
        switch self {
        case .day: "Day"
        case .week: "Week"
        case .month: "Month"
        case .quarter: "Quarter"
        }
    }

    var pointsPerDay: CGFloat {
        switch self {
        case .day: 200
        case .week: 80
        case .month: 22
        case .quarter: 8
        }
    }

    // Length of the visible window centered on the anchor date. Picked so the
    // viewer can scroll a bit but doesn't face an infinite canvas.
    var totalDays: Int {
        switch self {
        case .day: 14
        case .week: 42
        case .month: 90
        case .quarter: 270
        }
    }
}

struct TimelineItem: Identifiable, Equatable {
    enum Kind: Equatable {
        case task(TaskMirror)
        case event(CalendarEventMirror)
    }
    let id: String
    let kind: Kind
    let title: String
    let startDate: Date
    let endDate: Date
    let isAllDay: Bool

    var isTask: Bool { if case .task = kind { return true } else { return false } }
}

enum TimelineLayout {
    // Derive a flat list of timeline items from tasks + events, filtered to
    // the given range. Tasks only participate if they have a dueDate that
    // falls inside the range (date-only, so task.dueDate is rendered as a
    // single-day span at startOfDay(dueDate)).
    static func items(
        tasks: [TaskMirror],
        events: [CalendarEventMirror],
        range: ClosedRange<Date>,
        calendar: Calendar = .current,
        searchQuery: String = ""
    ) -> [TimelineItem] {
        let q = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        var out: [TimelineItem] = []

        for event in events where event.status != .cancelled {
            guard event.endDate >= range.lowerBound, event.startDate <= range.upperBound else { continue }
            if q.isEmpty == false,
               event.summary.lowercased().contains(q) == false,
               event.details.lowercased().contains(q) == false,
               event.location.lowercased().contains(q) == false {
                continue
            }
            out.append(TimelineItem(
                id: "event-\(event.id)",
                kind: .event(event),
                title: event.summary.isEmpty ? "(no title)" : event.summary,
                startDate: event.startDate,
                endDate: event.endDate,
                isAllDay: event.isAllDay
            ))
        }

        for task in tasks where task.isDeleted == false {
            guard let due = task.dueDate, range.contains(due) else { continue }
            if q.isEmpty == false, task.title.lowercased().contains(q) == false { continue }
            let startOfDay = calendar.startOfDay(for: due)
            let endExclusive = calendar.date(byAdding: .day, value: 1, to: startOfDay) ?? startOfDay
            out.append(TimelineItem(
                id: "task-\(task.id)",
                kind: .task(task),
                title: task.title,
                startDate: startOfDay,
                endDate: endExclusive,
                isAllDay: true
            ))
        }

        // Stable order: chronological, tie-break by title for deterministic
        // row ordering.
        return out.sorted { lhs, rhs in
            if lhs.startDate != rhs.startDate { return lhs.startDate < rhs.startDate }
            return lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
        }
    }

    // x-offset in points for a given date, measured from `rangeStart`.
    // Clamped to the configured window so items that bleed past the edge
    // stay visible at the boundary rather than drifting off-canvas.
    static func xOffset(
        for date: Date,
        rangeStart: Date,
        pointsPerDay: CGFloat,
        calendar: Calendar = .current
    ) -> CGFloat {
        let seconds = date.timeIntervalSince(rangeStart)
        let daysAsDouble = seconds / 86_400
        return CGFloat(daysAsDouble) * pointsPerDay
    }

    // Width (in points) of the bar representing [start, end].
    static func width(
        start: Date,
        end: Date,
        pointsPerDay: CGFloat,
        minimumWidth: CGFloat = 6
    ) -> CGFloat {
        let seconds = max(0, end.timeIntervalSince(start))
        let daysAsDouble = seconds / 86_400
        let raw = CGFloat(daysAsDouble) * pointsPerDay
        return max(raw, minimumWidth)
    }

    // Inclusive date range centered on `anchor` with window sized by `zoom`.
    // `totalDays` is split half before / half after the anchor's startOfDay
    // so "today" always lands near the centre of the canvas.
    static func defaultRange(
        anchor: Date,
        zoom: TimelineZoom,
        calendar: Calendar = .current
    ) -> ClosedRange<Date> {
        let anchorDay = calendar.startOfDay(for: anchor)
        let half = zoom.totalDays / 2
        let start = calendar.date(byAdding: .day, value: -half, to: anchorDay) ?? anchorDay
        let end = calendar.date(byAdding: .day, value: zoom.totalDays - half, to: anchorDay) ?? anchorDay
        return start ... end
    }
}
