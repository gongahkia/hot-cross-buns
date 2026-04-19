import Foundation

struct EventTemplate: Identifiable, Hashable, Codable, Sendable {
    var id: UUID
    var name: String
    var summary: String
    var details: String
    var location: String
    var durationMinutes: Int
    var isAllDay: Bool
    var reminderMinutes: Int?
    var colorId: String?
    var attendees: [String]
    var addGoogleMeet: Bool

    init(
        id: UUID = UUID(),
        name: String,
        summary: String,
        details: String = "",
        location: String = "",
        durationMinutes: Int = 60,
        isAllDay: Bool = false,
        reminderMinutes: Int? = nil,
        colorId: String? = nil,
        attendees: [String] = [],
        addGoogleMeet: Bool = false
    ) {
        self.id = id
        self.name = name
        self.summary = summary
        self.details = details
        self.location = location
        self.durationMinutes = durationMinutes
        self.isAllDay = isAllDay
        self.reminderMinutes = reminderMinutes
        self.colorId = colorId
        self.attendees = attendees
        self.addGoogleMeet = addGoogleMeet
    }
}
