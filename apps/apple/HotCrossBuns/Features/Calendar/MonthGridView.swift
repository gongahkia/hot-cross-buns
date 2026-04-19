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

    private let laneHeight: CGFloat = 18
    private let laneSpacing: CGFloat = 2
    private let maxVisibleLanes: Int = 3

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

    private var filteredEvents: [CalendarEventMirror] {
        let selected = Set(model.calendarSnapshot.selectedCalendars.map(\.id))
        let base = model.events.filter { selected.contains($0.calendarID) }
        let q = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return q.isEmpty ? base : base.filter { event in
            event.summary.localizedCaseInsensitiveContains(q)
                || event.details.localizedCaseInsensitiveContains(q)
                || event.location.localizedCaseInsensitiveContains(q)
        }
    }

    private var eventsByDay: [Date: [CalendarEventMirror]] {
        CalendarGridLayout.eventsByDay(
            filteredEvents,
            from: cells.first ?? anchorDate,
            to: cells.last ?? anchorDate,
            calendar: calendar
        )
    }

    private var weekdayHeader: some View {
        HStack(spacing: 0) {
            ForEach(weekdaySymbols, id: \.self) { symbol in
                Text(symbol)
                    .hcbFont(.caption, weight: .semibold)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
            }
        }
        .hcbScaledPadding(.vertical, 8)
    }

    private var grid: some View {
        let groupedCells = stride(from: 0, to: cells.count, by: 7).map { start in
            Array(cells[start..<min(start + 7, cells.count)])
        }
        return GeometryReader { geo in
            let rowHeight = geo.size.height / CGFloat(groupedCells.count)
            VStack(spacing: 0) {
                ForEach(Array(groupedCells.enumerated()), id: \.offset) { _, row in
                    weekRow(row, rowHeight: rowHeight, weekWidth: geo.size.width)
                }
            }
        }
    }

    private func weekRow(_ days: [Date], rowHeight: CGFloat, weekWidth: CGFloat) -> some View {
        let cellWidth = weekWidth / CGFloat(max(days.count, 1))
        let bands = CalendarGridLayout.monthBands(for: days, events: filteredEvents, calendar: calendar)
        let visibleLaneCount = min(maxVisibleLanes, (bands.map(\.lane).max() ?? -1) + 1)
        let bandAreaHeight: CGFloat = visibleLaneCount > 0
            ? CGFloat(visibleLaneCount) * laneHeight + CGFloat(max(visibleLaneCount - 1, 0)) * laneSpacing + 4
            : 0

        return ZStack(alignment: .topLeading) {
            HStack(spacing: 0) {
                ForEach(days, id: \.self) { day in
                    monthCell(day: day, bandReserve: bandAreaHeight)
                        .frame(maxWidth: .infinity, minHeight: rowHeight, maxHeight: rowHeight, alignment: .top)
                }
            }
            bandOverlay(bands: bands, cellWidth: cellWidth)
        }
    }

    private func bandOverlay(bands: [CalendarGridLayout.MonthBand], cellWidth: CGFloat) -> some View {
        let dayNumberReserve: CGFloat = 24 // matches the hcbScaledPadding(6) + day-number row height
        return ZStack(alignment: .topLeading) {
            ForEach(bands) { band in
                if band.lane < maxVisibleLanes {
                    CalendarEventPreviewButton(event: band.event) {
                        Text(band.event.summary)
                            .hcbFont(.caption2)
                            .lineLimit(1)
                            .hcbScaledPadding(.horizontal, 6)
                            .hcbScaledPadding(.vertical, 2)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(
                                RoundedRectangle(cornerRadius: 4, style: .continuous)
                                    .fill(calendarColor(for: band.event).opacity(0.25))
                            )
                            .foregroundStyle(AppColor.ink)
                    }
                    .accessibilityLabel("\(band.event.summary) \(band.event.startDate.formatted(date: .abbreviated, time: .omitted)) – \(band.event.endDate.formatted(date: .abbreviated, time: .omitted))")
                    .frame(width: cellWidth * CGFloat(band.endColumn - band.startColumn + 1) - 4)
                    .offset(
                        x: cellWidth * CGFloat(band.startColumn) + 2,
                        y: dayNumberReserve + CGFloat(band.lane) * (laneHeight + laneSpacing)
                    )
                    .draggable(DraggedEvent(
                        eventID: band.event.id,
                        calendarID: band.event.calendarID,
                        durationMinutes: Int(max(band.event.endDate.timeIntervalSince(band.event.startDate) / 60, 15)),
                        isAllDay: band.event.isAllDay
                    )) {
                        Text(band.event.summary)
                            .hcbFont(.caption)
                            .hcbScaledPadding(.horizontal, 8)
                            .hcbScaledPadding(.vertical, 4)
                            .background(Capsule().fill(calendarColor(for: band.event).opacity(0.35)))
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
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

    private func monthCell(day: Date, bandReserve: CGFloat) -> some View {
        let dayStart = calendar.startOfDay(for: day)
        let isCurrentMonth = calendar.component(.month, from: day) == calendar.component(.month, from: anchorDate)
        let allEventsToday = eventsByDay[dayStart] ?? []
        // Bands render in the overlay; per-cell shows only timed single-day events.
        let events = allEventsToday.filter { CalendarGridLayout.isBandEvent($0, calendar: calendar) == false }
        let tasks = tasksForDay(day)
        let eventSlots = 2
        let taskSlots = 2
        // +N more counts the hidden band events too so users see them accounted for.
        let hiddenBandEvents = max(0, allEventsToday.count - events.count - visibleBandCount(for: dayStart, in: day, allEventsToday: allEventsToday))
        return VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text("\(calendar.component(.day, from: day))")
                    .hcbFont(.caption, weight: .semibold)
                    .foregroundStyle(dayNumberColor(isCurrentMonth: isCurrentMonth, day: day))
                    .hcbScaledPadding(.horizontal, 6)
                    .hcbScaledPadding(.vertical, 2)
                    .background(
                        Capsule()
                            .fill(calendar.isDateInToday(day) ? AppColor.ember.opacity(0.25) : .clear)
                    )
                Spacer(minLength: 0)
            }
            if bandReserve > 0 {
                Color.clear.frame(height: bandReserve)
            }
            ForEach(events.prefix(eventSlots), id: \.id) { event in
                CalendarEventPreviewButton(event: event) {
                    Text(eventLabel(event, in: day))
                        .hcbFont(.caption2)
                        .lineLimit(1)
                        .hcbScaledPadding(.horizontal, 6)
                        .hcbScaledPadding(.vertical, 2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(
                            RoundedRectangle(cornerRadius: 4, style: .continuous)
                                .fill(calendarColor(for: event).opacity(0.25))
                        )
                        .foregroundStyle(AppColor.ink)
                }
                .accessibilityLabel("\(event.summary) on \(day.formatted(.dateTime.weekday(.wide).month(.abbreviated).day()))")
                .draggable(DraggedEvent(
                    eventID: event.id,
                    calendarID: event.calendarID,
                    durationMinutes: Int(max(event.endDate.timeIntervalSince(event.startDate) / 60, 15)),
                    isAllDay: event.isAllDay
                )) {
                    Text(event.summary)
                        .hcbFont(.caption)
                        .hcbScaledPadding(.horizontal, 8)
                        .hcbScaledPadding(.vertical, 4)
                        .background(Capsule().fill(calendarColor(for: event).opacity(0.35)))
                }
            }
            ForEach(tasks.prefix(taskSlots)) { task in
                CalendarTaskPreviewButton(task: task) {
                    HStack(spacing: 3) {
                        Image(systemName: "circle")
                            .hcbFontSystem(size: 7)
                            .foregroundStyle(AppColor.ember)
                            .accessibilityHidden(true)
                        Text(task.title)
                            .hcbFont(.caption2)
                            .lineLimit(1)
                    }
                    .hcbScaledPadding(.horizontal, 6)
                    .hcbScaledPadding(.vertical, 2)
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
            }
            let hiddenEvents = max(0, events.count - eventSlots) + hiddenBandEvents
            let hiddenTasks = max(0, tasks.count - taskSlots)
            if hiddenEvents + hiddenTasks > 0 {
                Text("+\(hiddenEvents + hiddenTasks) more")
                    .hcbFont(.caption2)
                    .foregroundStyle(.secondary)
                    .hcbScaledPadding(.leading, 6)
            }
            Spacer(minLength: 0)
        }
        .hcbScaledPadding(6)
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

    // How many band events for this specific day are visible in the overlay
    // (counted against maxVisibleLanes). Used to compute +N more accurately.
    private func visibleBandCount(for dayStart: Date, in day: Date, allEventsToday: [CalendarEventMirror]) -> Int {
        let bandEventsToday = allEventsToday.filter { CalendarGridLayout.isBandEvent($0, calendar: calendar) }
        // Overlay caps to maxVisibleLanes per week — approximate here by capping to maxVisibleLanes per day.
        return min(bandEventsToday.count, maxVisibleLanes)
    }

    private func rescheduleDroppedEvent(_ dropped: DraggedEvent, to dayStart: Date) async {
        guard let event = model.event(id: dropped.eventID) else { return }
        let newStart: Date
        let newEnd: Date
        if event.isAllDay {
            newStart = dayStart
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
