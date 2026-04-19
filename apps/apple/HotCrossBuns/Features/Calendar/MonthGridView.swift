import SwiftUI

struct MonthGridView: View {
    @Environment(AppModel.self) private var model
    @Environment(RouterPath.self) private var router
    @Binding var anchorDate: Date
    var searchQuery: String = ""

    private let calendar = Calendar.current
    private let weekdaySymbols: [String] = {
        var cal = Calendar.current
        cal.locale = Locale.current
        let formatter = DateFormatter()
        formatter.calendar = cal
        let symbols = formatter.shortWeekdaySymbols ?? []
        let firstWeekday = cal.firstWeekday - 1
        guard firstWeekday < symbols.count else { return symbols }
        return Array(symbols[firstWeekday...]) + Array(symbols[..<firstWeekday])
    }()

    var body: some View {
        VStack(spacing: 0) {
            weekdayHeader
            Divider()
            grid
        }
    }

    private var cells: [Date] {
        CalendarGridLayout.monthCells(for: anchorDate, calendar: calendar)
    }

    private var eventsByDay: [Date: [CalendarEventMirror]] {
        let selected = Set(model.calendarSnapshot.selectedCalendars.map(\.id))
        let base = model.events.filter { selected.contains($0.calendarID) }
        let q = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let events = q.isEmpty ? base : base.filter { event in
            event.summary.localizedCaseInsensitiveContains(q)
                || event.details.localizedCaseInsensitiveContains(q)
                || event.location.localizedCaseInsensitiveContains(q)
        }
        return CalendarGridLayout.eventsByDay(
            events,
            from: cells.first ?? anchorDate,
            to: cells.last ?? anchorDate,
            calendar: calendar
        )
    }

    private var weekdayHeader: some View {
        HStack(spacing: 0) {
            ForEach(weekdaySymbols, id: \.self) { symbol in
                Text(symbol)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
            }
        }
        .padding(.vertical, 8)
    }

    private var grid: some View {
        let groupedCells = stride(from: 0, to: cells.count, by: 7).map { start in
            Array(cells[start..<min(start + 7, cells.count)])
        }
        return GeometryReader { geo in
            let rowHeight = geo.size.height / CGFloat(groupedCells.count)
            VStack(spacing: 0) {
                ForEach(Array(groupedCells.enumerated()), id: \.offset) { _, row in
                    HStack(spacing: 0) {
                        ForEach(row, id: \.self) { day in
                            monthCell(day: day)
                                .frame(maxWidth: .infinity, minHeight: rowHeight, maxHeight: rowHeight, alignment: .top)
                        }
                    }
                }
            }
        }
    }

    private var visibleTasks: [TaskMirror] {
        let visibleLists: Set<TaskListMirror.ID> = model.settings.hasConfiguredTaskListSelection
            ? model.settings.selectedTaskListIDs
            : Set(model.taskLists.map(\.id))
        return model.tasks.filter { task in
            task.isDeleted == false
                && task.isCompleted == false
                && visibleLists.contains(task.taskListID)
                && task.dueDate != nil
        }
    }

    private func tasksForDay(_ day: Date) -> [TaskMirror] {
        let dayStart = calendar.startOfDay(for: day)
        return visibleTasks.filter { task in
            guard let due = task.dueDate else { return false }
            return calendar.isDate(due, inSameDayAs: dayStart)
        }
    }

    private func monthCell(day: Date) -> some View {
        let dayStart = calendar.startOfDay(for: day)
        let isCurrentMonth = calendar.component(.month, from: day) == calendar.component(.month, from: anchorDate)
        let events = eventsByDay[dayStart] ?? []
        let tasks = tasksForDay(day)
        let eventSlots = 3
        let taskSlots = max(0, 2)
        return VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text("\(calendar.component(.day, from: day))")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(dayNumberColor(isCurrentMonth: isCurrentMonth, day: day))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(
                        Capsule()
                            .fill(calendar.isDateInToday(day) ? AppColor.ember.opacity(0.25) : .clear)
                    )
                Spacer(minLength: 0)
            }
            ForEach(events.prefix(eventSlots), id: \.id) { event in
                Button {
                    router.navigate(to: .event(event.id))
                } label: {
                    Text(eventLabel(event, in: day))
                        .font(.caption2)
                        .lineLimit(1)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(
                            RoundedRectangle(cornerRadius: 4, style: .continuous)
                                .fill(calendarColor(for: event).opacity(0.25))
                        )
                        .foregroundStyle(AppColor.ink)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(event.summary) on \(day.formatted(.dateTime.weekday(.wide).month(.abbreviated).day()))")
                .accessibilityHint("Opens event details")
                .draggable(DraggedEvent(
                    eventID: event.id,
                    calendarID: event.calendarID,
                    durationMinutes: Int(max(event.endDate.timeIntervalSince(event.startDate) / 60, 15)),
                    isAllDay: event.isAllDay
                )) {
                    Text(event.summary)
                        .font(.caption)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(calendarColor(for: event).opacity(0.35)))
                }
            }
            ForEach(tasks.prefix(taskSlots)) { task in
                Button {
                    router.navigate(to: .task(task.id))
                } label: {
                    HStack(spacing: 3) {
                        Image(systemName: "circle")
                            .font(.system(size: 7))
                            .foregroundStyle(AppColor.ember)
                            .accessibilityHidden(true)
                        Text(task.title)
                            .font(.caption2)
                            .lineLimit(1)
                    }
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: 4, style: .continuous)
                            .fill(AppColor.ember.opacity(0.15))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 4, style: .continuous)
                            .strokeBorder(AppColor.ember.opacity(0.35), lineWidth: 0.6)
                    )
                    .foregroundStyle(AppColor.ink)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Task due \(day.formatted(.dateTime.weekday(.wide).month(.abbreviated).day())): \(task.title)")
                .accessibilityHint("Opens task details")
            }
            let hiddenEvents = max(0, events.count - eventSlots)
            let hiddenTasks = max(0, tasks.count - taskSlots)
            if hiddenEvents + hiddenTasks > 0 {
                Text("+\(hiddenEvents + hiddenTasks) more")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .padding(.leading, 6)
            }
            Spacer(minLength: 0)
        }
        .padding(6)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(
            Rectangle()
                .fill(isCurrentMonth ? Color.clear : AppColor.cream.opacity(0.15))
        )
        .overlay(
            Rectangle()
                .strokeBorder(AppColor.cardStroke, lineWidth: 0.5)
        )
        .contentShape(Rectangle())
        .onTapGesture {
            router.present(.quickCreate(dayStart, allDay: true))
        }
        .dropDestination(for: DraggedEvent.self) { items, _ in
            guard let dropped = items.first else { return false }
            Task {
                await rescheduleDroppedEvent(dropped, to: dayStart)
            }
            return true
        }
        .dropDestination(for: DraggedTask.self) { items, _ in
            guard let dropped = items.first else { return false }
            Task {
                await retargetDroppedTask(dropped, to: dayStart)
            }
            return true
        }
    }

    private func rescheduleDroppedEvent(_ dropped: DraggedEvent, to dayStart: Date) async {
        guard let event = model.event(id: dropped.eventID) else { return }
        // Preserve hour/minute for timed events, preserve multi-day span for
        // all-day events. New start = dayStart + (event.startDate - startOfDay(event.startDate)).
        let newStart: Date
        let newEnd: Date
        if event.isAllDay {
            newStart = dayStart
            // Duration (inclusive days) preserved.
            let duration = calendar.dateComponents([.day], from: calendar.startOfDay(for: event.startDate), to: event.endDate).day ?? 0
            newEnd = calendar.date(byAdding: .day, value: max(duration, 1), to: dayStart) ?? dayStart
        } else {
            let startComponents = calendar.dateComponents([.hour, .minute, .second], from: event.startDate)
            let duration = event.endDate.timeIntervalSince(event.startDate)
            newStart = calendar.date(bySettingHour: startComponents.hour ?? 9, minute: startComponents.minute ?? 0, second: startComponents.second ?? 0, of: dayStart) ?? dayStart
            newEnd = newStart.addingTimeInterval(duration)
        }
        if event.startDate == newStart && event.endDate == newEnd { return }
        let inclusiveEnd = event.isAllDay
            ? (calendar.date(byAdding: .day, value: -1, to: newEnd) ?? newEnd)
            : newEnd
        _ = await model.updateEvent(
            event,
            summary: event.summary,
            details: event.details,
            startDate: newStart,
            endDate: inclusiveEnd,
            isAllDay: event.isAllDay,
            reminderMinutes: event.reminderMinutes.first,
            calendarID: event.calendarID,
            location: event.location,
            recurrence: event.recurrence,
            attendeeEmails: event.attendeeEmails,
            notifyGuests: false
        )
    }

    private func retargetDroppedTask(_ dropped: DraggedTask, to dayStart: Date) async {
        guard let task = model.task(id: dropped.taskID) else { return }
        // Only due date changes; title / notes / list stay. Uses local-midnight
        // semantics established by GoogleTaskDueDateFormatter.
        _ = await model.updateTask(
            task,
            title: task.title,
            notes: task.notes,
            dueDate: dayStart
        )
    }

    private func eventLabel(_ event: CalendarEventMirror, in day: Date) -> String {
        if event.isAllDay { return event.summary }
        let start = calendar.startOfDay(for: event.startDate)
        let dayStart = calendar.startOfDay(for: day)
        if start < dayStart {
            return "… \(event.summary)"
        }
        return "\(event.startDate.formatted(.dateTime.hour().minute())) \(event.summary)"
    }

    private func dayNumberColor(isCurrentMonth: Bool, day: Date) -> Color {
        if calendar.isDateInToday(day) { return AppColor.ember }
        return isCurrentMonth ? AppColor.ink : .secondary
    }

    private func calendarColor(for event: CalendarEventMirror) -> Color {
        if let hex = CalendarEventColor.from(colorId: event.colorId).hex {
            return Color(hex: hex)
        }
        guard let cal = model.calendars.first(where: { $0.id == event.calendarID }) else { return AppColor.blue }
        return Color(hex: cal.colorHex)
    }
}
