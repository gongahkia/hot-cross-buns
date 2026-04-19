import SwiftUI

struct DayGridView: View {
    @Environment(AppModel.self) private var model
    @Environment(RouterPath.self) private var router
    @Binding var anchorDate: Date
    var searchQuery: String = ""

    private let hourHeight: CGFloat = 48
    private let hourStart = 0
    private let hourEnd = 24
    private let calendar = Calendar.current

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            eventsColumn
                .frame(maxWidth: .infinity)
            Divider()
            tasksPanel
                .frame(width: 260)
        }
        .padding(12)
    }

    private var dayStart: Date { calendar.startOfDay(for: anchorDate) }
    private var dayEnd: Date { calendar.date(byAdding: .day, value: 1, to: dayStart) ?? dayStart }

    private var visibleEvents: [CalendarEventMirror] {
        let selected = Set(model.calendarSnapshot.selectedCalendars.map(\.id))
        let base = model.events.filter { event in
            selected.contains(event.calendarID)
                && event.status != .cancelled
                && event.endDate > dayStart
                && event.startDate < dayEnd
        }
        let q = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard q.isEmpty == false else { return base }
        return base.filter { event in
            event.summary.localizedCaseInsensitiveContains(q)
                || event.details.localizedCaseInsensitiveContains(q)
                || event.location.localizedCaseInsensitiveContains(q)
        }
    }

    private var allDayEvents: [CalendarEventMirror] {
        visibleEvents.filter(\.isAllDay).sorted { $0.summary < $1.summary }
    }

    private var timedEvents: [CalendarEventMirror] {
        visibleEvents.filter { $0.isAllDay == false }.sorted { $0.startDate < $1.startDate }
    }

    private var dayTasks: [TaskMirror] {
        let visibleLists: Set<TaskListMirror.ID> = model.settings.hasConfiguredTaskListSelection
            ? model.settings.selectedTaskListIDs
            : Set(model.taskLists.map(\.id))
        return model.tasks.filter { task in
            guard let due = task.dueDate else { return false }
            return task.isDeleted == false
                && visibleLists.contains(task.taskListID)
                && calendar.isDate(due, inSameDayAs: dayStart)
        }
        .sorted { lhs, rhs in
            if lhs.isCompleted != rhs.isCompleted { return lhs.isCompleted == false }
            return lhs.title < rhs.title
        }
    }

    @ViewBuilder
    private var eventsColumn: some View {
        VStack(alignment: .leading, spacing: 8) {
            if allDayEvents.isEmpty == false {
                VStack(alignment: .leading, spacing: 4) {
                    Text("ALL-DAY")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.secondary)
                    ForEach(allDayEvents) { event in
                        Button {
                            router.navigate(to: .event(event.id))
                        } label: {
                            Text(event.summary)
                                .font(.caption.weight(.medium))
                                .lineLimit(1)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(Capsule().fill(calendarColor(for: event).opacity(0.25)))
                                .foregroundStyle(AppColor.ink)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(event.summary), all day")
                    }
                }
            }

            ScrollView {
                ZStack(alignment: .topLeading) {
                    hourGridBackground
                    GeometryReader { geo in
                        ForEach(timedEvents, id: \.id) { event in
                            eventTile(event, columnWidth: geo.size.width - 56)
                        }
                    }
                    .frame(height: CGFloat(hourEnd - hourStart) * hourHeight)
                    if let offset = currentTimeOffset() {
                        Rectangle()
                            .fill(AppColor.ember)
                            .frame(height: 1)
                            .offset(x: 52, y: offset)
                    }
                }
                .frame(minHeight: CGFloat(hourEnd - hourStart) * hourHeight)
            }
        }
    }

    private var hourGridBackground: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(hourStart..<hourEnd, id: \.self) { hour in
                HStack(alignment: .top, spacing: 8) {
                    Text(hourLabel(hour))
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .frame(width: 48, alignment: .trailing)
                    Rectangle()
                        .fill(AppColor.cardStroke)
                        .frame(height: 0.5)
                        .frame(maxWidth: .infinity)
                }
                .frame(height: hourHeight, alignment: .top)
            }
        }
    }

    private func hourLabel(_ hour: Int) -> String {
        var comps = DateComponents()
        comps.hour = hour
        guard let date = calendar.date(from: comps) else { return "" }
        return date.formatted(.dateTime.hour())
    }

    private func eventTile(_ event: CalendarEventMirror, columnWidth: CGFloat) -> some View {
        let clampedStart = max(event.startDate, dayStart)
        let clampedEnd = min(event.endDate, dayEnd)
        let startMinutes = clampedStart.timeIntervalSince(dayStart) / 60
        let durationMinutes = max(clampedEnd.timeIntervalSince(clampedStart) / 60, 20)
        let yOffset = CGFloat(startMinutes) * (hourHeight / 60)
        let height = CGFloat(durationMinutes) * (hourHeight / 60)
        let fill = calendarColor(for: event)

        return Button {
            router.navigate(to: .event(event.id))
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(event.summary)
                    .font(.caption.weight(.semibold))
                    .lineLimit(2)
                if height > 38 {
                    Text("\(event.startDate.formatted(.dateTime.hour().minute())) – \(event.endDate.formatted(.dateTime.hour().minute()))")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                if height > 60, event.location.isEmpty == false {
                    Text(event.location)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .frame(width: max(columnWidth, 60), height: height - 2, alignment: .topLeading)
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(fill.opacity(0.22)))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(fill.opacity(0.55), lineWidth: 0.8))
        }
        .buttonStyle(.plain)
        .offset(x: 56, y: yOffset)
        .accessibilityLabel("\(event.summary), \(event.startDate.formatted(.dateTime.hour().minute())) to \(event.endDate.formatted(.dateTime.hour().minute()))")
    }

    private func currentTimeOffset() -> CGFloat? {
        guard calendar.isDate(anchorDate, inSameDayAs: Date()) else { return nil }
        let now = Date()
        guard now >= dayStart, now <= dayEnd else { return nil }
        let minutes = now.timeIntervalSince(dayStart) / 60
        return CGFloat(minutes) * (hourHeight / 60)
    }

    private var tasksPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Due Today")
                    .font(.headline)
                Spacer()
                Text("\(dayTasks.filter { $0.isCompleted == false }.count) open")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            if dayTasks.isEmpty {
                ContentUnavailableView(
                    "No tasks due this day",
                    systemImage: "checklist",
                    description: Text("Drop a task onto a day in the Week view to schedule it.")
                )
                .frame(maxWidth: .infinity, alignment: .center)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(dayTasks) { task in
                            Button {
                                router.navigate(to: .task(task.id))
                            } label: {
                                HStack(spacing: 8) {
                                    Image(systemName: task.isCompleted ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(task.isCompleted ? AppColor.moss : AppColor.ember)
                                    Text(task.title)
                                        .font(.subheadline)
                                        .strikethrough(task.isCompleted)
                                        .foregroundStyle(AppColor.ink)
                                    Spacer(minLength: 0)
                                }
                                .padding(8)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(AppColor.cream.opacity(0.4)))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
        .cardSurface(cornerRadius: 16)
    }

    private func calendarColor(for event: CalendarEventMirror) -> Color {
        if let hex = CalendarEventColor.from(colorId: event.colorId).hex {
            return Color(hex: hex)
        }
        guard let cal = model.calendars.first(where: { $0.id == event.calendarID }) else { return AppColor.blue }
        return Color(hex: cal.colorHex)
    }
}
