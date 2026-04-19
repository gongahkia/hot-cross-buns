import SwiftUI
import AppKit

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

    @State private var dragSelection: DragSelection?
    // Scroll-to-navigate-months state (§6.14). An NSEvent scrollWheel monitor
    // runs while the cursor hovers the grid; accumulated deltaY is stepped
    // into month shifts once it crosses `scrollThreshold`. Direction maps:
    // scroll DOWN (deltaY negative on macOS) → next month (forward in time);
    // scroll UP → previous month. Cooldown keeps a single long swipe from
    // paging through half a year.
    @State private var scrollMonitor: Any?
    @State private var scrollAccumulator: CGFloat = 0
    @State private var scrollLastStepAt: Date = .distantPast
    @State private var isGridHovered: Bool = false
    private let scrollThreshold: CGFloat = 45
    private let scrollCooldown: TimeInterval = 0.22

    private struct DragSelection: Equatable {
        var start: Date
        var end: Date
        var normalized: (Date, Date) {
            start <= end ? (start, end) : (end, start)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            weekdayHeader
            Divider()
            grid
        }
        .onHover { hovering in
            isGridHovered = hovering
            if hovering {
                installScrollMonitor()
            } else {
                removeScrollMonitor()
            }
        }
        .onDisappear { removeScrollMonitor() }
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
            let cellWidth = geo.size.width / 7
            ZStack(alignment: .topLeading) {
                VStack(spacing: 0) {
                    ForEach(Array(groupedCells.enumerated()), id: \.offset) { _, row in
                        weekRow(row, rowHeight: rowHeight, weekWidth: geo.size.width)
                    }
                }
                // Grid-level drag highlight — spans multiple rows so a
                // diagonal drag (e.g. 20 → 29) correctly shades every row
                // it touches, not just the row the drag started on.
                gridDragHighlight(
                    groupedCells: groupedCells,
                    cellWidth: cellWidth,
                    rowHeight: rowHeight
                )
            }
            // Drag-to-create at grid level so x/y both track the cursor.
            // minimumDistance: 6 keeps simple taps routed to the cell's
            // onTapGesture (single-day quick create popover).
            .simultaneousGesture(
                DragGesture(minimumDistance: 6)
                    .onChanged { value in
                        guard let start = date(
                            at: value.startLocation,
                            groupedCells: groupedCells,
                            cellWidth: cellWidth,
                            rowHeight: rowHeight
                        ), let curr = date(
                            at: value.location,
                            groupedCells: groupedCells,
                            cellWidth: cellWidth,
                            rowHeight: rowHeight
                        ) else { return }
                        dragSelection = DragSelection(start: start, end: curr)
                    }
                    .onEnded { _ in
                        guard let sel = dragSelection else { return }
                        dragSelection = nil
                        let (from, to) = sel.normalized
                        let endExclusive = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: to)) ?? to
                        router.present(.quickCreateRange(calendar.startOfDay(for: from), endExclusive, allDay: true))
                    }
            )
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

    private func cellIndex(for x: CGFloat, cellWidth: CGFloat, count: Int) -> Int {
        guard cellWidth > 0, count > 0 else { return 0 }
        return max(0, min(count - 1, Int(x / cellWidth)))
    }

    // Resolves a hit point inside the grid to the date under the cursor.
    // Clamps row/col to the grid bounds so drags that leave the view don't
    // return nil mid-gesture (nicer UX than the selection disappearing).
    private func date(
        at point: CGPoint,
        groupedCells: [[Date]],
        cellWidth: CGFloat,
        rowHeight: CGFloat
    ) -> Date? {
        guard rowHeight > 0, cellWidth > 0, groupedCells.isEmpty == false else { return nil }
        let row = max(0, min(groupedCells.count - 1, Int(point.y / rowHeight)))
        let col = max(0, min(6, Int(point.x / cellWidth)))
        let rowDays = groupedCells[row]
        guard rowDays.indices.contains(col) else { return nil }
        return rowDays[col]
    }

    @ViewBuilder
    private func gridDragHighlight(
        groupedCells: [[Date]],
        cellWidth: CGFloat,
        rowHeight: CGFloat
    ) -> some View {
        if let sel = dragSelection {
            let (from, to) = sel.normalized
            let fromStart = calendar.startOfDay(for: from)
            let toStart = calendar.startOfDay(for: to)
            ForEach(Array(groupedCells.enumerated()), id: \.offset) { rowIdx, row in
                if let (colStart, colEnd) = rowRange(row, fromStart: fromStart, toStart: toStart) {
                    let left = CGFloat(colStart) * cellWidth
                    let width = CGFloat(colEnd - colStart + 1) * cellWidth
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(AppColor.ember.opacity(0.2))
                        .overlay(
                            RoundedRectangle(cornerRadius: 6, style: .continuous)
                                .strokeBorder(AppColor.ember.opacity(0.6), lineWidth: 1.2)
                        )
                        .frame(width: max(width - 4, 4), height: rowHeight - 4)
                        .offset(x: left + 2, y: CGFloat(rowIdx) * rowHeight + 2)
                        .allowsHitTesting(false)
                }
            }
        }
    }

    // Intersects a row's days with the inclusive [fromStart, toStart] range
    // and returns the contiguous column span, or nil when the row is fully
    // outside the selection.
    private func rowRange(
        _ row: [Date],
        fromStart: Date,
        toStart: Date
    ) -> (Int, Int)? {
        var first: Int?
        var last: Int?
        for (idx, day) in row.enumerated() {
            let d = calendar.startOfDay(for: day)
            if d >= fromStart && d <= toStart {
                if first == nil { first = idx }
                last = idx
            }
        }
        if let first, let last { return (first, last) }
        return nil
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

    // MARK: - scroll-to-paginate-months (§6.14)

    private func installScrollMonitor() {
        guard scrollMonitor == nil else { return }
        scrollAccumulator = 0
        scrollMonitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { event in
            // Hover flag gates so scrolls in other windows / panels don't
            // shift the month. The returned event still flows to other
            // consumers — we only swallow once we actually step, so subtle
            // scrolls below the threshold don't hijack anything.
            guard isGridHovered else { return event }
            scrollAccumulator += event.scrollingDeltaY
            let now = Date()
            guard now.timeIntervalSince(scrollLastStepAt) >= scrollCooldown else {
                // Still in cooldown — eat the accumulator so a long swipe
                // doesn't carry over into the next step burst.
                scrollAccumulator = 0
                return nil
            }
            if abs(scrollAccumulator) >= scrollThreshold {
                // scrollingDeltaY < 0 on a "scroll down" gesture → next month.
                let direction = scrollAccumulator < 0 ? 1 : -1
                stepMonth(by: direction)
                scrollAccumulator = 0
                scrollLastStepAt = now
                return nil // swallow the step event so the app doesn't double-process
            }
            // Below threshold — don't fire, don't swallow; let other views
            // (none in practice here) see the event in case that changes.
            return event
        }
    }

    private func removeScrollMonitor() {
        if let monitor = scrollMonitor {
            NSEvent.removeMonitor(monitor)
            scrollMonitor = nil
        }
        scrollAccumulator = 0
    }

    private func stepMonth(by direction: Int) {
        guard let next = calendar.date(byAdding: .month, value: direction, to: anchorDate) else { return }
        withAnimation(.easeInOut(duration: 0.18)) {
            anchorDate = next
        }
    }
}
