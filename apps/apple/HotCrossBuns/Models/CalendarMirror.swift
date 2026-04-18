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
    var reminderMinutes: [Int]
    var location: String

    init(
        id: String,
        calendarID: CalendarListMirror.ID,
        summary: String,
        details: String,
        startDate: Date,
        endDate: Date,
        isAllDay: Bool,
        status: CalendarEventStatus,
        recurrence: [String],
        etag: String?,
        updatedAt: Date?,
        reminderMinutes: [Int] = [],
        location: String = ""
    ) {
        self.id = id
        self.calendarID = calendarID
        self.summary = summary
        self.details = details
        self.startDate = startDate
        self.endDate = endDate
        self.isAllDay = isAllDay
        self.status = status
        self.recurrence = recurrence
        self.etag = etag
        self.updatedAt = updatedAt
        self.reminderMinutes = reminderMinutes
        self.location = location
    }

    enum CodingKeys: String, CodingKey {
        case id
        case calendarID
        case summary
        case details
        case startDate
        case endDate
        case isAllDay
        case status
        case recurrence
        case etag
        case updatedAt
        case reminderMinutes
        case location
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        calendarID = try container.decode(CalendarListMirror.ID.self, forKey: .calendarID)
        summary = try container.decode(String.self, forKey: .summary)
        details = try container.decode(String.self, forKey: .details)
        startDate = try container.decode(Date.self, forKey: .startDate)
        endDate = try container.decode(Date.self, forKey: .endDate)
        isAllDay = try container.decode(Bool.self, forKey: .isAllDay)
        status = try container.decode(CalendarEventStatus.self, forKey: .status)
        recurrence = try container.decode([String].self, forKey: .recurrence)
        etag = try container.decodeIfPresent(String.self, forKey: .etag)
        updatedAt = try container.decodeIfPresent(Date.self, forKey: .updatedAt)
        reminderMinutes = try container.decodeIfPresent([Int].self, forKey: .reminderMinutes) ?? []
        location = try container.decodeIfPresent(String.self, forKey: .location) ?? ""
    }
}

enum CalendarEventStatus: String, Codable, Hashable, Sendable {
    case confirmed
    case tentative
    case cancelled
}
