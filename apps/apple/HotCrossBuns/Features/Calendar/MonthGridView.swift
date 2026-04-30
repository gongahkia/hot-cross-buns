import SwiftUI
import AppKit

enum CalendarMonthScrollWindow {
    static let pastMonthsKey = "calendar.monthScroll.pastMonths"
    static let futureMonthsKey = "calendar.monthScroll.futureMonths"
    static let defaultPastMonths = 0
    static let defaultFutureMonths = 3
    static let pastRange = 0...24
    static let futureRange = 1...36

    static func clampedPast(_ value: Int) -> Int {
        min(max(value, pastRange.lowerBound), pastRange.upperBound)
    }

    static func clampedFuture(_ value: Int) -> Int {
        min(max(value, futureRange.lowerBound), futureRange.upperBound)
    }
}

struct MonthGridView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.routerPath) private var router
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage(CalendarMonthScrollWindow.pastMonthsKey) private var configuredPastMonths = CalendarMonthScrollWindow.defaultPastMonths
    @AppStorage(CalendarMonthScrollWindow.futureMonthsKey) private var configuredFutureMonths = CalendarMonthScrollWindow.defaultFutureMonths
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
    private let previousMonthLoaderHeight: CGFloat = 34
    private let nextMonthLoaderHeight: CGFloat = 34
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
    @State private var cachedBandsByWeek: [Date: [CalendarGridLayout.MonthBand]] = [:]
    @State private var cachedTasksByDay: [Date: [TaskMirror]] = [:]
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
    // First-render guard. Before the onAppear scrollToAnchor has positioned
    // the viewport on today's week, the initial preference-change callback
    // fires with scrollOffset = 0 → center week = start of the 104-week
    // window (~1 year ago) → would stomp anchorDate back to last year before
    // we ever got a chance to scroll. Flipped true once the initial scroll
    // runs, so subsequent user-driven preference changes work normally.
    @State private var didPerformInitialScroll: Bool = false
    @State private var isLoadingPreviousMonth: Bool = false
    @State private var isLoadingNextMonth: Bool = false
    @State private var windowFirstMonthStart: Date = Date()
    @State private var windowLastMonthStart: Date = Date()

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
                        previousMonthLoader(proxy: proxy)
                            .frame(height: previousMonthLoaderHeight)

                        ForEach(weekStarts, id: \.self) { weekStart in
                            weekRow(
                                for: weekStart,
                                bands: cachedBandsByWeek[weekStart] ?? [],
                                byDay: cachedByDay,
                                tasksByDay: cachedTasksByDay
                            )
                            .frame(height: fixedRowHeight)
                            .id(weekStart)
                        }

                        nextMonthLoader(proxy: proxy)
                            .frame(height: nextMonthLoaderHeight)
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
                .onAppear {
                    // Sequence matters: weekStarts must be populated before
                    // scrollTo, and SwiftUI must get one pass to render those
                    // IDs in the ForEach before the proxy can resolve them.
                    // Otherwise the first scroll is unreliable and the grid
                    // can open at the wrong week until Today is clicked.
                    if weekStarts.isEmpty {
                        buildWindow(centeredOn: anchorDate)
                    }
                    rebuildGridCacheIfNeeded()
                    scheduleScrollToAnchor(proxy: proxy, animated: false) {
                        didPerformInitialScroll = true
                    }
                }
                .onChange(of: anchorDate) { _, newValue in
                    if skipNextScrollSync {
                        skipNextScrollSync = false
                        return
                    }
                    // If the new anchor left the window, rebuild starting at
                    // its month. Month mode is a bounded continuous surface:
                    // programmatic jumps open at the month start, while
                    // history loads on demand from the top boundary.
                    if isDateInWindow(newValue) == false {
                        buildWindow(centeredOn: newValue)
                        rebuildGridCacheIfNeeded()
                        scheduleScrollToAnchor(proxy: proxy, animated: true)
                        return
                    }
                    scrollToAnchor(proxy: proxy, animated: true)
                }
                .onChange(of: currentGridCacheKey) { _, _ in rebuildGridCacheIfNeeded() }
                .onChange(of: monthWindowPreferenceKey) { _, _ in
                    buildWindow(centeredOn: anchorDate)
                    rebuildGridCacheIfNeeded()
                    scheduleScrollToAnchor(proxy: proxy, animated: false)
                }
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
        // dataRevision replaces the prior model.events.count fingerprint —
        // renames / reschedules / recolors with unchanged total count now
        // bust the cache correctly.
        return "\(selectedIds)|\(visibleTaskListKey)|\(searchQuery)|\(windowKey)|\(model.dataRevision)"
    }

    private var windowKey: String {
        guard let first = weekStarts.first else { return "empty" }
        return "\(Int(first.timeIntervalSince1970))-\(weekStarts.count)"
    }

    private var visibleTaskListKey: String {
        if model.settings.hasConfiguredTaskListSelection {
            return model.settings.selectedTaskListIDs.sorted().joined(separator: ",")
        }
        return model.taskLists.map(\.id).sorted().joined(separator: ",")
    }

    private var monthWindowPreferenceKey: String {
        "\(CalendarMonthScrollWindow.clampedPast(configuredPastMonths))|\(CalendarMonthScrollWindow.clampedFuture(configuredFutureMonths))"
    }

    // Flash the tapped cell for ~220ms. Used on monthCell click-to-create
    // so the user sees a visual acknowledgement before the popover paints.
    private func flashCell(_ day: Date) {
        flashDay = day
        Task {
            try? await Task.sleep(for: .milliseconds(220))
            // Task inherits MainActor from the enclosing SwiftUI View;
            // no explicit hop needed.
            if flashDay == day { flashDay = nil }
        }
    }

    private func rebuildGridCacheIfNeeded() {
        let key = currentGridCacheKey
        guard key != cachedGridKey else { return }
        cachedGridKey = key
        let first = weekStarts.first ?? anchorDate
        let last = weekStarts.last.flatMap { calendar.date(byAdding: .day, value: 6, to: $0) } ?? first
        let filtered = filteredEvents(from: first, to: last)
        cachedFiltered = filtered
        cachedByDay = CalendarGridLayout.eventsByDay(
            filtered,
            from: first,
            to: last,
            calendar: calendar
        )
        cachedBandsByWeek = buildBandsByWeek(byDay: cachedByDay)
        cachedTasksByDay = buildTasksByDay(from: first, to: last)
    }

    private func buildBandsByWeek(byDay: [Date: [CalendarEventMirror]]) -> [Date: [CalendarGridLayout.MonthBand]] {
        var bandsByWeek: [Date: [CalendarGridLayout.MonthBand]] = [:]
        for weekStart in weekStarts {
            let days = weekDays(startingAt: weekStart)
            var seen: Set<CalendarEventMirror.ID> = []
            var weekEvents: [CalendarEventMirror] = []
            for day in days {
                let dayStart = calendar.startOfDay(for: day)
                for event in byDay[dayStart] ?? [] where seen.insert(event.id).inserted {
                    weekEvents.append(event)
                }
            }
            bandsByWeek[weekStart] = CalendarGridLayout.monthBands(for: days, events: weekEvents, calendar: calendar)
        }
        return bandsByWeek
    }

    private func buildTasksByDay(from rangeStart: Date, to rangeEnd: Date) -> [Date: [TaskMirror]] {
        let visibleLists: Set<TaskListMirror.ID> = model.settings.hasConfiguredTaskListSelection
            ? model.settings.selectedTaskListIDs
            : Set(model.taskLists.map(\.id))
        var tasksByDay: [Date: [TaskMirror]] = [:]
        var cursor = calendar.startOfDay(for: rangeStart)
        let last = calendar.startOfDay(for: rangeEnd)
        while cursor <= last {
            let key = cursor.timeIntervalSinceReferenceDate
            let tasks = (model.tasksByDueDate[key] ?? [])
                .compactMap { model.task(id: $0) }
                .filter { visibleLists.contains($0.taskListID) }
            if tasks.isEmpty == false {
                tasksByDay[cursor] = tasks
            }
            guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { break }
            cursor = next
        }
        return tasksByDay
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

    // Rebuilds the rolling window of week-start dates around the given date.
    // Past/future month counts come from local UI preferences; the default
    // preserves a bounded current-month start while keeping a year ahead ready.
    private func buildWindow(centeredOn date: Date) {
        let anchorMonth = monthStart(containing: date)
        let firstMonth = calendar.date(
            byAdding: .month,
            value: -CalendarMonthScrollWindow.clampedPast(configuredPastMonths),
            to: anchorMonth
        ) ?? anchorMonth
        let lastMonth = calendar.date(
            byAdding: .month,
            value: CalendarMonthScrollWindow.clampedFuture(configuredFutureMonths),
            to: anchorMonth
        ) ?? anchorMonth
        setWindow(firstMonth: firstMonth, lastMonth: lastMonth)
    }

    private func firstVisibleWeekOfMonth(containing date: Date) -> Date {
        startOfWeek(for: monthStart(containing: date))
    }

    private func lastVisibleWeekOfMonth(containing date: Date) -> Date {
        let start = monthStart(containing: date)
        let nextMonth = calendar.date(byAdding: .month, value: 1, to: start) ?? start
        let lastDay = calendar.date(byAdding: .day, value: -1, to: nextMonth) ?? start
        return startOfWeek(for: lastDay)
    }

    private func monthStart(containing date: Date) -> Date {
        let comps = calendar.dateComponents([.year, .month], from: date)
        return calendar.date(from: DateComponents(year: comps.year, month: comps.month, day: 1)) ?? calendar.startOfDay(for: date)
    }

    private func setWindow(firstMonth: Date, lastMonth: Date) {
        let normalizedFirst = monthStart(containing: firstMonth)
        let normalizedLast = max(monthStart(containing: lastMonth), normalizedFirst)
        windowFirstMonthStart = normalizedFirst
        windowLastMonthStart = normalizedLast
        weekStarts = weeks(from: normalizedFirst, through: normalizedLast)
        windowStart = weekStarts.first ?? firstVisibleWeekOfMonth(containing: normalizedFirst)
    }

    private func weeks(from firstMonth: Date, through lastMonth: Date) -> [Date] {
        let firstWeek = firstVisibleWeekOfMonth(containing: firstMonth)
        let lastWeek = lastVisibleWeekOfMonth(containing: lastMonth)
        var out: [Date] = []
        var cursor = firstWeek
        while cursor <= lastWeek {
            out.append(cursor)
            guard let next = calendar.date(byAdding: .day, value: 7, to: cursor) else { break }
            cursor = next
        }
        return out
    }

    private func weekDays(startingAt weekStart: Date) -> [Date] {
        (0..<7).compactMap { calendar.date(byAdding: .day, value: $0, to: weekStart) }
    }

    private func isDateInWindow(_ date: Date) -> Bool {
        guard let first = weekStarts.first, let last = weekStarts.last else { return false }
        let endExclusive = calendar.date(byAdding: .day, value: 7, to: last) ?? last
        return date >= first && date < endExclusive
    }

    // Programmatic jumps in month mode open at the first visible week of the
    // selected month. The month/year context now lives inside the grid, so the
    // top chrome does not need to chase the scroll position.
    private func scrollToAnchor(proxy: ScrollViewProxy, animated: Bool) {
        let target = firstVisibleWeekOfMonth(containing: anchorDate)
        guard weekStarts.contains(target) else { return }
        if animated {
            HCBMotion.perform(reduceMotion: reduceMotion, animation: .easeInOut(duration: 0.24)) {
                proxy.scrollTo(target, anchor: .top)
            }
        } else {
            proxy.scrollTo(target, anchor: .top)
        }
    }

    private func scheduleScrollToAnchor(
        proxy: ScrollViewProxy,
        animated: Bool,
        completion: (() -> Void)? = nil
    ) {
        Task { @MainActor in
            await Task.yield()
            scrollToAnchor(proxy: proxy, animated: animated)
            completion?()
        }
    }

    private func scheduleScroll(
        proxy: ScrollViewProxy,
        to target: Date,
        anchor: UnitPoint,
        animated: Bool
    ) {
        Task { @MainActor in
            await Task.yield()
            if animated {
                HCBMotion.perform(reduceMotion: reduceMotion, animation: .easeInOut(duration: 0.24)) {
                    proxy.scrollTo(target, anchor: anchor)
                }
            } else {
                proxy.scrollTo(target, anchor: anchor)
            }
        }
    }

    private func loadPreviousMonth(proxy: ScrollViewProxy) {
        guard didPerformInitialScroll, isLoadingPreviousMonth == false, let firstWeek = weekStarts.first else { return }
        isLoadingPreviousMonth = true
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(180))
            let previousMonth = calendar.date(byAdding: .month, value: -1, to: windowFirstMonthStart) ?? windowFirstMonthStart
            let newWeeks = weeks(from: previousMonth, through: previousMonth).filter { $0 < firstWeek }
            if newWeeks.isEmpty == false {
                weekStarts = newWeeks + weekStarts
                windowFirstMonthStart = monthStart(containing: previousMonth)
                windowStart = weekStarts.first ?? windowStart
                rebuildGridCacheIfNeeded()
                scheduleScroll(proxy: proxy, to: firstWeek, anchor: .bottom, animated: false)
            }
            isLoadingPreviousMonth = false
        }
    }

    private func loadNextMonth(proxy: ScrollViewProxy) {
        guard didPerformInitialScroll, isLoadingNextMonth == false, let lastWeek = weekStarts.last else { return }
        isLoadingNextMonth = true
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(180))
            let nextMonth = calendar.date(byAdding: .month, value: 1, to: windowLastMonthStart) ?? windowLastMonthStart
            let newWeeks = weeks(from: nextMonth, through: nextMonth).filter { $0 > lastWeek }
            if newWeeks.isEmpty == false {
                weekStarts.append(contentsOf: newWeeks)
                windowLastMonthStart = monthStart(containing: nextMonth)
                rebuildGridCacheIfNeeded()
            }
            isLoadingNextMonth = false
        }
    }

    // Reverse-sync: as the user scrolls, figure out which week sits at the
    // visible-center and push its month into anchorDate. skipNextScrollSync
    // short-circuits the resulting onChange(of: anchorDate) so programmatic
    // scroll doesn't fight live scrolling.
    private func updateAnchorFromScroll(centerY: CGFloat) {
        // Suppress until the initial scrollTo has positioned the viewport.
        // Without this, the first preference-change callback (fired at the
        // moment the ScrollView lays out at offset 0) runs before onAppear's
        // scrollTo and stomps anchorDate to the top of the window.
        guard didPerformInitialScroll else { return }
        guard fixedRowHeight > 0 else { return }
        let gridY = centerY - previousMonthLoaderHeight
        guard gridY >= 0 else { return }
        let index = Int((gridY / fixedRowHeight).rounded(.down))
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

    private func filteredEvents(from rangeStart: Date, to rangeEnd: Date) -> [CalendarEventMirror] {
        // Reads the model's pre-bucketed day index so month scrolling only
        // considers events inside the rendered window. The previous path walked
        // every selected-calendar event, then re-filtered that corpus per week;
        // large future calendars made downward scroll-window extension janky.
        let selectedCalendarIDs = Set(model.calendarSnapshot.selectedCalendars.map(\.id))
        let q = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()

        var seen: Set<CalendarEventMirror.ID> = []
        var out: [CalendarEventMirror] = []
        var cursor = calendar.startOfDay(for: rangeStart)
        let last = calendar.startOfDay(for: rangeEnd)
        while cursor <= last {
            let key = cursor.timeIntervalSinceReferenceDate
            for eventID in model.eventsByDay[key] ?? [] where seen.insert(eventID).inserted {
                guard let event = model.event(id: eventID),
                      selectedCalendarIDs.contains(event.calendarID) else { continue }
                if q.isEmpty
                    || event.summary.localizedCaseInsensitiveContains(q)
                    || event.details.localizedCaseInsensitiveContains(q)
                    || event.location.localizedCaseInsensitiveContains(q) {
                    out.append(event)
                }
            }
            guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { break }
            cursor = next
        }

        return out.sorted { lhs, rhs in
            if lhs.startDate != rhs.startDate { return lhs.startDate < rhs.startDate }
            return lhs.id < rhs.id
        }
    }

    private var weekdayHeader: some View {
        HStack(spacing: 0) {
            ForEach(weekdaySymbols.indices, id: \.self) { index in
                Text(weekdaySymbols[index])
                    .hcbFont(.caption, weight: .semibold)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
            }
        }
        .hcbScaledPadding(.vertical, 8)
    }

    private func weekRow(
        for weekStart: Date,
        bands: [CalendarGridLayout.MonthBand],
        byDay: [Date: [CalendarEventMirror]],
        tasksByDay: [Date: [TaskMirror]]
    ) -> some View {
        let days = weekDays(startingAt: weekStart)

        return GeometryReader { geo in
            let cellWidth = geo.size.width / CGFloat(max(days.count, 1))
            ZStack(alignment: .topLeading) {
                HStack(spacing: 0) {
                    ForEach(Array(days.enumerated()), id: \.element) { col, day in
                        let cellBandReserve = bandReserve(for: col, bands: bands)
                        monthCell(day: day, bandReserve: cellBandReserve, byDay: byDay, tasksByDay: tasksByDay)
                            .frame(maxWidth: .infinity, minHeight: fixedRowHeight, maxHeight: fixedRowHeight, alignment: .top)
                            .clipped() // stop per-cell VStack overflow (day number + bandReserve + 2 events + 2 tasks + "+N more" can exceed fixedRowHeight) from bleeding into the next week row
                    }
                }
                bandOverlay(bands: bands, cellWidth: cellWidth)
                monthBoundaryOverlay(days: days, cellWidth: cellWidth)
            }
        }
        .frame(height: fixedRowHeight)
        .clipped() // defense-in-depth: also clip the row itself so band overlays can't leak out
    }

    private func bandReserve(for column: Int, bands: [CalendarGridLayout.MonthBand]) -> CGFloat {
        let highestVisibleLane = bands
            .filter { band in
                column >= band.startColumn
                    && column <= band.endColumn
                    && band.lane < maxVisibleLanes
            }
            .map(\.lane)
            .max()
        guard let highestVisibleLane else { return 0 }
        return CGFloat(highestVisibleLane + 1) * laneHeight
            + CGFloat(highestVisibleLane) * laneSpacing
            + 4
    }

    private func previousMonthLoader(proxy: ScrollViewProxy) -> some View {
        HStack(spacing: 8) {
            if isLoadingPreviousMonth {
                ProgressView()
                    .controlSize(.small)
                Text("Loading previous month…")
                    .hcbFont(.caption, weight: .medium)
            } else {
                Image(systemName: "chevron.up")
                    .hcbFont(.caption, weight: .semibold)
                Text("Scroll up to load previous month")
                    .hcbFont(.caption, weight: .medium)
            }
        }
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.regularMaterial.opacity(0.35))
        .onAppear {
            loadPreviousMonth(proxy: proxy)
        }
    }

    private func nextMonthLoader(proxy: ScrollViewProxy) -> some View {
        HStack(spacing: 8) {
            if isLoadingNextMonth {
                ProgressView()
                    .controlSize(.small)
                Text("Loading next month…")
                    .hcbFont(.caption, weight: .medium)
            } else {
                Text("Scroll down to load next month")
                    .hcbFont(.caption, weight: .medium)
                Image(systemName: "chevron.down")
                    .hcbFont(.caption, weight: .semibold)
            }
        }
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.regularMaterial.opacity(0.35))
        .onAppear {
            loadNextMonth(proxy: proxy)
        }
    }

    // Resolves a gesture point — given in the "monthGridContent" named
    // coordinate space, i.e. relative to the LazyVStack's top-leading — into
    // a concrete date. Row derives from y / fixedRowHeight; column from
    // x / (contentWidth / 7). Clamped so a drag that overshoots the grid
    // doesn't cause the selection to disappear mid-gesture.
    private func dateAtContentPoint(_ point: CGPoint) -> Date? {
        guard fixedRowHeight > 0, weekStarts.isEmpty == false else { return nil }
        let gridY = point.y - previousMonthLoaderHeight
        guard gridY >= 0 else { return nil }
        let rowIndex = max(0, min(weekStarts.count - 1, Int(gridY / fixedRowHeight)))
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
                        RoundedRectangle(cornerRadius: 6)
                            .fill(AppColor.ember.opacity(0.2))
                            .overlay(
                                RoundedRectangle(cornerRadius: 6)
                                    .strokeBorder(AppColor.ember.opacity(0.6), lineWidth: 1.2)
                            )
                            .frame(width: max(width - 4, 4), height: fixedRowHeight - 4)
                            .offset(x: left + 2, y: previousMonthLoaderHeight + CGFloat(index) * fixedRowHeight + 2)
                            .allowsHitTesting(false)
                    }
                }
            }
        }
    }

    private func monthBoundaryOverlay(days: [Date], cellWidth: CGFloat) -> some View {
        ZStack(alignment: .topLeading) {
            ForEach(Array(days.enumerated()), id: \.element) { column, day in
                if calendar.component(.day, from: day) == 1 {
                    let x = CGFloat(column) * cellWidth
                    let line = monthBoundaryLineColor
                    ZStack(alignment: .topLeading) {
                        Rectangle()
                            .fill(line)
                            .frame(width: cellWidth * CGFloat(7 - column), height: 1.5)
                            .offset(x: x, y: 0)

                        if column > 0 {
                            Rectangle()
                                .fill(line)
                                .frame(width: 1.5, height: fixedRowHeight)
                                .offset(x: x, y: 0)

                            Rectangle()
                                .fill(line)
                                .frame(width: x, height: 1.5)
                                .offset(x: 0, y: fixedRowHeight - 1.5)
                        }
                    }
                    .allowsHitTesting(false)
                }
            }
        }
    }

    private var monthBoundaryLineColor: Color {
        AppColor.ember.opacity(0.55)
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
                                RoundedRectangle(cornerRadius: 4)
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

    private func monthCell(
        day: Date,
        bandReserve: CGFloat,
        byDay: [Date: [CalendarEventMirror]],
        tasksByDay: [Date: [TaskMirror]]
    ) -> some View {
        let dayStart = calendar.startOfDay(for: day)
        let allEventsToday = byDay[dayStart] ?? []
        // Bands render in the overlay; per-cell shows only timed single-day events.
        let events = allEventsToday.filter { CalendarGridLayout.isBandEvent($0, calendar: calendar) == false }
        let tasks = tasksByDay[dayStart] ?? []
        // +N more counts the hidden band events too so users see them accounted for.
        let hiddenBandEvents = max(0, allEventsToday.count - events.count - visibleBandCount(for: dayStart, in: day, allEventsToday: allEventsToday))
        let rowStride = laneHeight + laneSpacing
        let dayNumberReserve: CGFloat = 24
        let verticalPadding: CGFloat = 8
        let availableRowArea = max(0, fixedRowHeight - verticalPadding - dayNumberReserve - bandReserve)
        let availableRows = max(0, Int(floor((availableRowArea + laneSpacing) / rowStride)))
        let needsMoreButton = hiddenBandEvents > 0 || events.count + tasks.count > availableRows
        let visibleItemRows = needsMoreButton ? max(0, availableRows - 1) : availableRows
        let visibleEventCount = min(events.count, visibleItemRows)
        let visibleTaskCount = min(tasks.count, max(0, visibleItemRows - visibleEventCount))
        let hiddenEvents = max(0, events.count - visibleEventCount) + hiddenBandEvents
        let hiddenTasks = max(0, tasks.count - visibleTaskCount)
        return VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(dayLabel(for: day))
                    .hcbFont(.caption, weight: .semibold)
                    .foregroundStyle(dayNumberColor(for: day))
                    .lineLimit(1)
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
            ForEach(events.prefix(visibleEventCount), id: \.id) { event in
                CalendarEventPreviewButton(event: event) {
                    Text(eventLabel(event, in: day))
                        .hcbFont(.caption2)
                        .lineLimit(1)
                        .hcbScaledPadding(.horizontal, 6)
                        .hcbScaledPadding(.vertical, 2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(
                            RoundedRectangle(cornerRadius: 4)
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
            ForEach(tasks.prefix(visibleTaskCount)) { task in
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
                    RoundedRectangle(cornerRadius: 4)
                        .fill(AppColor.ember.opacity(0.15))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 4)
                        .strokeBorder(AppColor.ember.opacity(0.35), lineWidth: 0.6)
                )
                .foregroundStyle(AppColor.ink)
                .strikethrough(task.isCompleted, color: .secondary)
                .opacity(task.isCompleted ? 0.55 : 1.0)
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
                .fill(Color.clear)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(monthCellAccessibilityLabel(
            day: day,
            visibleEvents: Array(events.prefix(visibleEventCount)),
            visibleTasks: Array(tasks.prefix(visibleTaskCount)),
            hiddenEvents: hiddenEvents,
            hiddenTasks: hiddenTasks
        ))
        .overlay(
            Rectangle()
                .fill(AppColor.ember.opacity(flashDay == dayStart ? 0.22 : 0))
                .animation(HCBMotion.animation(.easeOut(duration: 0.18), reduceMotion: reduceMotion), value: flashDay)
        )
        .overlay(
            Rectangle()
                .strokeBorder(AppColor.cardStroke, lineWidth: 0.5)
        )
        .overlay(alignment: .bottomLeading) {
            if hiddenEvents + hiddenTasks > 0 {
                MonthMoreButton(
                    count: hiddenEvents + hiddenTasks,
                    day: dayStart,
                    events: allEventsToday,
                    tasks: tasks,
                    calendarColor: calendarColor(for:)
                )
                .padding(.horizontal, 4)
                .padding(.bottom, 3)
            }
        }
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

    private func monthCellAccessibilityLabel(
        day: Date,
        visibleEvents: [CalendarEventMirror],
        visibleTasks: [TaskMirror],
        hiddenEvents: Int,
        hiddenTasks: Int
    ) -> String {
        var parts = [day.formatted(.dateTime.weekday(.wide).month(.wide).day().year())]
        if calendar.isDateInToday(day) {
            parts.append("Today")
        }
        for event in visibleEvents {
            parts.append("Event: \(eventLabel(event, in: day))")
        }
        for task in visibleTasks {
            let state = task.isCompleted ? "completed task" : "task"
            parts.append("\(state): \(TagExtractor.stripped(from: task.title))")
        }
        if hiddenEvents > 0 {
            parts.append("\(hiddenEvents) more event\(hiddenEvents == 1 ? "" : "s")")
        }
        if hiddenTasks > 0 {
            parts.append("\(hiddenTasks) more task\(hiddenTasks == 1 ? "" : "s")")
        }
        if parts.count == 1 {
            parts.append("No visible events or tasks")
        }
        return parts.joined(separator: ", ")
    }

    private func dayLabel(for day: Date) -> String {
        if calendar.component(.day, from: day) == 1 {
            return day.formatted(.dateTime.month(.abbreviated).day().year())
        }
        return "\(calendar.component(.day, from: day))"
    }

    private func dayNumberColor(for day: Date) -> Color {
        if calendar.isDateInToday(day) { return AppColor.ember }
        return AppColor.ink
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
