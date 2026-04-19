import AppKit
import SwiftUI
import UniformTypeIdentifiers

struct WeekGridView: View {
    @Environment(AppModel.self) private var model
    @Environment(RouterPath.self) private var router
    @Binding var anchorDate: Date
    var searchQuery: String = ""
    @Binding var selectedEventIDs: Set<String>

    init(
        anchorDate: Binding<Date>,
        searchQuery: String = "",
        selectedEventIDs: Binding<Set<String>> = .constant([])
    ) {
        _anchorDate = anchorDate
        self.searchQuery = searchQuery
        _selectedEventIDs = selectedEventIDs
    }

    private let hourHeight: CGFloat = 44
    private let hourStart = 0
    private let hourEnd = 24
    private let calendar = Calendar.current

    var body: some View {
        VStack(spacing: 0) {
            weekHeader
            Divider()
            allDayStrip
            tasksStrip
            Divider()
            ScrollView {
                timeGrid
            }
        }
    }

    private var weekDays: [Date] {
        CalendarGridLayout.weekDays(containing: anchorDate, calendar: calendar)
    }

    private var visibleEvents: [CalendarEventMirror] {
        let selected = Set(model.calendarSnapshot.selectedCalendars.map(\.id))
        let base = model.events.filter { selected.contains($0.calendarID) && $0.status != .cancelled }
        let q = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard q.isEmpty == false else { return base }
        return base.filter { event in
            event.summary.localizedCaseInsensitiveContains(q)
                || event.details.localizedCaseInsensitiveContains(q)
                || event.location.localizedCaseInsensitiveContains(q)
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
        return visibleTasks
            .filter { task in
                guard let due = task.dueDate else { return false }
                return calendar.isDate(due, inSameDayAs: dayStart)
            }
            .sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
    }

    private var weekHeader: some View {
        HStack(spacing: 0) {
            Text("")
                .frame(width: 54)
            ForEach(weekDays, id: \.self) { day in
                VStack(spacing: 2) {
                    Text(day.formatted(.dateTime.weekday(.abbreviated)))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text(day.formatted(.dateTime.day()))
                        .font(.title3.weight(isToday(day) ? .bold : .regular))
                        .foregroundStyle(isToday(day) ? AppColor.ember : AppColor.ink)
                        .frame(width: 30, height: 30)
                        .background(
                            Circle()
                                .fill(isToday(day) ? AppColor.ember.opacity(0.15) : .clear)
                        )
                }
                .frame(maxWidth: .infinity)
            }
        }
        .padding(.vertical, 10)
    }

    private struct AllDaySpan: Identifiable {
        let event: CalendarEventMirror
        let startColumn: Int
        let endColumn: Int // inclusive
        let laneIndex: Int

        var id: String { event.id }
        var columnCount: Int { endColumn - startColumn + 1 }
    }

    private func layoutAllDaySpans() -> [AllDaySpan] {
        guard let weekStart = weekDays.first, let weekEnd = weekDays.last else { return [] }
        let weekStartDay = calendar.startOfDay(for: weekStart)
        let weekEndDay = calendar.startOfDay(for: weekEnd)
        let allDay = visibleEvents.filter { $0.isAllDay }

        let spans: [(event: CalendarEventMirror, start: Int, end: Int)] = allDay.compactMap { event in
            let eventStart = calendar.startOfDay(for: event.startDate)
            // `CalendarGridLayout.eventEndDay` returns the inclusive end day
            // for all-day events.
            let eventEnd = CalendarGridLayout.eventEndDay(event: event, calendar: calendar)
            guard eventStart <= weekEndDay, eventEnd >= weekStartDay else { return nil }
            let clampedStart = max(eventStart, weekStartDay)
            let clampedEnd = min(eventEnd, weekEndDay)
            let startIdx = calendar.dateComponents([.day], from: weekStartDay, to: clampedStart).day ?? 0
            let endIdx = calendar.dateComponents([.day], from: weekStartDay, to: clampedEnd).day ?? 0
            return (event, max(0, min(6, startIdx)), max(0, min(6, endIdx)))
        }

        // Lane assignment: sort by start column, then place each span into the
        // lowest-index lane whose previous span's end is < this span's start.
        let sorted = spans.sorted { lhs, rhs in
            if lhs.start != rhs.start { return lhs.start < rhs.start }
            return lhs.end > rhs.end
        }
        var lanes: [[Int]] = [] // end-column per lane
        var assigned: [AllDaySpan] = []
        for span in sorted {
            var placedLane: Int?
            for (index, lane) in lanes.enumerated() {
                if let last = lane.last, last >= span.start { continue }
                lanes[index].append(span.end)
                placedLane = index
                break
            }
            if placedLane == nil {
                lanes.append([span.end])
                placedLane = lanes.count - 1
            }
            assigned.append(AllDaySpan(
                event: span.event,
                startColumn: span.start,
                endColumn: span.end,
                laneIndex: placedLane ?? 0
            ))
        }
        return assigned
    }

    private var allDayStrip: some View {
        let spans = layoutAllDaySpans()
        let laneCount = (spans.map(\.laneIndex).max() ?? -1) + 1
        return Group {
            if laneCount == 0 {
                EmptyView()
            } else {
                HStack(spacing: 0) {
                    Text("All-day")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 54, alignment: .trailing)
                        .padding(.trailing, 6)
                    GeometryReader { geo in
                        let columnWidth = geo.size.width / 7
                        let laneHeight: CGFloat = 22
                        ZStack(alignment: .topLeading) {
                            ForEach(spans) { span in
                                allDaySpanTile(span, columnWidth: columnWidth, laneHeight: laneHeight)
                            }
                        }
                    }
                    .frame(height: CGFloat(min(laneCount, 3)) * 22)
                }
                .padding(.vertical, 4)
            }
        }
    }

    private func allDaySpanTile(_ span: AllDaySpan, columnWidth: CGFloat, laneHeight: CGFloat) -> some View {
        let x = CGFloat(span.startColumn) * columnWidth + 2
        let width = CGFloat(span.columnCount) * columnWidth - 4
        let y = CGFloat(span.laneIndex) * laneHeight + 2
        let fill = calendarColor(for: span.event)
        return Button {
            router.navigate(to: .event(span.event.id))
        } label: {
            Text(span.event.summary)
                .font(.caption)
                .lineLimit(1)
                .padding(.horizontal, 6)
                .padding(.vertical, 3)
                .frame(width: max(width, 20), height: laneHeight - 4, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 5, style: .continuous)
                        .fill(fill.opacity(0.3))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 5, style: .continuous)
                        .strokeBorder(fill.opacity(0.5), lineWidth: 0.8)
                )
                .foregroundStyle(AppColor.ink)
        }
        .buttonStyle(.plain)
        .offset(x: x, y: y)
        .accessibilityLabel(eventAccessibilityLabel(span.event))
        .accessibilityHint("Opens event details")
    }

    private func exportSingleEventICS(_ event: CalendarEventMirror) {
        let ics = EventICSExporter.ics(for: event)
        let sanitized = event.summary
            .replacingOccurrences(of: "/", with: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let base = sanitized.isEmpty ? "event" : sanitized
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "\(base).ics"
        panel.allowedContentTypes = [UTType(filenameExtension: "ics") ?? .data]
        panel.canCreateDirectories = true
        if panel.runModal() == .OK, let url = panel.url {
            try? ics.data(using: .utf8)?.write(to: url)
        }
    }

    private func copyEventMarkdown(_ event: CalendarEventMirror) {
        let title = model.calendars.first(where: { $0.id == event.calendarID })?.summary
        let md = EventMarkdownExporter.markdown(for: event, calendarTitle: title)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(md, forType: .string)
    }

    private func toggleSelection(_ id: String) {
        if selectedEventIDs.contains(id) {
            selectedEventIDs.remove(id)
        } else {
            selectedEventIDs.insert(id)
        }
    }

    private func eventAccessibilityLabel(_ event: CalendarEventMirror) -> String {
        if event.isAllDay {
            return "\(event.summary), all day \(event.startDate.formatted(.dateTime.weekday(.wide).month(.abbreviated).day()))"
        }
        let start = event.startDate.formatted(.dateTime.weekday(.wide).hour().minute())
        let end = event.endDate.formatted(.dateTime.hour().minute())
        return "\(event.summary), \(start) to \(end)"
    }

    private var tasksStrip: some View {
        let tasksByDay: [Date: [TaskMirror]] = Dictionary(uniqueKeysWithValues: weekDays.map { day in
            (calendar.startOfDay(for: day), tasksForDay(day))
        })
        let maxLanes = tasksByDay.values.map(\.count).max() ?? 0
        return Group {
            if maxLanes == 0 {
                EmptyView()
            } else {
                HStack(spacing: 0) {
                    Text("Tasks")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 54, alignment: .trailing)
                        .padding(.trailing, 6)
                    GeometryReader { geo in
                        let columnWidth = geo.size.width / 7
                        ZStack(alignment: .topLeading) {
                            ForEach(Array(weekDays.enumerated()), id: \.offset) { idx, day in
                                VStack(alignment: .leading, spacing: 2) {
                                    ForEach((tasksByDay[calendar.startOfDay(for: day)] ?? []).prefix(3)) { task in
                                        Button {
                                            router.navigate(to: .task(task.id))
                                        } label: {
                                            HStack(spacing: 4) {
                                                Image(systemName: "circle")
                                                    .font(.system(size: 8))
                                                    .foregroundStyle(AppColor.ember)
                                                    .accessibilityHidden(true)
                                                Text(task.title)
                                                    .font(.caption)
                                                    .lineLimit(1)
                                            }
                                            .padding(.horizontal, 6)
                                            .padding(.vertical, 3)
                                            .frame(maxWidth: .infinity, alignment: .leading)
                                            .background(
                                                RoundedRectangle(cornerRadius: 5, style: .continuous)
                                                    .fill(AppColor.ember.opacity(0.15))
                                            )
                                            .overlay(
                                                RoundedRectangle(cornerRadius: 5, style: .continuous)
                                                    .strokeBorder(AppColor.ember.opacity(0.35), lineWidth: 0.8)
                                            )
                                            .foregroundStyle(AppColor.ink)
                                        }
                                        .buttonStyle(.plain)
                                        .accessibilityLabel("Task due \(day.formatted(.dateTime.weekday(.wide).month(.abbreviated).day())): \(task.title)")
                                        .accessibilityHint("Opens task details")
                                    }
                                    if let count = tasksByDay[calendar.startOfDay(for: day)]?.count, count > 3 {
                                        Text("+\(count - 3) more")
                                            .font(.caption2)
                                            .foregroundStyle(.secondary)
                                            .padding(.leading, 4)
                                    }
                                }
                                .padding(.horizontal, 2)
                                .frame(width: columnWidth, alignment: .leading)
                                .offset(x: CGFloat(idx) * columnWidth)
                            }
                        }
                    }
                    .frame(height: CGFloat(min(maxLanes, 3)) * 22)
                }
                .padding(.vertical, 4)
            }
        }
    }

    private var timeGrid: some View {
        HStack(alignment: .top, spacing: 0) {
            hoursColumn
            GeometryReader { geo in
                let columnWidth = geo.size.width / 7
                ZStack(alignment: .topLeading) {
                    gridLines
                    ForEach(Array(weekDays.enumerated()), id: \.offset) { idx, day in
                        dayColumn(day: day, xOffset: CGFloat(idx) * columnWidth, width: columnWidth)
                    }
                    if let nowOffset = currentTimeOffset() {
                        nowIndicator(offset: nowOffset)
                    }
                }
                .frame(height: CGFloat(hourEnd - hourStart) * hourHeight)
            }
        }
    }

    private var hoursColumn: some View {
        VStack(spacing: 0) {
            ForEach(hourStart..<hourEnd, id: \.self) { hour in
                HStack {
                    Spacer()
                    Text(labelForHour(hour))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .offset(y: -6)
                        .padding(.trailing, 6)
                }
                .frame(height: hourHeight, alignment: .top)
            }
        }
        .frame(width: 54)
    }

    private var gridLines: some View {
        VStack(spacing: 0) {
            ForEach(hourStart..<hourEnd, id: \.self) { _ in
                Divider()
                    .frame(height: hourHeight, alignment: .top)
            }
        }
    }

    private func dayColumn(day: Date, xOffset: CGFloat, width: CGFloat) -> some View {
        let startOfDay = calendar.startOfDay(for: day)
        let endOfDay = calendar.date(byAdding: .day, value: 1, to: startOfDay) ?? startOfDay
        let eventsForDay = visibleEvents.filter { event in
            event.isAllDay == false && event.startDate < endOfDay && event.endDate > startOfDay
        }
        let laid = CalendarGridLayout.layout(eventsInDay: eventsForDay, calendar: calendar)

        return ZStack(alignment: .topLeading) {
            TapToCreateLayer(
                hourHeight: hourHeight,
                dayStart: startOfDay,
                calendar: calendar,
                onTap: { start in
                    router.present(.addEventAt(start, allDay: false))
                }
            )
            .dropDestination(for: DraggedTask.self) { items, location in
                guard let dropped = items.first else { return false }
                Task {
                    await scheduleTaskAsEvent(dropped, dropY: location.y, dayStart: startOfDay)
                }
                return true
            }
            .dropDestination(for: DraggedEvent.self) { items, location in
                guard let dropped = items.first else { return false }
                Task {
                    await rescheduleEvent(dropped, dropY: location.y, dayStart: startOfDay)
                }
                return true
            }
            ForEach(Array(laid.enumerated()), id: \.offset) { _, placed in
                eventTile(placed: placed, dayStart: startOfDay, dayEnd: endOfDay, columnWidth: width)
            }
        }
        .frame(width: width)
        .offset(x: xOffset)
    }

    private struct TapToCreateLayer: View {
        let hourHeight: CGFloat
        let dayStart: Date
        let calendar: Calendar
        let onTap: (Date) -> Void

        var body: some View {
            Rectangle()
                .fill(Color.clear)
                .contentShape(Rectangle())
                .gesture(
                    SpatialTapGesture(count: 2)
                        .onEnded { value in
                            let start = CalendarDropComputer.snappedStart(
                                for: value.location.y,
                                hourHeight: hourHeight,
                                dayStart: dayStart,
                                calendar: calendar
                            )
                            onTap(start)
                        }
                )
        }
    }

    private func scheduleTaskAsEvent(_ dropped: DraggedTask, dropY: CGFloat, dayStart: Date) async {
        let start = CalendarDropComputer.snappedStart(for: dropY, hourHeight: hourHeight, dayStart: dayStart, calendar: calendar)
        let end = CalendarDropComputer.defaultEndDate(from: start, calendar: calendar)
        let destinationCalendar = primaryEditableCalendarID() ?? model.calendarSnapshot.selectedCalendars.first?.id
        guard let calendarID = destinationCalendar else { return }
        _ = await model.createEvent(
            summary: dropped.title,
            details: CalendarDropComputer.backLinkDescription(for: dropped.title, taskID: dropped.taskID),
            startDate: start,
            endDate: end,
            isAllDay: false,
            reminderMinutes: nil,
            calendarID: calendarID
        )
    }

    private func rescheduleEvent(_ dropped: DraggedEvent, dropY: CGFloat, dayStart: Date) async {
        guard dropped.isAllDay == false else { return }
        guard let event = model.event(id: dropped.eventID) else { return }
        let snappedStart = CalendarDropComputer.snappedStart(for: dropY, hourHeight: hourHeight, dayStart: dayStart, calendar: calendar)
        guard let newEnd = calendar.date(byAdding: .minute, value: dropped.durationMinutes, to: snappedStart) else { return }
        if event.startDate == snappedStart && event.endDate == newEnd { return }
        _ = await model.updateEvent(
            event,
            summary: event.summary,
            details: event.details,
            startDate: snappedStart,
            endDate: newEnd,
            isAllDay: false,
            reminderMinutes: event.reminderMinutes.first,
            calendarID: event.calendarID,
            location: event.location,
            attendeeEmails: event.attendeeEmails,
            notifyGuests: false
        )
    }

    private func primaryEditableCalendarID() -> CalendarListMirror.ID? {
        model.calendarSnapshot.selectedCalendars.first(where: { $0.accessRole == "owner" || $0.accessRole == "writer" })?.id
    }

    private func eventTile(placed: CalendarGridLayout.LaidOutEvent, dayStart: Date, dayEnd: Date, columnWidth: CGFloat) -> some View {
        let clampedStart = max(placed.event.startDate, dayStart)
        let clampedEnd = min(placed.event.endDate, dayEnd)
        let startMinutes = clampedStart.timeIntervalSince(dayStart) / 60
        let durationMinutes = max(clampedEnd.timeIntervalSince(clampedStart) / 60, 20)
        let yOffset = CGFloat(startMinutes) * (hourHeight / 60)
        let height = CGFloat(durationMinutes) * (hourHeight / 60)
        let slotWidth = columnWidth / CGFloat(placed.columnCount)
        let xOffsetWithinDay = CGFloat(placed.columnIndex) * slotWidth
        let fill = calendarColor(for: placed.event)
        let fullDurationMinutes = Int(max(placed.event.endDate.timeIntervalSince(placed.event.startDate) / 60, 15))

        return Button {
            router.navigate(to: .event(placed.event.id))
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(placed.event.summary)
                    .font(.caption.weight(.semibold))
                    .lineLimit(2)
                if height > 34 {
                    Text("\(placed.event.startDate.formatted(.dateTime.hour().minute())) – \(placed.event.endDate.formatted(.dateTime.hour().minute()))")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 4)
            .frame(width: slotWidth - 2, height: height - 2, alignment: .topLeading)
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(fill.opacity(0.2))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .strokeBorder(fill.opacity(0.55), lineWidth: 0.8)
            )
        }
        .buttonStyle(.plain)
        .offset(x: xOffsetWithinDay + 1, y: yOffset)
        .overlay(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .strokeBorder(selectedEventIDs.contains(placed.event.id) ? AppColor.blue : Color.clear, lineWidth: 2)
                .frame(width: slotWidth - 2, height: height - 2)
                .offset(x: xOffsetWithinDay + 1, y: yOffset)
                .allowsHitTesting(false)
        )
        .simultaneousGesture(
            TapGesture().modifiers(.command).onEnded {
                toggleSelection(placed.event.id)
            }
        )
        .accessibilityLabel(eventAccessibilityLabel(placed.event))
        .accessibilityHint("Opens event details")
        .modifier(EventHoverPreviewModifier(event: placed.event))
        .contextMenu {
            Button("Export .ics…") { exportSingleEventICS(placed.event) }
            Button("Copy as Markdown") { copyEventMarkdown(placed.event) }
        }
        .draggable(DraggedEvent(
            eventID: placed.event.id,
            calendarID: placed.event.calendarID,
            durationMinutes: fullDurationMinutes,
            isAllDay: placed.event.isAllDay
        )) {
            Text(placed.event.summary)
                .font(.caption.weight(.semibold))
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Capsule().fill(fill.opacity(0.35)))
        }
    }

    private func currentTimeOffset() -> CGFloat? {
        let now = Date()
        guard let todayInWeek = weekDays.first(where: { calendar.isDate($0, inSameDayAs: now) }) else { return nil }
        _ = todayInWeek
        let minutes = calendar.component(.hour, from: now) * 60 + calendar.component(.minute, from: now)
        return CGFloat(minutes) * (hourHeight / 60)
    }

    private func nowIndicator(offset: CGFloat) -> some View {
        Rectangle()
            .fill(AppColor.ember)
            .frame(height: 1)
            .offset(y: offset)
    }

    private func isToday(_ day: Date) -> Bool {
        calendar.isDateInToday(day)
    }

    private func labelForHour(_ hour: Int) -> String {
        let components = DateComponents(hour: hour)
        let date = calendar.date(from: components) ?? Date()
        return date.formatted(.dateTime.hour())
    }

    private func calendarColor(for event: CalendarEventMirror) -> Color {
        // Per-event colorId takes precedence over the calendar's color.
        if let hex = CalendarEventColor.from(colorId: event.colorId).hex {
            return Color(hex: hex)
        }
        guard let cal = model.calendars.first(where: { $0.id == event.calendarID }) else { return AppColor.blue }
        return Color(hex: cal.colorHex)
    }
}
