import Foundation
import UserNotifications

struct LocalNotificationScheduler {
    private static let notificationPrefix = "hot-cross-buns."
    private let notificationCenter: UNUserNotificationCenter

    init(notificationCenter: UNUserNotificationCenter = .current()) {
        self.notificationCenter = notificationCenter
    }

    func synchronize(
        tasks: [TaskMirror],
        events: [CalendarEventMirror],
        settings: AppSettings,
        requestAuthorization: Bool = false,
        referenceDate: Date = Date(),
        calendar: Calendar = .current
    ) async {
        guard settings.enableLocalNotifications else {
            await removeScheduledNotifications()
            return
        }

        let isAuthorized = await hasAuthorization(requestAuthorization: requestAuthorization)
        guard isAuthorized else {
            return
        }

        await removeScheduledNotifications()

        let requests = makeRequests(
            tasks: tasks,
            events: events,
            referenceDate: referenceDate,
            calendar: calendar
        )
        .prefix(64)

        for request in requests {
            try? await add(request)
        }
    }

    private func hasAuthorization(requestAuthorization: Bool) async -> Bool {
        let settings = await notificationSettings()

        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            return true
        case .notDetermined where requestAuthorization:
            return await requestNotificationAuthorization()
        default:
            return false
        }
    }

    private func makeRequests(
        tasks: [TaskMirror],
        events: [CalendarEventMirror],
        referenceDate: Date,
        calendar: Calendar
    ) -> [UNNotificationRequest] {
        let taskRequests = tasks.compactMap { task in
            taskNotificationRequest(for: task, referenceDate: referenceDate, calendar: calendar)
        }
        let eventRequests = events.compactMap { event in
            eventNotificationRequest(for: event, referenceDate: referenceDate, calendar: calendar)
        }

        return (taskRequests + eventRequests).sorted { lhs, rhs in
            lhs.sortDate < rhs.sortDate
        }.map(\.request)
    }

    private func taskNotificationRequest(
        for task: TaskMirror,
        referenceDate: Date,
        calendar: Calendar
    ) -> ScheduledNotification? {
        guard task.isCompleted == false, task.isDeleted == false, let dueDate = task.dueDate else {
            return nil
        }

        var components = calendar.dateComponents([.year, .month, .day], from: dueDate)
        components.hour = 9
        components.minute = 0

        guard let notificationDate = calendar.date(from: components), notificationDate > referenceDate else {
            return nil
        }

        let content = UNMutableNotificationContent()
        content.title = "Task due today"
        content.body = task.title
        content.sound = .default

        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
        let request = UNNotificationRequest(
            identifier: Self.notificationPrefix + "task." + task.id,
            content: content,
            trigger: trigger
        )
        return ScheduledNotification(sortDate: notificationDate, request: request)
    }

    private func eventNotificationRequest(
        for event: CalendarEventMirror,
        referenceDate: Date,
        calendar: Calendar
    ) -> ScheduledNotification? {
        guard event.status != .cancelled else {
            return nil
        }

        let notificationDate = event.isAllDay
            ? allDayNotificationDate(for: event.startDate, calendar: calendar)
            : event.startDate.addingTimeInterval(-15 * 60)

        guard notificationDate > referenceDate else {
            return nil
        }

        let content = UNMutableNotificationContent()
        content.title = event.isAllDay ? "All-day event today" : "Event starts soon"
        content.body = event.summary
        content.sound = .default

        let components = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: notificationDate)
        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
        let request = UNNotificationRequest(
            identifier: Self.notificationPrefix + "event." + event.id,
            content: content,
            trigger: trigger
        )
        return ScheduledNotification(sortDate: notificationDate, request: request)
    }

    private func allDayNotificationDate(for date: Date, calendar: Calendar) -> Date {
        var components = calendar.dateComponents([.year, .month, .day], from: date)
        components.hour = 9
        components.minute = 0
        return calendar.date(from: components) ?? date
    }

    private func removeScheduledNotifications() async {
        let pendingRequests = await pendingNotificationRequests()
        let identifiers = pendingRequests
            .map(\.identifier)
            .filter { $0.hasPrefix(Self.notificationPrefix) }

        guard identifiers.isEmpty == false else {
            return
        }

        notificationCenter.removePendingNotificationRequests(withIdentifiers: identifiers)
        notificationCenter.removeDeliveredNotifications(withIdentifiers: identifiers)
    }

    private func notificationSettings() async -> UNNotificationSettings {
        await withCheckedContinuation { continuation in
            notificationCenter.getNotificationSettings { settings in
                continuation.resume(returning: settings)
            }
        }
    }

    private func pendingNotificationRequests() async -> [UNNotificationRequest] {
        await withCheckedContinuation { continuation in
            notificationCenter.getPendingNotificationRequests { requests in
                continuation.resume(returning: requests)
            }
        }
    }

    private func requestNotificationAuthorization() async -> Bool {
        await withCheckedContinuation { continuation in
            notificationCenter.requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
                continuation.resume(returning: granted)
            }
        }
    }

    private func add(_ request: UNNotificationRequest) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            notificationCenter.add(request) { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            }
        }
    }
}

private struct ScheduledNotification {
    var sortDate: Date
    var request: UNNotificationRequest
}
