import Foundation

enum CalendarGridMode: String, CaseIterable, Hashable, Sendable {
    case agenda
    case day
    case week
    case month

    var title: String {
        switch self {
        case .agenda: "Agenda"
        case .day: "Day"
        case .week: "Week"
        case .month: "Month"
        }
    }

    var systemImage: String {
        switch self {
        case .agenda: "list.bullet.rectangle"
        case .day: "calendar.day.timeline.leading"
        case .week: "calendar.day.timeline.left"
        case .month: "calendar"
        }
    }
}

enum CalendarGridLayout {
    static func weekDays(containing date: Date, calendar: Calendar = .current) -> [Date] {
        let startOfWeek = startOfWeek(containing: date, calendar: calendar)
        return (0..<7).compactMap { offset in
            calendar.date(byAdding: .day, value: offset, to: startOfWeek)
        }
    }

    static func startOfWeek(containing date: Date, calendar: Calendar = .current) -> Date {
        let startOfDay = calendar.startOfDay(for: date)
        let weekday = calendar.component(.weekday, from: startOfDay)
        let delta = (weekday - calendar.firstWeekday + 7) % 7
        return calendar.date(byAdding: .day, value: -delta, to: startOfDay) ?? startOfDay
    }

    static func monthCells(for date: Date, calendar: Calendar = .current) -> [Date] {
        let startOfMonth = calendar.date(from: calendar.dateComponents([.year, .month], from: date)) ?? date
        let leadingOffset: Int = {
            let weekday = calendar.component(.weekday, from: startOfMonth)
            return (weekday - calendar.firstWeekday + 7) % 7
        }()
        let gridStart = calendar.date(byAdding: .day, value: -leadingOffset, to: startOfMonth) ?? startOfMonth
        return (0..<42).compactMap { offset in
            calendar.date(byAdding: .day, value: offset, to: gridStart)
        }
    }

    static func eventsByDay(
        _ events: [CalendarEventMirror],
        from rangeStart: Date,
        to rangeEnd: Date,
        calendar: Calendar = .current
    ) -> [Date: [CalendarEventMirror]] {
        let startOfRange = calendar.startOfDay(for: rangeStart)
        let endOfRange = calendar.startOfDay(for: rangeEnd)
        var bucket: [Date: [CalendarEventMirror]] = [:]

        for event in events where event.status != .cancelled {
            let eventStartDay = calendar.startOfDay(for: event.startDate)
            let inclusiveEndDay = eventEndDay(event: event, calendar: calendar)

            let firstDay = max(eventStartDay, startOfRange)
            let lastDay = min(inclusiveEndDay, endOfRange)
            guard firstDay <= lastDay else { continue }

            var cursor = firstDay
            while cursor <= lastDay {
                bucket[cursor, default: []].append(event)
                guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { break }
                cursor = next
            }
        }

        for day in bucket.keys {
            bucket[day]?.sort { lhs, rhs in
                if lhs.isAllDay != rhs.isAllDay { return lhs.isAllDay && rhs.isAllDay == false }
                return lhs.startDate < rhs.startDate
            }
        }
        return bucket
    }

    static func eventEndDay(event: CalendarEventMirror, calendar: Calendar = .current) -> Date {
        if event.isAllDay {
            let startOfEndDay = calendar.startOfDay(for: event.endDate)
            if startOfEndDay > calendar.startOfDay(for: event.startDate) {
                return calendar.date(byAdding: .day, value: -1, to: startOfEndDay) ?? startOfEndDay
            }
            return startOfEndDay
        }
        return calendar.startOfDay(for: event.endDate)
    }

    struct LaidOutEvent: Equatable {
        let event: CalendarEventMirror
        let columnIndex: Int
        let columnCount: Int
    }

    static func layout(eventsInDay events: [CalendarEventMirror], calendar: Calendar = .current) -> [LaidOutEvent] {
        let sorted = events.sorted { $0.startDate < $1.startDate }
        var columns: [[CalendarEventMirror]] = []

        for event in sorted {
            var placed = false
            for columnIndex in columns.indices {
                if let last = columns[columnIndex].last, last.endDate <= event.startDate {
                    columns[columnIndex].append(event)
                    placed = true
                    break
                }
            }
            if placed == false {
                columns.append([event])
            }
        }

        var result: [LaidOutEvent] = []
        for (columnIndex, bucket) in columns.enumerated() {
            for event in bucket {
                result.append(LaidOutEvent(event: event, columnIndex: columnIndex, columnCount: columns.count))
            }
        }
        return result
    }
}
