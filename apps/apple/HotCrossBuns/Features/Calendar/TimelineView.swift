import SwiftUI

// Horizontal-axis timeline for Calendar tab. One row per task-with-due-date
// or event within the visible window. Events render as spans, tasks as
// single-day markers. Click a row → routes to the existing task/event
// inspector. Drag-to-reschedule deferred (URGENT-TODO §6.6) — read-only v1.
struct TimelineView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.routerPath) private var router
    @Binding var anchorDate: Date
    let searchQuery: String

    @SceneStorage("calendarTimelineZoom") private var zoomKey: String = TimelineZoom.week.rawValue
    @State private var zoom: TimelineZoom = .week

    private let calendar = Calendar.current
    private let rowHeight: CGFloat = 34
    private let rowSpacing: CGFloat = 6
    private let leftGutter: CGFloat = 220 // title column fixed width
    private let axisHeight: CGFloat = 30

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            GeometryReader { _ in
                ScrollView([.horizontal, .vertical], showsIndicators: true) {
                    timelineCanvas
                        .hcbScaledPadding(.bottom, 12)
                }
            }
        }
        .onAppear {
            zoom = TimelineZoom(rawValue: zoomKey) ?? .week
        }
        .onChange(of: zoom) { _, newValue in
            zoomKey = newValue.rawValue
        }
    }

    // MARK: - header (zoom + axis)

    private var header: some View {
        HStack(spacing: 10) {
            Picker("Zoom", selection: $zoom) {
                ForEach(TimelineZoom.allCases, id: \.self) { z in
                    Text(z.title).tag(z)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .fixedSize()
            Spacer(minLength: 0)
            Text("\(items.count) item\(items.count == 1 ? "" : "s")")
                .hcbFont(.caption)
                .foregroundStyle(.secondary)
        }
        .hcbScaledPadding(.horizontal, 16)
        .hcbScaledPadding(.vertical, 8)
    }

    // MARK: - canvas

    private var timelineCanvas: some View {
        let range = TimelineLayout.defaultRange(anchor: anchorDate, zoom: zoom, calendar: calendar)
        let pointsPerDay = zoom.pointsPerDay
        let totalDays = zoom.totalDays
        let canvasWidth = CGFloat(totalDays) * pointsPerDay

        return VStack(alignment: .leading, spacing: 0) {
            // Axis row — dates above the canvas.
            HStack(spacing: 0) {
                Color.clear.frame(width: leftGutter)
                ZStack(alignment: .topLeading) {
                    Rectangle().fill(Color.clear).frame(width: canvasWidth, height: axisHeight)
                    ForEach(dateTicks(for: range, canvasWidth: canvasWidth), id: \.self) { tick in
                        let x = TimelineLayout.xOffset(for: tick, rangeStart: range.lowerBound, pointsPerDay: pointsPerDay, calendar: calendar)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(axisLabel(for: tick))
                                .hcbFont(.caption2, weight: .medium)
                                .foregroundStyle(isToday(tick) ? AppColor.ember : .secondary)
                            Rectangle()
                                .fill(isToday(tick) ? AppColor.ember : AppColor.cardStroke)
                                .frame(width: 1, height: axisHeight - 12)
                        }
                        .offset(x: x, y: 2)
                    }
                }
            }

            // Rows
            if items.isEmpty {
                ContentUnavailableView(
                    "Nothing in this range",
                    systemImage: "calendar",
                    description: Text("Pick a wider zoom, or move the anchor with the navigation arrows.")
                )
                .hcbScaledPadding(.vertical, 32)
                .frame(maxWidth: .infinity)
            } else {
                ForEach(items) { item in
                    row(for: item, range: range, pointsPerDay: pointsPerDay, canvasWidth: canvasWidth)
                        .frame(height: rowHeight)
                        .hcbScaledPadding(.vertical, rowSpacing / 2)
                }
            }
        }
    }

    @ViewBuilder
    private func row(for item: TimelineItem, range: ClosedRange<Date>, pointsPerDay: CGFloat, canvasWidth: CGFloat) -> some View {
        HStack(spacing: 0) {
            // Fixed title column (doesn't scroll horizontally with the
            // canvas since both are in the same ScrollView content — but
            // keeping the gutter reserves space so bars don't collide).
            HStack(spacing: 6) {
                Image(systemName: item.isTask ? "circle" : "calendar")
                    .foregroundStyle(item.isTask ? AppColor.ember : AppColor.blue)
                    .hcbFont(.caption)
                Text(item.title)
                    .hcbFont(.caption, weight: .medium)
                    .foregroundStyle(AppColor.ink)
                    .lineLimit(1)
            }
            .frame(width: leftGutter - 8, alignment: .leading)
            .hcbScaledPadding(.horizontal, 4)

            // Canvas column with the positioned bar.
            ZStack(alignment: .topLeading) {
                Rectangle().fill(Color.clear).frame(width: canvasWidth, height: rowHeight)
                // subtle grid lines for each day tick
                ForEach(dateTicks(for: range, canvasWidth: canvasWidth), id: \.self) { tick in
                    let x = TimelineLayout.xOffset(for: tick, rangeStart: range.lowerBound, pointsPerDay: pointsPerDay, calendar: calendar)
                    Rectangle()
                        .fill(isToday(tick) ? AppColor.ember.opacity(0.25) : AppColor.cardStroke.opacity(0.35))
                        .frame(width: isToday(tick) ? 1.2 : 0.5, height: rowHeight)
                        .offset(x: x)
                }
                // Bar
                Button { openItem(item) } label: {
                    bar(for: item, range: range, pointsPerDay: pointsPerDay)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func bar(for item: TimelineItem, range: ClosedRange<Date>, pointsPerDay: CGFloat) -> some View {
        let clampedStart = max(item.startDate, range.lowerBound)
        let clampedEnd = min(item.endDate, range.upperBound)
        let x = TimelineLayout.xOffset(for: clampedStart, rangeStart: range.lowerBound, pointsPerDay: pointsPerDay, calendar: calendar)
        let w = TimelineLayout.width(start: clampedStart, end: clampedEnd, pointsPerDay: pointsPerDay)
        let tint: Color = item.isTask ? AppColor.ember : AppColor.blue
        return RoundedRectangle(cornerRadius: 6, style: .continuous)
            .fill(tint.opacity(0.25))
            .overlay(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .strokeBorder(tint.opacity(0.7), lineWidth: 1)
            )
            .frame(width: w, height: rowHeight - 10)
            .offset(x: x, y: 5)
            .help(barTooltip(for: item))
    }

    private func barTooltip(for item: TimelineItem) -> String {
        let fmt: Date.FormatStyle = item.isAllDay
            ? .dateTime.month(.abbreviated).day()
            : .dateTime.month(.abbreviated).day().hour().minute()
        if item.startDate == item.endDate || item.isTask {
            return "\(item.title) — \(item.startDate.formatted(fmt))"
        }
        return "\(item.title) — \(item.startDate.formatted(fmt)) → \(item.endDate.formatted(fmt))"
    }

    // MARK: - derived

    private var items: [TimelineItem] {
        let range = TimelineLayout.defaultRange(anchor: anchorDate, zoom: zoom, calendar: calendar)
        return TimelineLayout.items(
            tasks: model.tasks,
            events: model.events.filter { event in
                model.calendarSnapshot.selectedCalendars.contains(where: { $0.id == event.calendarID })
            },
            range: range,
            calendar: calendar,
            searchQuery: searchQuery
        )
    }

    private func openItem(_ item: TimelineItem) {
        switch item.kind {
        case .task(let task):
            router?.present(.editTask(task.id))
        case .event(let event):
            router?.present(.editEvent(event.id))
        }
    }

    private func dateTicks(for range: ClosedRange<Date>, canvasWidth: CGFloat) -> [Date] {
        let stride: Int
        switch zoom {
        case .day: stride = 1        // every day
        case .week: stride = 1       // every day (week view still per-day)
        case .month: stride = 7      // weekly
        case .quarter: stride = 30   // ~monthly
        }
        var out: [Date] = []
        var cursor = calendar.startOfDay(for: range.lowerBound)
        while cursor <= range.upperBound {
            out.append(cursor)
            guard let next = calendar.date(byAdding: .day, value: stride, to: cursor) else { break }
            cursor = next
        }
        return out
    }

    private func axisLabel(for date: Date) -> String {
        switch zoom {
        case .day, .week:
            return date.formatted(.dateTime.month(.abbreviated).day())
        case .month:
            return date.formatted(.dateTime.month(.abbreviated).day())
        case .quarter:
            return date.formatted(.dateTime.month(.abbreviated).year(.twoDigits))
        }
    }

    private func isToday(_ date: Date) -> Bool {
        calendar.isDateInToday(date)
    }
}
