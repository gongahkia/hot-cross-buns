import SwiftUI

struct DayGridView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.routerPath) private var router
    @Binding var anchorDate: Date
    var searchQuery: String = ""

    private let hourHeight: CGFloat = 48
    private let hourStart = 0
    private let hourEnd = 24
    private let calendar = Calendar.current

    @State private var timedDrag: TimedDrag?
    // Click-to-create feedback. Flashes a brief tint at the tapped hour
    // slot so users see their click register before the popover paints.
    @State private var flashTimedSlot: Date?

    private struct TimedDrag: Equatable {
        var startY: CGFloat
        var endY: CGFloat
    }

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            eventsColumn
                .frame(maxWidth: .infinity)
            Divider()
            tasksPanel
                .hcbScaledFrame(width: 260)
        }
        .hcbScaledPadding(12)
    }

    private var dayStart: Date { calendar.startOfDay(for: anchorDate) }
    private var dayEnd: Date { calendar.date(byAdding: .day, value: 1, to: dayStart) ?? dayStart }

    // Looks up model.eventsByDay (pre-bucketed in rebuildSnapshots) rather
    // than scanning model.events. Each lookup is O(bucket size) instead of
    // O(full corpus). Search + past-event filtering apply afterward.
    private var visibleEvents: [CalendarEventMirror] {
        let now = Date()
        let key = dayStart.timeIntervalSinceReferenceDate
        let selectedIDs = Set(model.calendarSnapshot.selectedCalendars.map(\.id))
        let bucket = model.eventsByDay[key] ?? []
        let filtered = bucket.filter { event in
            selectedIDs.contains(event.calendarID)
                && model.settings.shouldHidePastEvent(event, now: now) == false
        }
        let q = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard q.isEmpty == false else { return filtered }
        return filtered.filter { event in
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

    // Reads model.tasksByDueDate (pre-bucketed in rebuildSnapshots). The
    // pre-built index already excludes completed + deleted tasks, so we
    // only need to intersect with the user's list selection and apply the
    // overdue-hide setting.
    private var dayTasks: [TaskMirror] {
        let visibleLists: Set<TaskListMirror.ID> = model.settings.hasConfiguredTaskListSelection
            ? model.settings.selectedTaskListIDs
            : Set(model.taskLists.map(\.id))
        let now = Date()
        let key = dayStart.timeIntervalSinceReferenceDate
        let bucket = model.tasksByDueDate[key] ?? []
        return bucket.filter { task in
            if model.settings.shouldHideOverdueTask(task, now: now, calendar: calendar) { return false }
            return visibleLists.contains(task.taskListID)
        }
        .sorted { lhs, rhs in
            if lhs.isCompleted != rhs.isCompleted { return lhs.isCompleted == false }
            return lhs.title < rhs.title
        }
    }

    private var eventsColumn: some View {
        // Capture router locally so the DragGesture / SpatialTapGesture
        // closures inside ScrollView reference a stable reference (custom
        // EnvironmentKey reads inside ScrollView/GeometryReader gesture
        // closures have shown propagation gaps).
        let capturedRouter = router
        return VStack(alignment: .leading, spacing: 8) {
            if allDayEvents.isEmpty == false {
                VStack(alignment: .leading, spacing: 4) {
                    Text("ALL-DAY")
                        .hcbFont(.caption2, weight: .bold)
                        .foregroundStyle(.secondary)
                    ForEach(allDayEvents) { event in
                        CalendarEventPreviewButton(event: event) {
                            Text(event.summary)
                                .hcbFont(.caption, weight: .medium)
                                .lineLimit(1)
                                .opacity(model.settings.opacityForPastEvent(event, now: Date()))
                                .hcbScaledPadding(.horizontal, 8)
                                .hcbScaledPadding(.vertical, 4)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(Capsule().fill(calendarColor(for: event).opacity(0.25)))
                                .foregroundStyle(AppColor.ink)
                        }
                        .accessibilityLabel("\(event.summary), all day")
                    }
                }
            }

            ScrollView {
                ZStack(alignment: .topLeading) {
                    hourGridBackground
                    Rectangle()
                        .fill(Color.clear)
                        .contentShape(Rectangle())
                        .frame(height: CGFloat(hourEnd - hourStart) * hourHeight)
                        .overlay(alignment: .topLeading) {
                            if let drag = timedDrag {
                                let top = min(drag.startY, drag.endY)
                                let height = max(abs(drag.endY - drag.startY), hourHeight / 4)
                                RoundedRectangle(cornerRadius: 6)
                                    .fill(AppColor.ember.opacity(0.22))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 6)
                                            .strokeBorder(AppColor.ember.opacity(0.6), lineWidth: 1.2)
                                    )
                                    .offset(x: 56, y: top)
                                    .frame(height: height)
                                    .hcbScaledPadding(.trailing, 8)
                                    .allowsHitTesting(false)
                            }
                        }
                        .gesture(
                            // Drag creates a time-blocked event; a short tap
                            // (< minimumDistance) falls through to quick-create.
                            DragGesture(minimumDistance: 6)
                                .onChanged { value in
                                    timedDrag = TimedDrag(startY: value.startLocation.y, endY: value.location.y)
                                }
                                .onEnded { value in
                                    let start = CalendarDropComputer.snappedStart(
                                        for: min(value.startLocation.y, value.location.y),
                                        hourHeight: hourHeight,
                                        dayStart: dayStart,
                                        calendar: calendar
                                    )
                                    let end = CalendarDropComputer.snappedStart(
                                        for: max(value.startLocation.y, value.location.y),
                                        hourHeight: hourHeight,
                                        dayStart: dayStart,
                                        calendar: calendar
                                    )
                                    timedDrag = nil
                                    let adjustedEnd = end <= start ? start.addingTimeInterval(1800) : end
                                    capturedRouter?.present(.quickCreateRange(start, adjustedEnd, allDay: false))
                                }
                        )
                        .simultaneousGesture(
                            SpatialTapGesture(count: 1)
                                .onEnded { value in
                                    guard timedDrag == nil else { return }
                                    let start = CalendarDropComputer.snappedStart(
                                        for: value.location.y,
                                        hourHeight: hourHeight,
                                        dayStart: dayStart,
                                        calendar: calendar
                                    )
                                    flashTimedStart(start)
                                    capturedRouter?.present(.quickCreate(start, allDay: false))
                                }
                        )
                        .overlay(alignment: .topLeading) {
                            // Momentary tint over the tapped hour slot so the
                            // click lands visibly before the popover paints.
                            if let flash = flashTimedSlot {
                                let minutesIntoDay = flash.timeIntervalSince(dayStart) / 60.0
                                let startHourOffset = Double(hourStart) * 60.0
                                let y = CGFloat(max(0, minutesIntoDay - startHourOffset)) / 60.0 * hourHeight
                                RoundedRectangle(cornerRadius: 6)
                                    .fill(AppColor.ember.opacity(0.22))
                                    .frame(height: hourHeight * 0.5)
                                    .offset(x: 56, y: y)
                                    .padding(.trailing, 8)
                                    .allowsHitTesting(false)
                                    .transition(.opacity)
                            }
                        }
                        .animation(.easeOut(duration: 0.18), value: flashTimedSlot)
                    GeometryReader { geo in
                        ForEach(timedEvents, id: \.id) { event in
                            eventTile(event, columnWidth: geo.size.width - 56)
                                .opacity(model.settings.opacityForPastEvent(event, now: Date()))
                        }
                    }
                    .frame(height: CGFloat(hourEnd - hourStart) * hourHeight)
                    .allowsHitTesting(true)
                    if let offset = currentTimeOffset() {
                        Rectangle()
                            .fill(AppColor.ember)
                            .hcbScaledFrame(height: 1)
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
                        .hcbScaledFrame(width: 48, alignment: .trailing)
                    Rectangle()
                        .fill(AppColor.cardStroke)
                        .hcbScaledFrame(height: 0.5)
                        .frame(maxWidth: .infinity)
                }
                .frame(height: hourHeight, alignment: .top)
            }
        }
    }

    // Flash the tapped timed slot for ~220ms.
    private func flashTimedStart(_ start: Date) {
        flashTimedSlot = start
        Task {
            try? await Task.sleep(for: .milliseconds(220))
            await MainActor.run {
                if flashTimedSlot == start { flashTimedSlot = nil }
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

        return CalendarEventPreviewButton(event: event) {
            VStack(alignment: .leading, spacing: 2) {
                Text(event.summary)
                    .hcbFont(.caption, weight: .semibold)
                    .lineLimit(2)
                if height > 38 {
                    Text("\(event.startDate.formatted(.dateTime.hour().minute())) – \(event.endDate.formatted(.dateTime.hour().minute()))")
                        .hcbFont(.caption2)
                        .foregroundStyle(.secondary)
                }
                if height > 60, event.location.isEmpty == false {
                    Text(event.location)
                        .hcbFont(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .hcbScaledPadding(.horizontal, 8)
            .hcbScaledPadding(.vertical, 4)
            .frame(width: max(columnWidth, 60), height: height - 2, alignment: .topLeading)
            .background(RoundedRectangle(cornerRadius: 8).fill(fill.opacity(0.22)))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(fill.opacity(0.55), lineWidth: 0.8))
        }
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
                    .hcbFont(.headline)
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
                            HStack(spacing: 8) {
                                CalendarTaskCheckbox(task: task, size: 15)
                                CalendarTaskPreviewButton(task: task) {
                                    HStack(spacing: 8) {
                                        Text(task.title)
                                            .hcbFont(.subheadline)
                                            .strikethrough(task.isCompleted)
                                            .foregroundStyle(AppColor.ink)
                                        Spacer(minLength: 0)
                                    }
                                    .contentShape(Rectangle())
                                }
                            }
                            .hcbScaledPadding(8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(RoundedRectangle(cornerRadius: 8).fill(AppColor.cream.opacity(0.4)))
                            .opacity(task.isCompleted ? 0.6 : 1.0)
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
