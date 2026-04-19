import AppKit
import SwiftUI

// Page-sized SwiftUI view used by NSPrintOperation. Shows today's
// scheduled events, overdue tasks, due-today tasks, and the next
// 24 hours of future events so the printed page doubles as a
// tear-off paper day plan.
struct TodayPrintView: View {
    let todaySnapshot: TodaySnapshot
    let overdueTasks: [TaskMirror]
    let upcomingEvents: [CalendarEventMirror]
    let generatedAt: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            header
            Divider()
            if overdueTasks.isEmpty == false {
                section(title: "OVERDUE") {
                    ForEach(overdueTasks) { task in
                        taskLine(task)
                    }
                }
            }
            if todaySnapshot.dueTasks.isEmpty == false {
                section(title: "DUE TODAY") {
                    ForEach(todaySnapshot.dueTasks) { task in
                        taskLine(task)
                    }
                }
            }
            if todaySnapshot.scheduledEvents.isEmpty == false {
                section(title: "SCHEDULED") {
                    ForEach(todaySnapshot.scheduledEvents) { event in
                        eventLine(event)
                    }
                }
            }
            if upcomingEvents.isEmpty == false {
                section(title: "NEXT 24 HOURS") {
                    ForEach(upcomingEvents.prefix(12)) { event in
                        eventLine(event)
                    }
                }
            }
            if overdueTasks.isEmpty && todaySnapshot.dueTasks.isEmpty
                && todaySnapshot.scheduledEvents.isEmpty && upcomingEvents.isEmpty {
                Text("Clear day. Nothing scheduled.")
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            footer
        }
        .padding(36)
        .frame(width: 612, height: 792, alignment: .topLeading) // US Letter @ 72dpi
        .background(Color.white)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Hot Cross Buns")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(todaySnapshot.date.formatted(.dateTime.weekday(.wide).month(.wide).day().year()))
                .font(.system(.largeTitle, design: .serif, weight: .bold))
        }
    }

    @ViewBuilder
    private func section<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.caption.weight(.bold))
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 4) {
                content()
            }
        }
    }

    private func taskLine(_ task: TaskMirror) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("□")
                .font(.body.monospaced())
            Text(task.title)
                .font(.body)
            Spacer(minLength: 0)
            if let due = task.dueDate {
                Text(due.formatted(.dateTime.month(.abbreviated).day()))
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func eventLine(_ event: CalendarEventMirror) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(timeLabel(for: event))
                .font(.body.monospaced())
                .frame(width: 120, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(event.summary)
                    .font(.body)
                if event.location.isEmpty == false {
                    Text(event.location)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
        }
    }

    private func timeLabel(for event: CalendarEventMirror) -> String {
        if event.isAllDay { return "All day" }
        let start = event.startDate.formatted(.dateTime.hour().minute())
        let end = event.endDate.formatted(.dateTime.hour().minute())
        return "\(start) – \(end)"
    }

    private var footer: some View {
        Text("Generated \(generatedAt.formatted(date: .abbreviated, time: .shortened))")
            .font(.caption2)
            .foregroundStyle(.secondary)
    }
}

enum TodayPrinter {
    @MainActor
    static func print(model: AppModel) {
        let now = Date()
        let calendar = Calendar.current
        let horizon = calendar.date(byAdding: .day, value: 1, to: now) ?? now
        let selectedCalendarIDs = Set(model.calendarSnapshot.selectedCalendars.map(\.id))
        let upcoming = model.events
            .filter { event in
                event.status != .cancelled
                    && selectedCalendarIDs.contains(event.calendarID)
                    && event.startDate > now
                    && event.startDate <= horizon
            }
            .sorted { $0.startDate < $1.startDate }
        let overdue = model.tasks.filter { task in
            task.isDeleted == false && task.isCompleted == false
                && (task.dueDate.map { $0 < calendar.startOfDay(for: now) } ?? false)
        }
        let printView = TodayPrintView(
            todaySnapshot: model.todaySnapshot,
            overdueTasks: overdue,
            upcomingEvents: upcoming,
            generatedAt: now
        )

        let hosting = NSHostingController(rootView: printView)
        hosting.view.frame = NSRect(x: 0, y: 0, width: 612, height: 792)
        let printInfo = NSPrintInfo.shared.copy() as! NSPrintInfo
        printInfo.topMargin = 0
        printInfo.bottomMargin = 0
        printInfo.leftMargin = 0
        printInfo.rightMargin = 0
        printInfo.horizontalPagination = .fit
        printInfo.verticalPagination = .fit
        let operation = NSPrintOperation(view: hosting.view, printInfo: printInfo)
        operation.jobTitle = "Hot Cross Buns — \(now.formatted(date: .abbreviated, time: .omitted))"
        operation.run()
    }
}
