import SwiftUI

// §7.01 Phase D3 — year overview. 4 columns × 3 rows of mini-months.
// Each day cell shades by event-count heatmap; clicking a day jumps to
// Day view via onPickDay. Reuses existing model.events and the calendar-
// selection pipeline — no new backend plumbing.
struct YearGridView: View {
    @Environment(AppModel.self) private var model
    @Binding var anchorDate: Date
    let onPickDay: (Date) -> Void

    private let calendar = Calendar.current

    private var year: Int {
        calendar.component(.year, from: anchorDate)
    }

    private var months: [Date] {
        (1...12).compactMap { month in
            calendar.date(from: DateComponents(year: year, month: month, day: 1))
        }
    }

    // Reads the pre-bucketed model.eventsByDay (built once per sync in
    // rebuildSnapshots) rather than re-walking the full event corpus + its
    // multi-day spans on every scroll tick. The index already excludes
    // cancelled events and inserts multi-day events into each day they
    // cover, so we only need to project counts for days within this year
    // and filter by selected calendars.
    private var eventsByDay: [Date: Int] {
        let selected = Set(model.calendarSnapshot.selectedCalendars.map(\.id))
        guard let yearStart = calendar.date(from: DateComponents(year: year, month: 1, day: 1)),
              let yearEnd = calendar.date(from: DateComponents(year: year + 1, month: 1, day: 1)) else {
            return [:]
        }
        let yearStartKey = yearStart.timeIntervalSinceReferenceDate
        let yearEndKey = yearEnd.timeIntervalSinceReferenceDate
        var counts: [Date: Int] = [:]
        for (key, events) in model.eventsByDay {
            guard key >= yearStartKey && key < yearEndKey else { continue }
            let count = events.reduce(into: 0) { acc, event in
                if selected.contains(event.calendarID) { acc += 1 }
            }
            if count > 0 {
                counts[Date(timeIntervalSinceReferenceDate: key)] = count
            }
        }
        return counts
    }

    var body: some View {
        let counts = eventsByDay
        let maxCount = counts.values.max() ?? 0
        GeometryReader { proxy in
            let outerPadding: CGFloat = 16
            let gridSpacing: CGFloat = 16
            let availableHeight = max(0, proxy.size.height - outerPadding * 2 - gridSpacing * 2)
            let monthHeight = max(210, availableHeight / 3)
            let dayCellHeight = max(18, (monthHeight - 58) / 7)

            ScrollView {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: gridSpacing), count: 4), spacing: gridSpacing) {
                    ForEach(months, id: \.self) { month in
                        miniMonth(for: month, counts: counts, maxCount: maxCount, monthHeight: monthHeight, dayCellHeight: dayCellHeight)
                    }
                }
                .hcbScaledPadding(outerPadding)
            }
        }
    }

    private func miniMonth(for monthStart: Date, counts: [Date: Int], maxCount: Int, monthHeight: CGFloat, dayCellHeight: CGFloat) -> some View {
        let cells = CalendarGridLayout.monthCells(for: monthStart, calendar: calendar)
        let monthNum = calendar.component(.month, from: monthStart)
        return VStack(alignment: .leading, spacing: 6) {
            Text(monthStart.formatted(.dateTime.month(.wide)))
                .hcbFont(.subheadline, weight: .semibold)
                .foregroundStyle(AppColor.ink)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 1), count: 7), spacing: 2) {
                ForEach(weekdayHeaders.indices, id: \.self) { index in
                    Text(weekdayHeaders[index])
                        .hcbFont(.caption2, weight: .medium)
                        .foregroundStyle(.secondary)
                }
                ForEach(cells, id: \.self) { day in
                    dayCell(day: day, monthNum: monthNum, counts: counts, maxCount: maxCount, dayCellHeight: dayCellHeight)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(minHeight: monthHeight, alignment: .top)
        .hcbScaledPadding(10)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(AppColor.cream.opacity(0.25))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(AppColor.cardStroke, lineWidth: 0.5)
        )
    }

    private func dayCell(day: Date, monthNum: Int, counts: [Date: Int], maxCount: Int, dayCellHeight: CGFloat) -> some View {
        let startOfDay = calendar.startOfDay(for: day)
        let isInMonth = calendar.component(.month, from: day) == monthNum
        let isToday = calendar.isDateInToday(day)
        let count = counts[startOfDay] ?? 0
        let shade: Double = maxCount > 0 ? min(0.7, Double(count) / Double(max(maxCount, 1)) * 0.7) : 0
        return Button {
            onPickDay(startOfDay)
        } label: {
            Text("\(calendar.component(.day, from: day))")
                .hcbFontSystem(size: 9, weight: isToday ? .bold : .regular)
                .foregroundStyle(isInMonth ? AppColor.ink : .secondary.opacity(0.5))
                .frame(maxWidth: .infinity, minHeight: dayCellHeight)
                .background(
                    RoundedRectangle(cornerRadius: 3)
                        .fill(isToday ? AppColor.ember.opacity(0.35) : AppColor.ember.opacity(shade))
                )
        }
        .buttonStyle(.plain)
        .opacity(isInMonth ? 1.0 : 0.4)
        .help(count > 0 ? "\(count) event\(count == 1 ? "" : "s") on \(day.formatted(.dateTime.month(.abbreviated).day().year()))" : "\(day.formatted(.dateTime.month(.abbreviated).day().year()))")
    }

    private var weekdayHeaders: [String] {
        let symbols = calendar.veryShortStandaloneWeekdaySymbols
        let first = calendar.firstWeekday - 1
        return (0..<7).map { symbols[(first + $0) % 7] }
    }
}
