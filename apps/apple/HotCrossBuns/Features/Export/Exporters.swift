import Foundation

enum TaskMarkdownExporter {
    static func markdown(for task: TaskMirror, taskListTitle: String? = nil) -> String {
        var lines: [String] = []
        let bullet = task.isCompleted ? "- [x]" : "- [ ]"
        lines.append("\(bullet) \(task.title)")
        if let taskListTitle, taskListTitle.isEmpty == false {
            lines.append("  - List: \(taskListTitle)")
        }
        if let due = task.dueDate {
            lines.append("  - Due: \(due.formatted(.dateTime.weekday(.wide).month(.wide).day().year()))")
        }
        if task.notes.isEmpty == false {
            lines.append("  - Notes: \(task.notes)")
        }
        return lines.joined(separator: "\n")
    }
}

enum EventMarkdownExporter {
    static func markdown(for event: CalendarEventMirror, calendarTitle: String? = nil) -> String {
        var lines: [String] = []
        lines.append("## \(event.summary)")
        if let calendarTitle, calendarTitle.isEmpty == false {
            lines.append("- Calendar: \(calendarTitle)")
        }
        if event.location.isEmpty == false {
            lines.append("- Location: \(event.location)")
        }
        if event.isAllDay {
            lines.append("- When: \(event.startDate.formatted(.dateTime.weekday(.wide).month(.wide).day().year())) (all day)")
        } else {
            let start = event.startDate.formatted(.dateTime.weekday(.wide).month(.wide).day().year().hour().minute())
            let end = event.endDate.formatted(.dateTime.hour().minute())
            lines.append("- When: \(start) – \(end)")
        }
        if event.details.isEmpty == false {
            lines.append("")
            lines.append(event.details)
        }
        return lines.joined(separator: "\n")
    }
}

enum EventICSExporter {
    static func ics(for event: CalendarEventMirror) -> String {
        let now = Date()
        let uid = "\(event.id)@hotcrossbuns"
        var lines: [String] = [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//Hot Cross Buns//EN",
            "CALSCALE:GREGORIAN",
            "BEGIN:VEVENT",
            "UID:\(escape(uid))",
            "DTSTAMP:\(icsTimestamp(now))",
            "SUMMARY:\(escape(event.summary))"
        ]

        if event.isAllDay {
            lines.append("DTSTART;VALUE=DATE:\(icsDate(event.startDate))")
            lines.append("DTEND;VALUE=DATE:\(icsDate(event.endDate))")
        } else {
            lines.append("DTSTART:\(icsTimestamp(event.startDate))")
            lines.append("DTEND:\(icsTimestamp(event.endDate))")
        }

        if event.details.isEmpty == false {
            lines.append("DESCRIPTION:\(escape(event.details))")
        }

        if event.location.isEmpty == false {
            lines.append("LOCATION:\(escape(event.location))")
        }

        for minutes in event.reminderMinutes {
            lines.append("BEGIN:VALARM")
            lines.append("ACTION:DISPLAY")
            lines.append("DESCRIPTION:\(escape(event.summary))")
            lines.append("TRIGGER:-PT\(minutes)M")
            lines.append("END:VALARM")
        }

        lines.append("END:VEVENT")
        lines.append("END:VCALENDAR")
        return lines.joined(separator: "\r\n") + "\r\n"
    }

    private static let utcFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyyMMdd'T'HHmmss'Z'"
        return f
    }()

    private static let dateOnlyFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyyMMdd"
        return f
    }()

    private static func icsTimestamp(_ date: Date) -> String {
        utcFormatter.string(from: date)
    }

    private static func icsDate(_ date: Date) -> String {
        dateOnlyFormatter.string(from: date)
    }

    private static func escape(_ value: String) -> String {
        value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: ";", with: "\\;")
            .replacingOccurrences(of: ",", with: "\\,")
            .replacingOccurrences(of: "\n", with: "\\n")
    }
}
