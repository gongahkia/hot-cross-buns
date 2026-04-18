import Foundation

enum CalendarDropComputer {
    static let snapMinutes: Int = 15
    static let defaultDurationMinutes: Int = 60

    static func snappedStart(
        for dropY: CGFloat,
        hourHeight: CGFloat,
        dayStart: Date,
        calendar: Calendar = .current
    ) -> Date {
        guard hourHeight > 0 else { return dayStart }
        let rawMinutes = Int((dropY / hourHeight) * 60)
        let clamped = max(0, min(rawMinutes, 24 * 60 - defaultDurationMinutes))
        let snapped = (clamped / snapMinutes) * snapMinutes
        return calendar.date(byAdding: .minute, value: snapped, to: dayStart) ?? dayStart
    }

    static func defaultEndDate(from start: Date, calendar: Calendar = .current) -> Date {
        calendar.date(byAdding: .minute, value: defaultDurationMinutes, to: start) ?? start
    }

    static func backLinkDescription(for title: String, taskID: String) -> String {
        "Linked task: \(title)\nhcb://task/\(taskID)"
    }
}
