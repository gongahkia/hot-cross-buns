import SwiftUI
import AppKit

struct MonthGridView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.routerPath) private var router
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
    // Continuous-scroll rewrite: fixed row height lets us resolve drag points
    // to (weekIndex, dayColumn) via simple division, and guarantees uniform
    // layout across weeks regardless of band-event count. Matches the legacy
    // paged-month cell height (geo.height ÷ 6 for a 660pt region ≈ 110).
    private let fixedRowHeight: CGFloat = 110
    // 104 weeks = ±1 year window around the user's initial anchor. Large
    // enough that typical navigation stays inside it; a chevron jump outside
    // the window triggers recentering via buildWindow().
    private let weeksInWindow: Int = 104
    // Named coordinate space the drag gesture and the highlight overlay both
    // resolve into. Needs to wrap the LazyVStack so both gesture points and
    // overlay positioning share the same frame.
    private let gridCoordinateSpace = "monthGridContent"
    // Separate named space for the outer ScrollView — the inner
    // GeometryReader reports its frame within this space to derive scroll
    // offset. Kept distinct from gridCoordinateSpace because the gesture
    // resolution wants content-local coords, not scroll-view-local.
    private let scrollCoordinateSpace = "monthGridScroll"

    @State private var dragSelection: DragSelection?
    // Cell feedback pulse. Set to the tapped dayStart on quickCreate and
    // cleared after ~220ms. The monthCell reads this to paint a brief tint
    // so users get confirmation their click landed — otherwise there's a
    // ~100ms gap before the popover appears where nothing on screen moves.
    @State private var flashDay: Date?
    // Grid-content cache. Rebuilt only when the underlying inputs (calendar
    // selection, search query, window anchor, event corpus count) change —
    // NOT on every body eval. Critical for drag-create responsiveness: the
    // DragGesture .onChanged fires at ~60Hz, and without this cache every
    // drag tick ran the filteredEvents + eventsByDay pipelines over 17k+
    // events, producing ~50ms stalls per pixel moved.
    @State private var cachedFiltered: [CalendarEventMirror] = []
    @State private var cachedByDay: [Date: [CalendarEventMirror]] = [:]
    @State private var cachedGridKey: String = ""
    // Rolling window of week-start dates rendered by the ScrollView. Rebuilt
    // by buildWindow() when the anchor lands outside the current window.
    @State private var weekStarts: [Date] = []
    @State private var windowStart: Date = Date()
    // Guard against a feedback loop: when we update anchorDate from a scroll
    // event, onChange(of: anchorDate) would otherwise programmatically scroll
    // (and potentially fight with the user's momentum). This flag short-
    // circuits one onChange pass.
    @State private var skipNextScrollSync: Bool = false

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
            continuousGrid
        }
        .onAppear {
            if weekStarts.isEmpty {
                buildWindow(centeredOn: anchorDate)
            }
            rebuildGridCacheIfNeeded()
        }
    }

    // Replaces the paged month grid. A LazyVStack of week rows inside a
    // ScrollView — natural continuous vertical scrolling, partial months
    // visible at any scroll position. ScrollViewReader lets external anchor
    // updates (chevron / today / mini-calendar) programmatically scroll; the
    // onScrollGeometryChange reverse-binds the visible-center week back into
    // anchorDate so the nav bar's month title follows live scrolling.
    //
    // §7.02 cache: `filteredEvents` + windowed `eventsByDay` are computed
    // ONCE per window/search/events change and threaded into every weekRow
    // so `monthBands` doesn't re-iterate the full events list per week on
    // each scroll tick.
    private var continuousGrid: some View {
        GeometryReader { outerGeo in
            ScrollViewReader { proxy in
                ScrollView(.vertical) {
                    LazyVStack(spacing: 0) {
                        ForEach(weekStarts, id: \.self) { weekStart in
                            weekRow(
                                for: weekStart,
                                filtered: cachedFiltered,
                                byDay: cachedByDay
                            )
                            .frame(height: fixedRowHeight)
                            .id(weekStart)
                        }
                    }
                    // Named coordinate space wraps the content so (a) the
                    // drag gesture can resolve points in absolute content
                    // coords and (b) the drag highlight overlay positions
                    // rectangles against the same frame — gesture and paint
                    // agree on pixel origin.
                    .coordinateSpace(name: gridCoordinateSpace)
                    // Background GeometryReader captures the content width
                    // and reports the current scroll offset via a
                    // PreferenceKey. Both dateAtContentPoint and the
                    // highlight overlay read visibleGridWidth; the scroll
                    // offset drives the anchor-from-scroll binding.
                    .background(
                        GeometryReader { innerGeo in
                            Color.clear
                                .onAppear { visibleGridWidth = innerGeo.size.width }
                                .onChange(of: innerGeo.size.width) { _, new in visibleGridWidth = new }
                                .preference(
                                    key: ScrollOffsetKey.self,
                                    value: -innerGeo.frame(in: .named(scrollCoordinateSpace)).minY
                                )
                        }
                    )
                    .overlay(alignment: .topLeading) { dragHighlightOverlay }
                    .simultaneousGesture(
                        DragGesture(minimumDistance: 6, coordinateSpace: .named(gridCoordinateSpace))
                            .onChanged { value in
                                guard let start = dateAtContentPoint(value.startLocation),
                                      let curr = dateAtContentPoint(value.location) else { return }
                                dragSelection = DragSelection(start: start, end: curr)
                            }
                            .onEnded { _ in
                                guard let sel = dragSelection else { return }
                                dragSelection = nil
                                let (from, to) = sel.normalized
                                let endExclusive = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: to)) ?? to
                                router?.present(.quickCreateRange(calendar.startOfDay(for: from), endExclusive, allDay: true))
                            }
                    )
                }
                .coordinateSpace(name: scrollCoordinateSpace)
                .onAppear { scrollToAnchor(proxy: proxy, animated: false) }
                .onChange(of: anchorDate) { _, newValue in
                    if skipNextScrollSync {
                        skipNextScrollSync = false
                        return
                    }
                    // If the new anchor left the window, rebuild centered on it.
                    if isDateInWindow(newValue) == false {
                        buildWindow(centeredOn: newValue)
                        rebuildGridCacheIfNeeded()
                    }
                    scrollToAnchor(proxy: proxy, animated: true)
                }
                .onChange(of: currentGridCacheKey) { _, _ in rebuildGridCacheIfNeeded() }
                .onPreferenceChange(ScrollOffsetKey.self) { offset in
                    let centerY = offset + outerGeo.size.height / 2
                    updateAnchorFromScroll(centerY: centerY)
                }
            }
        }
    }

    // Fingerprints every input the grid cache depends on. Cheap to compute —
    // O(selectedCalendars) — and triggers a rebuild only on real changes,
    // skipping every drag-induced body re-eval.
    private var currentGridCacheKey: String {
        let selectedIds = model.calendarSnapshot.selectedCalendars.map(\.id).sorted().joined(separator: ",")
        return "\(selectedIds)|\(searchQuery)|\(windowKey)|\(model.events.count)"
    }

    private var windowKey: String {
        guard let first = weekStarts.first else { return "empty" }
        return "\(Int(first.timeIntervalSince1970))-\(weekStarts.count)"
    }

    // Flash the tapped cell for ~220ms. Used on monthCell click-to-create
    // so the user sees a visual acknowledgement before the popover paints.
    private func flashCell(_ day: Date) {
        flashDay = day
        Task {
            try? await Task.sleep(for: .milliseconds(220))
            await MainActor.run {
                if flashDay == day { flashDay = nil }
            }
        }
    }

    private func rebuildGridCacheIfNeeded() {
        let key = currentGridCacheKey
        guard key != cachedGridKey else { return }
        cachedGridKey = key
        let filtered = filteredEvents
        cachedFiltered = filtered
        let first = weekStarts.first ?? anchorDate
        let last = weekStarts.last.flatMap { calendar.date(byAdding: .day, value: 6, to: $0) } ?? first
        cachedByDay = CalendarGridLayout.eventsByDay(
            filtered,
            from: first,
            to: last,
            calendar: calendar
        )
    }

    private func monthKey(for date: Date) -> String {
        let comps = calendar.dateComponents([.year, .month], from: date)
        return "\(comps.year ?? 0)-\(comps.month ?? 0)"
    }

    // MARK: - Window / scroll plumbing

    // Returns the start-of-week (locale-aware) for a given date.
    private func startOfWeek(for date: Date) -> Date {
        calendar.dateInterval(of: .weekOfYear, for: date)?.start
            ?? calendar.startOfDay(for: date)
    }

    // Rebuilds the rolling window of week-start dates centered on the given
    // date. Called on first appear and whenever an external anchor jumps
    // outside the current window.
    private func buildWindow(centeredOn date: Date) {
        let anchorWeek = startOfWeek(for: date)
        let lead = weeksInWindow / 2
        let start = calendar.date(byAdding: .day, value: -lead * 7, to: anchorWeek) ?? anchorWeek
        windowStart = start
        weekStarts = (0..<weeksInWindow).compactMap {
            calendar.date(byAdding: .day, value: $0 * 7, to: start)
        }
    }

    private func isDateInWindow(_ date: Date) -> Bool {
        guard let first = weekStarts.first, let last = weekStarts.last else { return false }
        let endExclusive = calendar.date(byAdding: .day, value: 7, to: last) ?? last
        return date >= first && date < endExclusive
    }

    // Programmatic scroll to the week containing `anchorDate`. Used by Today
    // / chevrons / mini-calendar — anything that updates the binding from
    // outside. Anchoring the target week at .top gives a predictable landing
    // position at the top of the visible area.
    private func scrollToAnchor(proxy: ScrollViewProxy, animated: Bool) {
        let target = startOfWeek(for: anchorDate)
        guard weekStarts.contains(target) else { return }
        if animated {
            withAnimation(.easeInOut(duration: 0.24)) {
                proxy.scrollTo(target, anchor: .top)
            }
        } else {
            proxy.scrollTo(target, anchor: .top)
        }
    }

    // Reverse-sync: as the user scrolls, figure out which week sits at the
    // visible-center and push its month into anchorDate. skipNextScrollSync
    // short-circuits the resulting onChange(of: anchorDate) so programmatic
    // scroll doesn't fight live scrolling.
    private func updateAnchorFromScroll(centerY: CGFloat) {
        guard fixedRowHeight > 0 else { return }
        let index = Int((centerY / fixedRowHeight).rounded(.down))
        guard weekStarts.indices.contains(index) else { return }
        let weekStart = weekStarts[index]
        // Use Thursday (offset 3) as the "representative" day — ISO week
        // numbering treats the Thursday as the canonical week, which matches
        // how users intuitively assign a week to a month.
        let midDay = calendar.date(byAdding: .day, value: 3, to: weekStart) ?? weekStart
        if monthKey(for: midDay) != monthKey(for: anchorDate) {
            skipNextScrollSync = true
            anchorDate = midDay
        }
    }

    private var filteredEvents: [CalendarEventMirror] {
        // Reads model.eventsByCalendar (built once in rebuildSnapshots) so
        // we walk only the events for the user's selected calendars rather
        // than filtering the full ~17k+ event corpus on every body eval.
        var base: [CalendarEventMirror] = []
        for cal in model.calendarSnapshot.selectedCalendars {
            if let bucket = model.eventsByCalendar[cal.id] {
                base.append(contentsOf: bucket)
            }
        }
        let q = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return q.isEmpty ? base : base.filter { event in
            event.summary.localizedCaseInsensitiveContains(q)
                || event.details.localizedCaseInsensitiveContains(q)
                || event.location.localizedCaseInsensitiveContains(q)
        }
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

    private func weekRow(
        for weekStart: Date,
        filtered: [CalendarEventMirror],
        byDay: [Date: [CalendarEventMirror]]
    ) -> some View {
        let days = (0..<7).compactMap { calendar.date(byAdding: .day, value: $0, to: weekStart) }
        // Pre-narrow to events that actually cross this week before calling
        // monthBands. At 17k events filtered, monthBands internally sorts +
        // runs O(n × lanes) per call — without this guard the per-scroll
        // cost scales with the full month corpus even though each week only
        // contains ~0.5-2% of events.
        let weekEnd = calendar.date(byAdding: .day, value: 7, to: weekStart) ?? weekStart
        let weekEvents = filtered.filter { event in
            event.startDate < weekEnd && event.endDate > weekStart
        }
        let bands = CalendarGridLayout.monthBands(for: days, events: weekEvents, calendar: calendar)
        let visibleLaneCount = min(maxVisibleLanes, (bands.map(\.lane).max() ?? -1) + 1)
        let bandAreaHeight: CGFloat = visibleLaneCount > 0
            ? CGFloat(visibleLaneCount) * laneHeight + CGFloat(max(visibleLaneCount - 1, 0)) * laneSpacing + 4
            : 0

        return GeometryReader { geo in
            let cellWidth = geo.size.width / CGFloat(max(days.count, 1))
            ZStack(alignment: .topLeading) {
                HStack(spacing: 0) {
                    ForEach(Array(days.enumerated()), id: \.element) { col, day in
                        // Per-cell band reservation: cells with NO band events
                        // crossing them get 0 reservation so timed-event tiles
                        // can slide to the top. Cells crossed by ≥1 band keep
                        // the uniform week-level reservation so they line up
                        // under the band overlay rather than colliding with it.
                        let cellHasBand = bands.contains { col >= $0.startColumn && col <= $0.endColumn && $0.lane < maxVisibleLanes }
                        monthCell(day: day, bandReserve: cellHasBand ? bandAreaHeight : 0, byDay: byDay)
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    }
                }
                bandOverlay(bands: bands, cellWidth: cellWidth)
            }
        }
    }

    // Resolves a gesture point — given in the "monthGridContent" named
    // coordinate space, i.e. relative to the LazyVStack's top-leading — into
    // a concrete date. Row derives from y / fixedRowHeight; column from
    // x / (contentWidth / 7). Clamped so a drag that overshoots the grid
    // doesn't cause the selection to disappear mid-gesture.
    private func dateAtContentPoint(_ point: CGPoint) -> Date? {
        guard fixedRowHeight > 0, weekStarts.isEmpty == false else { return nil }
        let rowIndex = max(0, min(weekStarts.count - 1, Int(point.y / fixedRowHeight)))
        let cellWidth = visibleGridWidth / 7
        guard cellWidth > 0 else { return nil }
        let col = max(0, min(6, Int(point.x / cellWidth)))
        return calendar.date(byAdding: .day, value: col, to: weekStarts[rowIndex])
    }

    // Drag highlight overlay, drawn over the LazyVStack in the same named
    // coordinate space as the gesture. Each week that intersects the
    // selection contributes one highlight rectangle at its correct row offset
    // — enables the multi-week drag-create UX across partial-month bounds.
    @ViewBuilder
    private var dragHighlightOverlay: some View {
        if let sel = dragSelection, visibleGridWidth > 0 {
            let cellWidth = visibleGridWidth / 7
            let (from, to) = sel.normalized
            let fromStart = calendar.startOfDay(for: from)
            let toStart = calendar.startOfDay(for: to)
            ZStack(alignment: .topLeading) {
                ForEach(Array(weekStarts.enumerated()), id: \.element) { index, weekStart in
                    let weekDays = (0..<7).compactMap { calendar.date(byAdding: .day, value: $0, to: weekStart) }
                    if let (colStart, colEnd) = rowRange(weekDays, fromStart: fromStart, toStart: toStart) {
                        let left = CGFloat(colStart) * cellWidth
                        let width = CGFloat(colEnd - colStart + 1) * cellWidth
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .fill(AppColor.ember.opacity(0.2))
                            .overlay(
                                RoundedRectangle(cornerRadius: 6, style: .continuous)
                                    .strokeBorder(AppColor.ember.opacity(0.6), lineWidth: 1.2)
                            )
                            .frame(width: max(width - 4, 4), height: fixedRowHeight - 4)
                            .offset(x: left + 2, y: CGFloat(index) * fixedRowHeight + 2)
                            .allowsHitTesting(false)
                    }
                }
            }
        }
    }

    // Backing visible-width cache for dateAtContentPoint, written by the
    // overlay GeometryReader. Using @State here avoids forcing a full
    // GeometryReader around the gesture — the DragGesture already receives
    // absolute content coords via the named coordinate space, we only need
    // to know the row width to resolve the column.
    @State private var visibleGridWidth: CGFloat = 0

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

    private func monthCell(day: Date, bandReserve: CGFloat, byDay: [Date: [CalendarEventMirror]]) -> some View {
        let dayStart = calendar.startOfDay(for: day)
        let isCurrentMonth = calendar.component(.month, from: day) == calendar.component(.month, from: anchorDate)
        let allEventsToday = byDay[dayStart] ?? []
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
                HStack(spacing: 3) {
                    CalendarTaskCheckbox(task: task, size: 9)
                    CalendarTaskPreviewButton(task: task) {
                        Text(task.title)
                            .hcbFont(.caption2)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                    }
                }
                .hcbScaledPadding(.horizontal, 6)
                .hcbScaledPadding(.vertical, 2)
                .background(
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .fill(AppColor.ember.opacity(0.15))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .strokeBorder(AppColor.ember.opacity(0.35), lineWidth: 0.6)
                )
                .foregroundStyle(AppColor.ink)
                .strikethrough(task.isCompleted, color: .secondary)
                .opacity(task.isCompleted ? 0.55 : 1.0)
            }
            let hiddenEvents = max(0, events.count - eventSlots) + hiddenBandEvents
            let hiddenTasks = max(0, tasks.count - taskSlots)
            if hiddenEvents + hiddenTasks > 0 {
                MonthMoreButton(
                    count: hiddenEvents + hiddenTasks,
                    day: dayStart,
                    events: allEventsToday,
                    tasks: tasks,
                    calendarColor: calendarColor(for:)
                )
            }
            Spacer(minLength: 0)
        }
        // Horizontal cell padding matches the bandOverlay's 2pt offset so
        // timed-event tiles line up cell-edge to cell-edge with multi-day
        // bands. Vertical padding kept at 4pt for breathing room around
        // the day number and stack of tiles.
        .hcbScaledPadding(.horizontal, 2)
        .hcbScaledPadding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(
            Rectangle()
                .fill(isCurrentMonth ? Color.clear : AppColor.cream.opacity(0.15))
        )
        .overlay(
            Rectangle()
                .fill(AppColor.ember.opacity(flashDay == dayStart ? 0.22 : 0))
                .animation(.easeOut(duration: 0.18), value: flashDay)
        )
        .overlay(
            Rectangle()
                .strokeBorder(AppColor.cardStroke, lineWidth: 0.5)
        )
        .contentShape(Rectangle())
        .onTapGesture {
            flashCell(dayStart)
            router?.present(.quickCreate(dayStart, allDay: true))
        }
        .contextMenu {
            Button("New event…") {
                router?.present(.quickCreate(dayStart, allDay: false))
            }
            Button("New all-day event…") {
                router?.present(.quickCreate(dayStart, allDay: true))
            }
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

// PreferenceKey carrying the current scroll-offset (in points, measured
// downward from the top of the content). Used by the continuous-scroll
// month grid to reverse-sync the visible center week into anchorDate.
private struct ScrollOffsetKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}
