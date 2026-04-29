import Foundation

struct CalendarListMirror: Identifiable, Hashable, Codable, Sendable {
    let id: String
    var summary: String
    var colorHex: String
    var isSelected: Bool
    var accessRole: String
    var etag: String?
    var defaultReminderMinutes: [Int]

    init(
        id: String,
        summary: String,
        colorHex: String,
        isSelected: Bool,
        accessRole: String,
        etag: String? = nil,
        defaultReminderMinutes: [Int] = []
    ) {
        self.id = id
        self.summary = summary
        self.colorHex = colorHex
        self.isSelected = isSelected
        self.accessRole = accessRole
        self.etag = etag
        self.defaultReminderMinutes = defaultReminderMinutes
    }

    enum CodingKeys: String, CodingKey {
        case id
        case summary
        case colorHex
        case isSelected
        case accessRole
        case etag
        case defaultReminderMinutes
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        summary = try container.decode(String.self, forKey: .summary)
        colorHex = try container.decode(String.self, forKey: .colorHex)
        isSelected = try container.decode(Bool.self, forKey: .isSelected)
        accessRole = try container.decode(String.self, forKey: .accessRole)
        etag = try container.decodeIfPresent(String.self, forKey: .etag)
        defaultReminderMinutes = try container.decodeIfPresent([Int].self, forKey: .defaultReminderMinutes) ?? []
    }
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
    var usedDefaultReminders: Bool
    var location: String
    var attendeeEmails: [String]
    var attendeeResponses: [CalendarEventAttendee]
    var meetLink: String
    var htmlLink: String?
    var colorId: String?
    // HCB-only metadata stored in Google's native `extendedProperties.private`
    // bag. `private` is HCB-only — other Google clients don't render it —
    // which is exactly the philosophy-compliant place to attach per-event
    // app state without polluting user-visible fields like description.
    // Used today for the time-blocking backlink (task → event) so the UI can
    // jump from an event tile back to its originating task.
    var hcbTaskID: String?

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
        usedDefaultReminders: Bool = false,
        location: String = "",
        attendeeEmails: [String] = [],
        attendeeResponses: [CalendarEventAttendee] = [],
        meetLink: String = "",
        htmlLink: String? = nil,
        colorId: String? = nil,
        hcbTaskID: String? = nil
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
        self.usedDefaultReminders = usedDefaultReminders
        self.location = location
        self.attendeeEmails = attendeeEmails
        self.attendeeResponses = attendeeResponses
        self.meetLink = meetLink
        self.htmlLink = htmlLink
        self.colorId = colorId
        self.hcbTaskID = hcbTaskID
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
        case usedDefaultReminders
        case location
        case attendeeEmails
        case attendeeResponses
        case meetLink
        case htmlLink
        case colorId
        case hcbTaskID
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
        usedDefaultReminders = try container.decodeIfPresent(Bool.self, forKey: .usedDefaultReminders) ?? false
        location = try container.decodeIfPresent(String.self, forKey: .location) ?? ""
        attendeeEmails = try container.decodeIfPresent([String].self, forKey: .attendeeEmails) ?? []
        attendeeResponses = try container.decodeIfPresent([CalendarEventAttendee].self, forKey: .attendeeResponses) ?? []
        meetLink = try container.decodeIfPresent(String.self, forKey: .meetLink) ?? ""
        htmlLink = try container.decodeIfPresent(String.self, forKey: .htmlLink)
        colorId = try container.decodeIfPresent(String.self, forKey: .colorId)
        hcbTaskID = try container.decodeIfPresent(String.self, forKey: .hcbTaskID)
    }
}

struct CalendarEventAttendee: Hashable, Codable, Sendable {
    var email: String
    var displayName: String?
    var responseStatus: AttendeeResponseStatus
}

enum AttendeeResponseStatus: String, Hashable, Codable, Sendable {
    case needsAction
    case declined
    case tentative
    case accepted

    init(wire: String?) {
        switch wire {
        case "accepted": self = .accepted
        case "declined": self = .declined
        case "tentative": self = .tentative
        default: self = .needsAction
        }
    }

    var displayTitle: String {
        switch self {
        case .needsAction: "No reply"
        case .declined: "Declined"
        case .tentative: "Maybe"
        case .accepted: "Going"
        }
    }

    var symbol: String {
        switch self {
        case .needsAction: "questionmark.circle"
        case .declined: "xmark.circle.fill"
        case .tentative: "questionmark.circle.fill"
        case .accepted: "checkmark.circle.fill"
        }
    }
}

enum CalendarEventStatus: String, Codable, Hashable, Sendable {
    case confirmed
    case tentative
    case cancelled
}
