import AppKit
import SwiftUI
import UniformTypeIdentifiers

struct WeekGridView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.routerPath) private var router
    @Binding var anchorDate: Date
    var searchQuery: String = ""
    @Binding var selectedEventIDs: Set<String>
    // §7.01 Phase D2 — multi-day variant. When non-nil, renders N consecutive
    // days starting at `anchorDate` instead of the full calendar week. nil
    // preserves the classic 7-day week-aligned layout.
    var multiDayCount: Int? = nil

    init(
        anchorDate: Binding<Date>,
        searchQuery: String = "",
        selectedEventIDs: Binding<Set<String>> = .constant([]),
        multiDayCount: Int? = nil
    ) {
        _anchorDate = anchorDate
        self.searchQuery = searchQuery
        _selectedEventIDs = selectedEventIDs
        self.multiDayCount = multiDayCount
    }

    private let hourHeight: CGFloat = 44
    private let hourStart = 0
    private let hourEnd = 24
    private let calendar = Calendar.current

    @State private var allDayDrag: WeekDaySelection?
    @State private var timedDrag: TimedWeekDrag?
    // Click-to-create feedback. flashTimedSlot is the tapped start-date for
    // a timed slot; clears after ~220ms so the user sees an acknowledgement
    // before the quick-create popover paints. Independent from timedDrag so
    // drag previews still behave.
    @State private var flashTimedSlot: Date?
    // Grid-content cache. Rebuilt only when inputs change — not on every
    // body eval. Drag-create gestures fire at ~60Hz; without this cache each
    // tick re-ran bucketTimedEventsByDay over ~3k visible events, producing
    // selection-lag on large calendars.
    @State private var cachedTimedByDay: [Date: [CalendarEventMirror]] = [:]
    @State private var cachedAllDaySpans: [AllDaySpan] = []
    @State private var cachedWeekKey: String = ""

    private struct WeekDaySelection: Equatable {
        var startCol: Int
        var endCol: Int
        var normalized: (Int, Int) {
            startCol <= endCol ? (startCol, endCol) : (endCol, startCol)
        }
    }

    // Grid-level timed drag: carries both axes so a drag that starts in
    // Tuesday 10 AM and ends in Thursday 2 PM creates a multi-day event
    // (Tue 10 AM → Thu 2 PM) instead of clamping to the starting column.
    private struct TimedWeekDrag: Equatable {
        var startColumn: Int
        var startY: CGFloat
        var endColumn: Int
        var endY: CGFloat
    }

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
        .onAppear { rebuildWeekCacheIfNeeded() }
        .onChange(of: currentWeekCacheKey) { _, _ in rebuildWeekCacheIfNeeded() }
    }

    // Fingerprints the inputs that make cachedTimedByDay valid. Cheap to
    // compute and triggers a real rebuild only when the user changes
    // calendars, search, week, or when sync lands new events.
    private var currentWeekCacheKey: String {
        let selectedIds = model.calendarSnapshot.selectedCalendars.map(\.id).sorted().joined(separator: ",")
        let start = weekDays.first.map { "\($0.timeIntervalSinceReferenceDate)" } ?? ""
        // dataRevision replaces event-count fingerprint so edits that keep
        // the count unchanged still invalidate the cache. See MonthGridView.
        return "\(selectedIds)|\(searchQuery)|\(start)|\(model.dataRevision)"
    }

    private func rebuildWeekCacheIfNeeded() {
        let key = currentWeekCacheKey
        guard key != cachedWeekKey else { return }
        cachedWeekKey = key
        cachedTimedByDay = bucketTimedEventsByDay()
        cachedAllDaySpans = layoutAllDaySpans()
    }

    private var weekDays: [Date] {
        if let count = multiDayCount, count > 0 {
            let start = calendar.startOfDay(for: anchorDate)
            return (0..<count).compactMap { calendar.date(byAdding: .day, value: $0, to: start) }
        }
        return CalendarGridLayout.weekDays(containing: anchorDate, calendar: calendar)
    }

    private var visibleEvents: [CalendarEventMirror] {
        // Reads model.eventsByCalendar (built once in rebuildSnapshots) so
        // we walk only the events for the user's selected calendars rather
        // than filtering the full event corpus per body eval. Cancelled
        // events are already excluded at index-build time.
        var base: [CalendarEventMirror] = []
        for cal in model.calendarSnapshot.selectedCalendars {
            if let bucket = model.eventsByCalendar[cal.id] {
                base.append(contentsOf: bucket)
            }
        }
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
        let key = dayStart.timeIntervalSinceReferenceDate
        // model.tasksByDueDate is prebuilt in rebuildSnapshots across ALL
        // lists — intersect with the user's visible list selection here.
        let visibleLists = model.settings.hasConfiguredTaskListSelection
            ? model.settings.selectedTaskListIDs
            : Set(model.taskLists.map(\.id))
        let bucket = model.tasksByDueDate[key] ?? []
        return bucket
            .filter { visibleLists.contains($0.taskListID) }
            .sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
    }

    // Per body-pass bucketing of timed (non-all-day) events by startOfDay.
    // Mirrors MonthGridView's byDay pattern but includes only timed events
    // so the timed-event lane layout in dayColumn gets exactly the set it
    // needs. Cancelled events are already excluded from visibleEvents.
    private func bucketTimedEventsByDay() -> [Date: [CalendarEventMirror]] {
        guard let first = weekDays.first, let last = weekDays.last else { return [:] }
        let weekStart = calendar.startOfDay(for: first)
        let weekEnd = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: last)) ?? weekStart
        var buckets: [Date: [CalendarEventMirror]] = [:]
        for event in visibleEvents where event.isAllDay == false
            && event.startDate < weekEnd && event.endDate > weekStart {
            let key = calendar.startOfDay(for: event.startDate)
            buckets[key, default: []].append(event)
        }
        return buckets
    }

    private var weekHeader: some View {
        HStack(spacing: 0) {
            Text("")
                .hcbScaledFrame(width: 54)
            ForEach(weekDays, id: \.self) { day in
                VStack(spacing: 2) {
                    Text(day.formatted(.dateTime.weekday(.abbreviated)))
                        .hcbFont(.caption, weight: .semibold)
                        .foregroundStyle(.secondary)
                    Text(day.formatted(.dateTime.day()))
                        .font(.title3.weight(isToday(day) ? .bold : .regular))
                        .foregroundStyle(isToday(day) ? AppColor.ember : AppColor.ink)
                        .hcbScaledFrame(width: 30, height: 30)
                        .background(
                            Circle()
                                .fill(isToday(day) ? AppColor.ember.opacity(0.15) : .clear)
                        )
                }
                .frame(maxWidth: .infinity)
            }
        }
        .hcbScaledPadding(.vertical, 10)
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
        let spans = cachedAllDaySpans
        let laneCount = (spans.map(\.laneIndex).max() ?? -1) + 1
        let stripHeight = max(CGFloat(min(laneCount, 3)) * 22, 22)
        // Captured outside GeometryReader so DragGesture closures see a
        // reliable router reference (custom-EnvironmentKey reads inside
        // GeometryReader closures have shown propagation gaps).
        let capturedRouter = router
        return HStack(spacing: 0) {
            Text("All-day")
                .hcbFont(.caption2, weight: .semibold)
                .foregroundStyle(.secondary)
                .hcbScaledFrame(width: 54, alignment: .trailing)
                .hcbScaledPadding(.trailing, 6)
            GeometryReader { geo in
                let columnWidth = geo.size.width / CGFloat(max(weekDays.count, 1))
                let laneHeight: CGFloat = 22
                ZStack(alignment: .topLeading) {
                    Rectangle()
                        .fill(Color.clear)
                        .contentShape(Rectangle())
                    if let drag = allDayDrag {
                        let (a, b) = drag.normalized
                        let left = CGFloat(a) * columnWidth
                        let width = CGFloat(b - a + 1) * columnWidth
                        RoundedRectangle(cornerRadius: 6)
                            .fill(AppColor.ember.opacity(0.22))
                            .overlay(
                                RoundedRectangle(cornerRadius: 6)
                                    .strokeBorder(AppColor.ember.opacity(0.6), lineWidth: 1.2)
                            )
                            .frame(width: max(width - 4, 4), height: stripHeight - 4)
                            .offset(x: left + 2, y: 2)
                            .allowsHitTesting(false)
                    }
                    ForEach(spans) { span in
                        allDaySpanTile(span, columnWidth: columnWidth, laneHeight: laneHeight)
                    }
                }
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 6)
                        .onChanged { value in
                            let startCol = columnIndex(for: value.startLocation.x, columnWidth: columnWidth)
                            let endCol = columnIndex(for: value.location.x, columnWidth: columnWidth)
                            allDayDrag = WeekDaySelection(startCol: startCol, endCol: endCol)
                        }
                        .onEnded { _ in
                            guard let drag = allDayDrag else { return }
                            allDayDrag = nil
                            let (a, b) = drag.normalized
                            guard weekDays.indices.contains(a), weekDays.indices.contains(b) else { return }
                            let start = calendar.startOfDay(for: weekDays[a])
                            let endExclusive = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: weekDays[b])) ?? weekDays[b]
                            capturedRouter?.present(.quickCreateRange(start, endExclusive, allDay: true))
                        }
                )
            }
            .frame(height: stripHeight)
        }
        .hcbScaledPadding(.vertical, 4)
    }

    private func columnIndex(for x: CGFloat, columnWidth: CGFloat) -> Int {
        guard columnWidth > 0 else { return 0 }
        return max(0, min(6, Int(x / columnWidth)))
    }

    private func allDaySpanTile(_ span: AllDaySpan, columnWidth: CGFloat, laneHeight: CGFloat) -> some View {
        let x = CGFloat(span.startColumn) * columnWidth + 2
        let width = CGFloat(span.columnCount) * columnWidth - 4
        let y = CGFloat(span.laneIndex) * laneHeight + 2
        let fill = calendarColor(for: span.event)
        return CalendarEventPreviewButton(event: span.event) {
            Text(span.event.summary)
                .hcbFont(.caption)
                .lineLimit(1)
                .hcbScaledPadding(.horizontal, 6)
                .hcbScaledPadding(.vertical, 3)
                .frame(width: max(width, 20), height: laneHeight - 4, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 5)
                        .fill(fill.opacity(0.3))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 5)
                        .strokeBorder(fill.opacity(0.5), lineWidth: 0.8)
                )
                .foregroundStyle(AppColor.ink)
        }
        .offset(x: x, y: y)
        .accessibilityLabel(eventAccessibilityLabel(span.event))
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
                        .hcbFont(.caption2, weight: .semibold)
                        .foregroundStyle(.secondary)
                        .hcbScaledFrame(width: 54, alignment: .trailing)
                        .hcbScaledPadding(.trailing, 6)
                    GeometryReader { geo in
                        let columnWidth = geo.size.width / CGFloat(max(weekDays.count, 1))
                        ZStack(alignment: .topLeading) {
                            ForEach(Array(weekDays.enumerated()), id: \.offset) { idx, day in
                                VStack(alignment: .leading, spacing: 2) {
                                    ForEach((tasksByDay[calendar.startOfDay(for: day)] ?? []).prefix(3)) { task in
                                        HStack(spacing: 4) {
                                            CalendarTaskCheckbox(task: task, size: 10)
                                            CalendarTaskPreviewButton(task: task) {
                                                Text(task.title)
                                                    .hcbFont(.caption)
                                                    .lineLimit(1)
                                                    .frame(maxWidth: .infinity, alignment: .leading)
                                                    .contentShape(Rectangle())
                                            }
                                        }
                                        .hcbScaledPadding(.horizontal, 6)
                                        .hcbScaledPadding(.vertical, 3)
                                        .background(
                                            RoundedRectangle(cornerRadius: 5)
                                                .fill(AppColor.ember.opacity(0.15))
                                        )
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 5)
                                                .strokeBorder(AppColor.ember.opacity(0.35), lineWidth: 0.8)
                                        )
                                        .foregroundStyle(AppColor.ink)
                                        .strikethrough(task.isCompleted, color: .secondary)
                                        .opacity(task.isCompleted ? 0.55 : 1.0)
                                        .accessibilityLabel("Task due \(day.formatted(.dateTime.weekday(.wide).month(.abbreviated).day())): \(task.title)")
                                    }
                                    if let count = tasksByDay[calendar.startOfDay(for: day)]?.count, count > 3 {
                                        Text("+\(count - 3) more")
                                            .hcbFont(.caption2)
                                            .foregroundStyle(.secondary)
                                            .hcbScaledPadding(.leading, 4)
                                    }
                                }
                                .hcbScaledPadding(.horizontal, 2)
                                .frame(width: columnWidth, alignment: .leading)
                                .offset(x: CGFloat(idx) * columnWidth)
                            }
                        }
                    }
                    .frame(height: CGFloat(min(maxLanes, 3)) * 22)
                }
                .hcbScaledPadding(.vertical, 4)
            }
        }
    }

    private var timeGrid: some View {
        // Captured outside GeometryReader so DragGesture closures see a
        // reliable router reference (see allDayStrip for rationale).
        let capturedRouter = router
        // cachedTimedByDay is rebuilt only when underlying inputs change,
        // not on every body eval — critical for DragGesture responsiveness
        // during drag-to-create where body fires at ~60Hz.
        let timedByDay = cachedTimedByDay
        return HStack(alignment: .top, spacing: 0) {
            hoursColumn
            GeometryReader { geo in
                let columnWidth = geo.size.width / CGFloat(max(weekDays.count, 1))
                let totalHeight = CGFloat(hourEnd - hourStart) * hourHeight
                ZStack(alignment: .topLeading) {
                    gridLines
                    ForEach(Array(weekDays.enumerated()), id: \.offset) { idx, day in
                        dayColumn(
                            day: day,
                            xOffset: CGFloat(idx) * columnWidth,
                            width: columnWidth,
                            eventsForDay: timedByDay[calendar.startOfDay(for: day)] ?? []
                        )
                    }
                    if let nowOffset = currentTimeOffset() {
                        nowIndicator(offset: nowOffset)
                    }
                    // Multi-day drag preview. Drawn above the day columns so
                    // it's visible across the whole grid without being eaten
                    // by individual column hit-testing.
                    timedDragPreview(columnWidth: columnWidth, totalHeight: totalHeight)
                }
                .frame(height: totalHeight)
                // Grid-level drag — tracks both x (day column) AND y (time).
                // Taps inside a day column still route to TapToCreateLayer's
                // SpatialTapGesture because DragGesture has minimumDistance.
                .simultaneousGesture(
                    DragGesture(minimumDistance: 6)
                        .onChanged { value in
                            let startCol = columnIndex(for: value.startLocation.x, columnWidth: columnWidth)
                            let endCol = columnIndex(for: value.location.x, columnWidth: columnWidth)
                            timedDrag = TimedWeekDrag(
                                startColumn: startCol,
                                startY: clampedY(value.startLocation.y, totalHeight: totalHeight),
                                endColumn: endCol,
                                endY: clampedY(value.location.y, totalHeight: totalHeight)
                            )
                        }
                        .onEnded { _ in
                            guard let drag = timedDrag else { return }
                            timedDrag = nil
                            guard let (start, end) = resolveTimedDrag(drag) else { return }
                            capturedRouter?.present(.quickCreateRange(start, end, allDay: false))
                        }
                )
            }
        }
    }

    private func clampedY(_ y: CGFloat, totalHeight: CGFloat) -> CGFloat {
        max(0, min(totalHeight, y))
    }

    // Converts a TimedWeekDrag into the (start, end) Date pair that
    // gets handed to the QuickCreatePopover. Single-day drags snap the
    // end up to a minimum 30-minute block; cross-day drags honour the
    // full span so the create sheet lands with the right Date values.
    // Flash the tapped timed slot for ~220ms so click-to-create has a
    // visible acknowledgement before the popover paints.
    private func flashTimedStart(_ start: Date) {
        flashTimedSlot = start
        Task {
            try? await Task.sleep(for: .milliseconds(220))
            if flashTimedSlot == start { flashTimedSlot = nil }
        }
    }

    private func resolveTimedDrag(_ drag: TimedWeekDrag) -> (Date, Date)? {
        let startCol = min(drag.startColumn, drag.endColumn)
        let endCol = max(drag.startColumn, drag.endColumn)
        guard weekDays.indices.contains(startCol), weekDays.indices.contains(endCol) else { return nil }

        // Single-column drag: preserve existing behaviour — snap both
        // y values in the same day and ensure a ≥30min block.
        if startCol == endCol {
            let dayStart = calendar.startOfDay(for: weekDays[startCol])
            let lowY = min(drag.startY, drag.endY)
            let highY = max(drag.startY, drag.endY)
            let start = CalendarDropComputer.snappedStart(for: lowY, hourHeight: hourHeight, dayStart: dayStart, calendar: calendar)
            let end = CalendarDropComputer.snappedStart(for: highY, hourHeight: hourHeight, dayStart: dayStart, calendar: calendar)
            let adjustedEnd = end <= start ? start.addingTimeInterval(1800) : end
            return (start, adjustedEnd)
        }

        // Multi-column drag: start anchors to the drag origin's (col, y);
        // end to the drag terminus's (col, y). Normalise into chronological
        // order so a right→left drag still produces start < end.
        let originStart = CalendarDropComputer.snappedStart(
            for: drag.startY, hourHeight: hourHeight,
            dayStart: calendar.startOfDay(for: weekDays[drag.startColumn]),
            calendar: calendar
        )
        let originEnd = CalendarDropComputer.snappedStart(
            for: drag.endY, hourHeight: hourHeight,
            dayStart: calendar.startOfDay(for: weekDays[drag.endColumn]),
            calendar: calendar
        )
        let start = min(originStart, originEnd)
        let end = max(originStart, originEnd)
        let adjustedEnd = end <= start ? start.addingTimeInterval(1800) : end
        return (start, adjustedEnd)
    }

    // Renders the ember-tinted drag preview. Single-column drags show one
    // rectangle; multi-column drags fill the origin column from startY to
    // end-of-day, fill middle columns fully, and fill the terminus column
    // from start-of-day to endY — mirroring how the event will actually
    // render once created.
    @ViewBuilder
    private func timedDragPreview(columnWidth: CGFloat, totalHeight: CGFloat) -> some View {
        if let drag = timedDrag {
            let startCol = min(drag.startColumn, drag.endColumn)
            let endCol = max(drag.startColumn, drag.endColumn)
            // Determine which y belongs to which column after normalisation.
            let (firstY, lastY): (CGFloat, CGFloat) = {
                if drag.startColumn <= drag.endColumn {
                    return (drag.startY, drag.endY)
                } else {
                    return (drag.endY, drag.startY)
                }
            }()
            ForEach(startCol...endCol, id: \.self) { col in
                let x = CGFloat(col) * columnWidth
                let (top, height): (CGFloat, CGFloat) = {
                    if startCol == endCol {
                        let lo = min(firstY, lastY)
                        let hi = max(firstY, lastY)
                        return (lo, max(hi - lo, hourHeight / 4))
                    }
                    if col == startCol { return (firstY, max(totalHeight - firstY, hourHeight / 4)) }
                    if col == endCol { return (0, max(lastY, hourHeight / 4)) }
                    return (0, totalHeight)
                }()
                RoundedRectangle(cornerRadius: 6)
                    .fill(AppColor.ember.opacity(0.22))
                    .overlay(
                        RoundedRectangle(cornerRadius: 6)
                            .strokeBorder(AppColor.ember.opacity(0.6), lineWidth: 1.2)
                    )
                    .frame(width: max(columnWidth - 4, 4), height: height)
                    .offset(x: x + 2, y: top)
                    .allowsHitTesting(false)
            }
        }
    }

    private var hoursColumn: some View {
        VStack(spacing: 0) {
            ForEach(hourStart..<hourEnd, id: \.self) { hour in
                HStack {
                    Spacer()
                    Text(labelForHour(hour))
                        .hcbFont(.caption2)
                        .foregroundStyle(.secondary)
                        .offset(y: -6)
                        .hcbScaledPadding(.trailing, 6)
                }
                .frame(height: hourHeight, alignment: .top)
            }
        }
        .hcbScaledFrame(width: 54)
    }

    private var gridLines: some View {
        VStack(spacing: 0) {
            ForEach(hourStart..<hourEnd, id: \.self) { _ in
                Divider()
                    .frame(height: hourHeight, alignment: .top)
            }
        }
    }

    private func dayColumn(
        day: Date,
        xOffset: CGFloat,
        width: CGFloat,
        eventsForDay: [CalendarEventMirror]
    ) -> some View {
        let startOfDay = calendar.startOfDay(for: day)
        let endOfDay = calendar.date(byAdding: .day, value: 1, to: startOfDay) ?? startOfDay
        let laid = CalendarGridLayout.layout(eventsInDay: eventsForDay, calendar: calendar)
        let capturedRouter = router

        return ZStack(alignment: .topLeading) {
            TapToCreateLayer(
                hourHeight: hourHeight,
                dayStart: startOfDay,
                calendar: calendar,
                onTap: { start in
                    flashTimedStart(start)
                    capturedRouter?.present(.quickCreate(start, allDay: false))
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
            // Momentary tint at the tapped hour slot so users see their
            // click register before the popover paints. Drawn above event
            // tiles so it's visible even over a crowded column.
            if let flash = flashTimedSlot, flash >= startOfDay && flash < endOfDay {
                let minutesIntoDay = flash.timeIntervalSince(startOfDay) / 60.0
                let startHourOffset = Double(hourStart) * 60.0
                let y = CGFloat(max(0, minutesIntoDay - startHourOffset)) / 60.0 * hourHeight
                RoundedRectangle(cornerRadius: 4)
                    .fill(AppColor.ember.opacity(0.22))
                    .frame(height: hourHeight * 0.5)
                    .offset(x: 4, y: y)
                    .padding(.trailing, 8)
                    .allowsHitTesting(false)
                    .transition(.opacity)
            }
        }
        .frame(width: width)
        .offset(x: xOffset)
        .animation(.easeOut(duration: 0.18), value: flashTimedSlot)
    }

    // Tap-only hit-test layer for each day column. Multi-day drag is now
    // handled at the grid level (timeGrid → simultaneousGesture) so a drag
    // can span columns without the column's hit-testing eating the gesture.
    // Single taps still land here and open the quick-create popover at the
    // snapped hour slot.
    private struct TapToCreateLayer: View {
        let hourHeight: CGFloat
        let dayStart: Date
        let calendar: Calendar
        let onTap: (Date) -> Void

        var body: some View {
            Rectangle()
                .fill(Color.clear)
                .contentShape(Rectangle())
                .simultaneousGesture(
                    SpatialTapGesture(count: 1)
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
        // Backlink travels in Google's native extendedProperties.private bag
        // (HCB-only; invisible in google.com web UI) — not in the event
        // description, which was the legacy schema-polluting behaviour.
        _ = await model.createEvent(
            summary: dropped.title,
            details: "",
            startDate: start,
            endDate: end,
            isAllDay: false,
            reminderMinutes: nil,
            calendarID: calendarID,
            hcbTaskID: dropped.taskID
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

        return CalendarEventPreviewButton(event: placed.event) {
            VStack(alignment: .leading, spacing: 2) {
                Text(placed.event.summary)
                    .hcbFont(.caption, weight: .semibold)
                    .lineLimit(2)
                if height > 34 {
                    Text("\(placed.event.startDate.formatted(.dateTime.hour().minute())) – \(placed.event.endDate.formatted(.dateTime.hour().minute()))")
                        .hcbFont(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .hcbScaledPadding(.horizontal, 6)
            .hcbScaledPadding(.vertical, 4)
            .frame(width: slotWidth - 2, height: height - 2, alignment: .topLeading)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(fill.opacity(0.2))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .strokeBorder(fill.opacity(0.55), lineWidth: 0.8)
            )
        }
        .offset(x: xOffsetWithinDay + 1, y: yOffset)
        .overlay(
            RoundedRectangle(cornerRadius: 6)
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
                .hcbFont(.caption, weight: .semibold)
                .hcbScaledPadding(.horizontal, 10)
                .hcbScaledPadding(.vertical, 6)
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
            .hcbScaledFrame(height: 1)
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
