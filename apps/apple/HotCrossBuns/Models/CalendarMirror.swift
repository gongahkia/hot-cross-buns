import Foundation

struct CalendarListMirror: Identifiable, Hashable, Codable, Sendable {
    let id: String
    var summary: String
    var colorHex: String
    var isSelected: Bool
    var accessRole: String
    var etag: String?
}

struct CalendarEventMirror: Identifiable, Hashable, Codable, Sendable {
    let id: String
    var calendarID: CalendarListMirror.ID
    var summary: String
    var details: String
    var startDate: Date
    var endDate: Date
    var isAllDay: Bool
    var status: CalendarEventStatus
    var recurrence: [String]
    var etag: String?
    var updatedAt: Date?
}

enum CalendarEventStatus: String, Codable, Hashable, Sendable {
    case confirmed
    case tentative
    case cancelled
}
