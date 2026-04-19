import Foundation

enum RecurrenceFrequency: String, CaseIterable, Hashable, Sendable {
    case daily
    case weekly
    case monthly
    case yearly

    var title: String {
        switch self {
        case .daily: "Daily"
        case .weekly: "Weekly"
        case .monthly: "Monthly"
        case .yearly: "Yearly"
        }
    }

    var rfcValue: String {
        switch self {
        case .daily: "DAILY"
        case .weekly: "WEEKLY"
        case .monthly: "MONTHLY"
        case .yearly: "YEARLY"
        }
    }

    static func parse(_ value: String) -> RecurrenceFrequency? {
        RecurrenceFrequency.allCases.first { $0.rfcValue == value.uppercased() }
    }
}

struct RecurrenceRule: Equatable, Hashable, Sendable {
    var frequency: RecurrenceFrequency
    var interval: Int

    init(frequency: RecurrenceFrequency, interval: Int = 1) {
        self.frequency = frequency
        self.interval = max(1, interval)
    }

    func rruleString() -> String {
        "RRULE:FREQ=\(frequency.rfcValue);INTERVAL=\(max(interval, 1))"
    }

    static func parse(rrule: String) -> RecurrenceRule? {
        let trimmed = rrule.hasPrefix("RRULE:") ? String(rrule.dropFirst(6)) : rrule
        var frequency: RecurrenceFrequency?
        var interval = 1
        for component in trimmed.split(separator: ";") {
            let parts = component.split(separator: "=", maxSplits: 1)
            guard parts.count == 2 else { continue }
            let key = parts[0].uppercased()
            let value = String(parts[1])
            switch key {
            case "FREQ":
                frequency = RecurrenceFrequency.parse(value)
            case "INTERVAL":
                interval = Int(value) ?? 1
            default:
                continue
            }
        }
        guard let frequency else { return nil }
        return RecurrenceRule(frequency: frequency, interval: interval)
    }

    func advance(_ date: Date, calendar: Calendar = .current) -> Date? {
        switch frequency {
        case .daily:
            return calendar.date(byAdding: .day, value: interval, to: date)
        case .weekly:
            return calendar.date(byAdding: .weekOfYear, value: interval, to: date)
        case .monthly:
            return calendar.date(byAdding: .month, value: interval, to: date)
        case .yearly:
            return calendar.date(byAdding: .year, value: interval, to: date)
        }
    }

    var summary: String {
        if interval == 1 { return frequency.title }
        return "Every \(interval) \(pluralUnit)"
    }

    private var pluralUnit: String {
        switch frequency {
        case .daily: "days"
        case .weekly: "weeks"
        case .monthly: "months"
        case .yearly: "years"
        }
    }
}
